# Roadmap — Agendia

> Fases incrementales con criterios de aceptación. No se avanza de fase sin autorización explícita. El alcance de cada ítem está detallado en `PRODUCT_PLAN.md`, `ARCHITECTURE.md` y `DATABASE_DESIGN.md`.

## Bloqueo previo a Fase 1
Definir identidad comercial (nombre + identidad visual) — ver `DECISIONS.md`, decisión pendiente D-01. No se inicia Fase 1 hasta resolverlo, ya que el naming impacta el `schema.prisma` inicial (ej. metadatos, OG) y los assets de la landing.

## Fase 1 — Fundación
- Setup del proyecto: Next.js (App Router), TypeScript, Tailwind, shadcn/ui.
- PostgreSQL + Prisma, esquema inicial (`Organization`, `User`, `Membership`, `PasswordResetToken`).
- Auth.js configurado (Credentials + adapter Prisma), recuperación de contraseña, seguridad de sesión.
- Diseño base (tokens de color/tipografía ya definidos por la identidad comercial, layout shells).

**Aceptación:** se puede crear una organización y un usuario, loguearse, recuperar contraseña, y ver un dashboard vacío protegido por sesión y aislado por organización (un usuario de la organización A no puede ver datos de la organización B).

## Fase 2 — Landing, onboarding y ciclo de prueba gratuita
- Landing comercial completa con la identidad visual ya definida.
- Registro, login, onboarding guiado (negocio, rubro, servicios, duración, horarios, slug público).
- **Activación y vencimiento de la prueba gratuita de 7 días**, cálculo y validación en servidor, aviso de días restantes en el dashboard, transición a `trial_readonly` a los 7 días (sin integración de cobro todavía — eso es Fase 5).

**Aceptación:** un visitante nuevo completa registro + onboarding en menos de 5 minutos y llega a un dashboard con su slug público generado y su prueba activa contada desde el servidor; al simular el vencimiento de los 7 días, la cuenta pasa a solo lectura automáticamente sin intervención manual.

## Fase 3 — Agenda y reservas
- Servicios (alta/edición/activo-inactivo).
- Disponibilidad: reglas semanales + excepciones.
- Cálculo de slots disponibles.
- Turnos manuales (crear, editar, reprogramar, cancelar, completar, ausente, notas).
- Reserva pública en `/reservar/[slug]` sin login del cliente.
- Gestión de clientes.

**Aceptación:** no es posible crear dos turnos superpuestos para el mismo profesional ni por agenda manual ni por reserva pública, verificado con una prueba de concurrencia real contra la constraint de base de datos; un cliente puede reservar sin cuenta y recibe confirmación con enlaces de cancelación/reprogramación.

## Fase 4 — Recordatorios
- Tabla `Notification` como outbox, ruta `/api/cron/notifications`.
- Confirmación, cancelación, reprogramación, recordatorio 24h.
- Reintentos controlados, idempotencia, historial de envíos.

**Aceptación:** cancelar o reprogramar un turno anula o recalcula su recordatorio pendiente; reenviar el mismo evento no duplica el email (verificado vía `idempotencyKey`); el mecanismo funciona sin depender de procesos persistentes (se valida ejecutando el procesamiento como invocaciones independientes, no como un loop en memoria).

## Fase 5 — Monetización
- Estados comerciales completos (`active`, `past_due`, `canceled`, `locked`, regularización).
- Modelo de `Subscription` + webhooks de Mercado Pago, idempotentes (sin cobro real activado en producción todavía).
- Panel de administración SaaS básico: cuentas, estado de prueba/suscripción, suspender/reactivar.

**Aceptación:** el acceso se controla 100% desde el servidor (una organización en `locked` no puede crear turnos ni recibir reservas públicas aunque se manipule el cliente); el admin ve todas las cuentas y su estado comercial; un webhook duplicado de Mercado Pago no genera un doble procesamiento.

## Fase 6 — Instalación independiente
- Docker Compose (app + PostgreSQL propio).
- Modo `standalone` validado end-to-end.
- Mecanismo de licencia firmada con Ed25519.
- Backups y restauración documentados.
- Documentación de instalación.

**Aceptación:** se puede levantar una instancia standalone desde cero con `docker compose up`, sin conexión obligatoria a nuestros servidores, validando una licencia local firmada.

## Fase 7 — Calidad y lanzamiento
- Tests de reglas críticas (solapamientos, ciclo de prueba gratuita, idempotencia de webhooks y notificaciones).
- Revisión de seguridad (`docs/SECURITY.md`).
- Performance y SEO de la landing.
- Infraestructura de producción aprobada (ver `docs/INFRASTRUCTURE.md` y la decisión D-23) y checklist de lanzamiento (`docs/INFRASTRUCTURE.md` §10) completa.
- Deploy a producción.

**Aceptación:** suite de tests cubre las reglas de negocio críticas; Core Web Vitals en verde en la landing; checklist de seguridad y de lanzamiento revisadas y sin pendientes críticos abiertos.
