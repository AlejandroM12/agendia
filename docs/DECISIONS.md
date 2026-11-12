# Registro de decisiones — Agendia

> Formato: una decisión por entrada, con estado, contexto y motivo. Se agregan entradas nuevas a medida que se confirman o se abren; no se reescribe el historial, solo se actualiza el estado.

## Pendientes (bloquean o condicionan avance)

### D-10 · Infraestructura de rate limiting a escala
**Estado:** PENDIENTE (no bloqueante para el MVP).
**Contexto:** se usa un contador en base de datos o en memoria para limitar abuso en endpoints públicos (sin Redis obligatorio, para no complicar la instalación standalone). Si el SaaS escala a múltiples instancias sin estado compartido, este mecanismo deja de ser confiable.
**Próximo paso:** revisar si el SaaS necesita escalar horizontalmente antes de definir migración a un store compartido (Redis/Upstash).

### D-11 · Política de retención de datos en estado `locked`
**Estado:** PENDIENTE (no bloqueante para el MVP).
**Contexto:** confirmado que no hay eliminación automática de datos ni en `trial_readonly` (30 días) ni en `locked`. Falta definir qué pasa con los datos de una organización `locked` a largo plazo (retención indefinida, exportación y borrado a pedido, u otro esquema).
**Próximo paso:** decisión comercial a tomar antes de la Fase 5.

### D-21 · Migraciones de la Fase 1 (RESUELTO)
**Estado:** RESUELTO. Bloqueaba temporalmente la validación de punta a punta por falta de un PostgreSQL alcanzable (Docker Desktop no estaba corriendo). Se inició Docker Desktop, se reactivó el contenedor local `agendia-postgres` y se aplicó la migración inicial (`20261112084852_init`) con `npx prisma migrate dev --name init`. El SQL generado coincide con `docs/DATABASE_DESIGN.md` (tablas, enums, índices únicos y foreign keys con cascada). El registro/login/recuperación de contraseña se probaron de punta a punta contra esta base — ver el informe de validación de la Fase 1.

### D-22 · Framework de tests
**Estado:** CONFIRMADO.
**Decisión:** Vitest para pruebas unitarias y de integración (`npm run test`), sin Jest ni Playwright todavía. Las pruebas de `lib/organization-access.ts` son unitarias puras; las de registro, recuperación de contraseña y aislamiento multi-tenant son de integración y corren contra la base de datos real de desarrollo (no hay una base de datos de test separada todavía), limpiando sus propios datos en cada `afterEach`.
**Motivo:** Vitest es liviano, rápido y no requiere configuración adicional para TypeScript/ESM, coherente con "no sobreingenierizar". Playwright (end-to-end real de UI) se evalúa para una fase posterior, cuando haya suficientes flujos de UI como para justificar esa infraestructura; mientras tanto, los flujos HTTP (registro, login, logout, recuperación de contraseña) se validaron manualmente contra `next dev` y quedan documentados en el informe de la Fase 1, no como suite automatizada todavía.

### D-12 · Estrategia operativa de backups
**Estado:** PENDIENTE (no bloqueante para el MVP, pero requerido antes de manejar datos reales de clientes).
**Contexto:** Neon ofrece backups automáticos/branching; falta definir frecuencia de verificación de restauración y procedimiento para la modalidad standalone (backup de PostgreSQL propio en Docker Compose).
**Próximo paso:** definir en la Fase 6 junto con la documentación de instalación.

---

## Confirmadas

### D-01 · Identidad comercial (nombre + identidad visual)
**Estado:** CONFIRMADO. Identidad visual inicial aprobada.
**Decisión:** nombre comercial **Agendia**; eslogan provisional «Tu agenda, más simple»; paleta celeste/blanco/grises (`primary #0284C7`, `primary light #E0F2FE`, `background #FFFFFF`, `surface #F8FAFC`, `border #E2E8F0`, `text #0F172A`); tipografía Geist; estilo SaaS premium minimalista, mobile-first, sin gradientes ni colores llamativos.
**Motivo:** desbloquea la Fase 1 y la construcción de la landing definitiva. La marca queda centralizada en `lib/brand.ts` (nombre, eslogan, planes) y los tokens de color en `app/globals.css`, para poder cambiarla sin modificar el resto del código.

### D-15 · Repositorio GitHub y política de commits
**Estado:** CONFIRMADO.
**Decisión:** repositorio remoto `https://github.com/AlejandroM12/agendia`, rama principal `main`. Commits en formato Conventional Commits, usando exclusivamente la identidad Git ya configurada localmente (`git config user.name`/`user.email`). Sin coautoría de IA ni referencias a herramientas de IA en los mensajes de commit. Sin `git push --force` sobre `main`, sin reescritura de historial remoto.
**Motivo:** requisito explícito del propietario del producto; mantiene la autoría del repositorio limpia y consistente con su flujo de trabajo habitual.

### D-16 · Gestor de paquetes
**Estado:** CONFIRMADO.
**Decisión:** npm, con `package-lock.json` como único lockfile.
**Motivo:** no existía un gestor previo; npm viene incluido con Node.js y evita sumar una herramienta adicional (pnpm/yarn) sin una razón técnica concreta.

### D-17 · Prisma 7: conexión a base de datos vía driver adapter
**Estado:** CONFIRMADO (detalle técnico, no una decisión de producto).
**Decisión:** Prisma 7 eliminó el soporte de `url` en el bloque `datasource` del `schema.prisma`. La conexión se configura en dos lugares separados: `prisma.config.ts` (usado por Migrate/Studio, carga `DATABASE_URL` desde `.env.local` vía `dotenv`) y `lib/db.ts` (runtime de la aplicación, usando `@prisma/adapter-pg` sobre el driver `pg`).
**Motivo:** es un cambio obligatorio de la versión estable de Prisma elegida (7.10.1), no una preferencia de diseño; se documenta para que no se confunda con un bug si una futura sesión lo encuentra inesperado.

### D-18 · Next.js 16: "Middleware" renombrado a "Proxy", y Cache Components
**Estado:** CONFIRMADO (detalle técnico).
**Decisión:** el archivo de protección de rutas se llama `proxy.ts` (antes `middleware.ts`), con el mismo propósito. Next.js 16 habilita por defecto `cacheComponents` (sucesor de PPR): cualquier ruta que lea la sesión (`cookies()`/`headers()`) sin estar detrás de un límite `<Suspense>` falla el build. Dado que `/dashboard`, `/admin` y `/restablecer-contrasena/[token]` son 100% dinámicas por diseño (contenido por-sesión o por-token, sin nada que ganar con prerenderizado estático), se optó por `export const instant = false` en esos segmentos en vez de introducir límites de Suspense — es la vía de migración incremental que la propia guía de Next.js recomienda, y evita complejidad innecesaria en una fase que todavía no tiene contenido cacheable real.
**Motivo:** cambio de plataforma, no de producto; se documenta para que una futura fase (cuando haya contenido genuinamente cacheable, como el listado de servicios públicos) evalúe adoptar el patrón completo de `Suspense` + `use cache: private` en vez de mantener `instant = false` indefinidamente.

### D-19 · Hashing de contraseñas
**Estado:** CONFIRMADO.
**Decisión:** `bcryptjs` (implementación en JavaScript puro) en lugar de `bcrypt` o `argon2` (ambos con bindings nativos).
**Motivo:** evita requerir herramientas de compilación nativa en cada entorno (desarrollo en Windows, CI, instalación standalone vía Docker), alineado con "facilidad de despliegue" sin resignar seguridad para este caso de uso.

### D-20 · Base de datos de desarrollo local
**Estado:** CONFIRMADO (detalle de entorno, no de infraestructura productiva).
**Decisión:** PostgreSQL 17 vía un contenedor Docker local (`agendia-postgres`, puerto `54330`) para desarrollo. No es un recurso de infraestructura productiva ni tiene costo.
**Motivo:** permite ejecutar migraciones y probar la aplicación localmente sin depender de Neon todavía (ver D-04), consistente con "no desplegar a producción ni crear recursos con costo" durante la Fase 1.

### D-02 · Stack tecnológico base
**Estado:** CONFIRMADO.
**Decisión:** Next.js (App Router), TypeScript, PostgreSQL, Prisma, Tailwind CSS, shadcn/ui.
**Motivo:** ecosistema maduro, un solo lenguaje full-stack, bajo costo operativo, despliegue simple, consistente con monolito modular (sin NestJS ni microservicios).

### D-03 · Proveedor de autenticación
**Estado:** CONFIRMADO.
**Decisión:** Auth.js (NextAuth v5), proveedor Credentials + adapter Prisma, con recuperación de contraseña (token de un solo uso, expiración corta) y seguridad de sesión (cookies `httpOnly`/`secure`/`sameSite`, hashing bcrypt/argon2, invalidación de sesión ante cambio de contraseña).
**Motivo:** es una librería, no un servicio alojado — funciona igual en SaaS y standalone sin dependencia externa; permite agregar OAuth más adelante sin rediseño.

### D-04 · Hosting inicial del SaaS
**Estado:** CONFIRMADO (como punto de partida; no se configura producción todavía).
**Decisión:** Vercel (aplicación) + Neon (PostgreSQL serverless).
**Motivo:** bajo costo operativo inicial, despliegue simple, buen soporte de Next.js App Router.

### D-05 · Zona horaria por defecto
**Estado:** CONFIRMADO.
**Decisión:** `America/Argentina/Buenos_Aires` como default al crear una organización, configurable por organización (campo `timezone`, formato IANA).
**Motivo:** mercado inicial de referencia; el modelo no limita a otras zonas horarias.

### D-06 · Firma de licencias standalone
**Estado:** CONFIRMADO como diseño; implementación en Fase 6.
**Decisión:** firma digital asimétrica Ed25519. Clave privada en nuestro poder (emisión), clave pública embebida en el software instalado (verificación local, sin red).
**Motivo:** verificación local sin dependencia de conectividad permanente, sin distribuir claves privadas.

### D-07 · Período de acceso tras vencimiento de la prueba gratuita
**Estado:** CONFIRMADO (provisional — "provisional" referido a que el número de días puede ajustarse comercialmente, no a la mecánica).
**Decisión:** 30 días de acceso de **solo lectura** tras el vencimiento de los 7 días de prueba (estado `trial_readonly`). Sin creación/modificación de turnos ni nuevas reservas públicas durante ese período. Sin eliminación automática de datos en ningún momento, ni en `trial_readonly` ni en el estado `locked` posterior.
**Motivo:** balance entre presión comercial para convertir y buena fe con el usuario (no perder acceso a sus datos de golpe).

### D-08 · Precios
**Estado:** CONFIRMADO.
**Decisión:** precios configurables vía modelo `Plan` en base de datos; sin cifras definitivas en esta etapa.
**Motivo:** evitar comprometer una estrategia de pricing antes de validarla comercialmente.

### D-09 · Orden de implementación: prueba gratuita vs. integración de pagos
**Estado:** CONFIRMADO.
**Decisión:** la activación y el vencimiento de la prueba gratuita se implementan junto con registro/onboarding (Fase 2). La integración real de cobros (Mercado Pago) se implementa en una fase posterior (Fase 5), aunque el modelo de datos y los webhooks idempotentes se diseñan desde ahora.
**Motivo:** permite validar el flujo de adquisición de usuarios (registro → prueba → uso) sin esperar a resolver la estrategia de cobro.

### D-13 · Procesamiento de notificaciones sin procesos persistentes serverless
**Estado:** CONFIRMADO.
**Decisión:** patrón outbox (tabla `Notification`) + invocación programada corta (Vercel Cron → `/api/cron/notifications` en modo SaaS; cron del contenedor o proceso Node en modo standalone, donde sí es viable un proceso persistente). Ver detalle en `ARCHITECTURE.md` sección 4.
**Motivo:** Vercel no soporta procesos de larga duración en sus funciones; todo el estado de las notificaciones debe vivir en base de datos, no en memoria de un proceso que podría no seguir corriendo entre invocaciones.

### D-14 · Landing comercial obligatoria en `/`
**Estado:** CONFIRMADO.
**Decisión:** la ruta `/` muestra siempre la landing comercial, nunca un login directo. Es parte obligatoria del MVP.
**Motivo:** la landing es el mecanismo de conversión de visitantes a usuarios; postergarla reduciría la capacidad de validar el producto comercialmente desde el lanzamiento.
