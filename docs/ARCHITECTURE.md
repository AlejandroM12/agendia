# Arquitectura técnica — Agendia

> Este documento define **cómo se construye** el sistema. El modelo de datos está en `DATABASE_DESIGN.md`. El alcance de producto está en `PRODUCT_PLAN.md`. El historial de decisiones (confirmadas y pendientes) está en `DECISIONS.md`.

## 1. Patrón general

Monolito modular. Un único deploy de Next.js (App Router) + TypeScript, sin microservicios ni frameworks adicionales de backend (se descarta NestJS: no hay justificación técnica que compense la complejidad extra en esta etapa). El mismo código base sirve ambas modalidades de despliegue mediante un flag de entorno:

```
DEPLOYMENT_MODE=saas | standalone
```

Este flag determina, en tiempo de ejecución, qué funcionalidades comerciales y administrativas están disponibles (panel `/admin`, flujo de suscripción, etc.). No se duplica la aplicación por modalidad.

## 2. Capas y organización del código

- **`app/`** — rutas: grupos de rutas para marketing, auth, dashboard (protegido), admin (protegido, solo SaaS), reserva pública, y API routes/webhooks/cron.
- **`modules/`** — lógica de dominio por *bounded context*: `organizations`, `auth`, `availability`, `appointments`, `services`, `customers`, `notifications`, `billing`, `licensing`, `admin`. Los route handlers y server actions son finos: validan con Zod y delegan en estas funciones. La lógica de negocio no vive en los componentes de UI ni en los handlers.
- **`lib/`** — utilidades transversales: cliente de Prisma, configuración de Auth.js, cliente de email, rate limiting, lectura del `DEPLOYMENT_MODE`.
- **`prisma/`** — esquema y migraciones (ver `DATABASE_DESIGN.md`).
- **`docker/`** — Dockerfile y `docker-compose.yml` para la modalidad standalone (Fase 6).

Estructura propuesta:

```
turnos-app/
├── app/
│   ├── (marketing)/           → landing, /precios
│   ├── (auth)/                → /login, /registro, recuperación de contraseña
│   ├── (dashboard)/dashboard/ → agenda, turnos, clientes, servicios,
│   │                             disponibilidad, recordatorios, configuracion,
│   │                             facturacion, onboarding
│   ├── (admin)/admin/         → solo rol SaaS admin; deshabilitado en standalone
│   ├── reservar/[slug]/       → público, sin auth
│   ├── cancelar/[token]/
│   ├── reprogramar/[token]/
│   └── api/
│       ├── webhooks/mercadopago/
│       ├── cron/notifications/
│       └── booking/[slug]/slots/
├── modules/
├── lib/
├── prisma/
├── docker/
└── docs/
```

## 3. Autenticación y sesiones

- **Librería:** Auth.js (NextAuth v5), proveedor Credentials (email + contraseña) con adapter de Prisma. Es una librería, no un servicio alojado de terceros: funciona igual en modo SaaS y standalone, sin dependencia de infraestructura externa. Permite añadir proveedores OAuth más adelante sin rediseño.
- **Recuperación de contraseña:** flujo de token de un solo uso con expiración corta (ej. 1 hora), enviado por email (Resend), invalidado tras su uso o al generarse uno nuevo.
- **Seguridad de sesión:** cookies de sesión `httpOnly`, `secure` y `sameSite=lax` como mínimo; hashing de contraseñas con bcrypt o argon2; invalidación de sesión ante cambio de contraseña; límite de intentos de login (ver rate limiting).
- **Autorización:** toda consulta a datos privados valida organización + rol en el servidor (nunca se confía en el estado del cliente). Este chequeo vive en los módulos de dominio, no se reimplementa por ruta.

## 4. Procesamiento de notificaciones (worker)

Requisito confirmado: el procesamiento debe funcionar correctamente en el hosting elegido **sin depender de procesos persistentes dentro de funciones serverless** (Vercel no soporta procesos de larga duración en sus funciones).

**Diseño (patrón outbox + invocación programada):**
- Cada evento (confirmación, cancelación, reprogramación, recordatorio 24h) crea un registro en la tabla `Notification` con estado `pending` y una `scheduledFor`.
- En **modo SaaS (Vercel):** un *Vercel Cron Job* invoca periódicamente `/api/cron/notifications`, una route handler de ejecución corta que toma un lote de notificaciones pendientes cuya `scheduledFor` ya venció, las procesa (envío vía Resend) y actualiza su estado. No hay ningún proceso que deba permanecer corriendo entre invocaciones — todo el estado vive en la base de datos, no en memoria.
- En **modo standalone (Docker Compose):** al no ser un entorno serverless, se puede usar un proceso persistente simple (contenedor con cron del sistema, o un proceso Node con `setInterval`) que llama a la misma lógica de módulo. La interfaz de negocio (`modules/notifications`) es idéntica en ambos modos; solo cambia el mecanismo de disparo.
- **Idempotencia:** cada notificación tiene una `idempotencyKey` única; reprocesar el mismo lote (ej. por reintento de la invocación cron) no duplica envíos.
- **Reintentos:** contador de `attempts` con backoff simple; tras un máximo de intentos, la notificación queda en `failed` con el error registrado, sin reintentos indefinidos.
- **Recalculo:** cancelar o reprogramar un turno cancela o reprograma su notificación `pending` asociada — nunca se envía un recordatorio de un turno cancelado.

Se descarta una cola dedicada (BullMQ/Redis) para el MVP: agrega infraestructura y costo operativo innecesarios en esta etapa y complica la instalación standalone. Si el volumen de notificaciones lo justifica más adelante, se puede migrar sin cambiar la interfaz del módulo `notifications`.

**Nota de producción:** si se aprueba la revisión de hosting propuesta en `docs/INFRASTRUCTURE.md` (D-23), el mecanismo de disparo se simplifica a un proceso Node persistente real (sin la restricción de Vercel que motivó este diseño) — el patrón outbox + idempotencia descrito arriba no cambia, solo deja de necesitar una invocación HTTP externa programada.

## 5. Prevención de solapamientos de turnos

Garantía a nivel de base de datos, no solo de interfaz:
- Constraint de exclusión en PostgreSQL sobre `(professionalId, rango_de_tiempo)` usando `tsrange` + `EXCLUDE USING gist` (requiere la extensión `btree_gist`).
- Prisma no modela exclusion constraints de forma nativa — se agrega mediante SQL manual dentro de una migración de Prisma (`prisma migrate dev --create-only` + edición del SQL generado).
- La creación de un turno ocurre dentro de una transacción; ante conflicto de exclusión, la transacción falla y la aplicación responde con un error claro de "horario no disponible", nunca con una condición de carrera silenciosa.
- La agenda manual y la reserva pública pasan por el mismo módulo (`modules/appointments`), por lo que no existen dos caminos de validación distintos.

## 6. Rate limiting y abuso en reservas públicas

- Conteo simple por IP + slug en base de datos (o LRU en memoria si la instancia es única) para limitar intentos de reserva/cancelación en una ventana de tiempo.
- Se evita una dependencia obligatoria de Redis para no complicar la instalación standalone. Si el SaaS escala a múltiples instancias sin estado compartido, este mecanismo deberá migrar a un store compartido (Redis/Upstash) — ver riesgo en `DECISIONS.md`.

## 7. Zonas horarias

- Todos los timestamps se almacenan en UTC.
- Cada `Organization` tiene un campo `timezone` (formato IANA), usado para el cálculo de disponibilidad y para el render en la interfaz.
- Valor por defecto al crear una organización: `America/Argentina/Buenos_Aires`, configurable desde `/dashboard/configuracion`.

## 8. Hosting (modo SaaS)

- **Bajo revisión:** la elección original (Vercel + Neon, D-04) está en proceso de reevaluación frente al requisito de operación 24/7 sin suspensión por inactividad. Ver `docs/INFRASTRUCTURE.md` para la comparación completa de opciones y `docs/DECISIONS.md` D-23 para la propuesta concreta pendiente de aprobación. No se configura entorno de producción todavía en ningún caso.
- **Modo standalone:** Docker Compose con PostgreSQL propio (contenedor), sin dependencia de ningún proveedor de hosting SaaS ni de nuestros servidores en tiempo de ejecución. Este punto no cambia sea cual sea el resultado de la revisión anterior.

## 9. Licencias (modalidad standalone — diseño para Fase 6)

- Firma digital asimétrica **Ed25519**: clave privada en nuestro poder (emisión de licencias), clave pública embebida en el software instalado (verificación local, sin red).
- La licencia codifica: identificador, producto, modalidad, alcance de uso, funcionalidades habilitadas, cantidad máxima de profesionales, condiciones de actualización.
- Verificación 100% local — no requiere conexión permanente a nuestros servidores.
- Sin mecanismos invasivos que arriesguen el acceso del cliente a sus propios datos (ej. nunca bloquear lectura/exportación de datos, aunque la licencia esté vencida).

## 10. Seguridad (requisitos transversales)

- Autenticación y autorización server-side en cada operación sobre datos privados.
- Aislamiento multi-tenant: toda consulta filtra por `organizationId`; se evalúa reforzarlo con Row-Level Security de PostgreSQL además de los filtros a nivel de aplicación.
- Validación de entradas con Zod en cada mutación.
- Rate limiting en endpoints públicos (reserva, cancelación, login).
- Prevención de solapamientos garantizada en base de datos (sección 5).
- Secretos gestionados vía variables de entorno, nunca hardcodeados ni versionados.
- Logs sin datos sensibles (sin contraseñas, tokens ni datos de contacto completos en texto plano).
- Auditoría de operaciones críticas (tabla `AuditLog`): cambios de estado de turno, cambios comerciales, acciones de administración SaaS.
- Enlaces de cancelación/reprogramación protegidos por token opaco, no por IDs secuenciales.
- Migraciones de base de datos versionadas y reproducibles (Prisma Migrate).
- Estrategia de backups definida antes de manejar datos de clientes reales (pendiente de detalle operativo — ver `DECISIONS.md`).
