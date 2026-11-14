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
**Estado:** PENDIENTE (diseño propuesto en `docs/INFRASTRUCTURE.md` §8; falta aprobar la infraestructura de producción, D-23, antes de implementarlo).
**Contexto:** backup nativo del proveedor de base de datos (Railway/Neon, según se resuelva D-23) más un `pg_dump` diario propio e independiente (retención 7 diarios + 4 semanales), con un simulacro de restauración mensual. Para la modalidad standalone, el mismo esquema aplica contra el PostgreSQL propio en Docker Compose.
**Próximo paso:** implementar junto con la infraestructura de producción, una vez aprobada D-23.

---

## Confirmadas

### D-23 · Hosting de producción: VPS + Docker Compose (reemplaza a D-04)
**Estado:** CONFIRMADO. D-04 (Vercel + Neon) queda superada.
**Decisión:** un servidor propio con Docker Compose: `caddy` (HTTPS), `web`, `worker`, `migrate`, `postgres` y `backup` (ver `docker-compose.yml` y `docs/DEPLOYMENT.md`). La misma imagen sirve para el SaaS y para instalaciones independientes.
**Motivo:** operación continua sin suspensión por inactividad, costo fijo bajo, y un único empaquetado para las dos modalidades comerciales. No se contrató ni desplegó nada todavía.

### D-26 · Worker: proceso que dispara un "tick" de la aplicación (ajusta D-13)
**Estado:** CONFIRMADO.
**Decisión:** el `worker` es un proceso mínimo (`scripts/worker.mjs`) que cada minuto llama a `POST /api/internal/tick` con `CRON_SECRET`. La lógica y el estado (outbox de notificaciones con bloqueo `FOR UPDATE SKIP LOCKED`, vencimiento de pruebas, reconciliación de pagos) viven en la app y en la base. Caddy bloquea `/api/internal/*` desde Internet.
**Motivo:** separa el trabajo en segundo plano del servidor web sin duplicar el código de dominio ni sumar una cola externa; si el worker se cae, al volver procesa lo pendiente.

### D-27 · Página pública en la raíz: `/[slug]` (reemplaza `/reservar/[slug]`)
**Estado:** CONFIRMADO.
**Decisión:** el enlace de reservas es `dominio/nombre-del-negocio`. Los slugs no pueden coincidir con rutas de la app ni con una lista de nombres reservados (`lib/slug.ts`). El cliente gestiona su turno en `/turno/[token]` (token opaco).
**Motivo:** un enlace más corto y fácil de compartir, que es el principal canal de adquisición de reservas.

### D-28 · Rate limiting en PostgreSQL (resuelve D-10)
**Estado:** CONFIRMADO.
**Decisión:** ventana fija con un UPSERT atómico en la tabla `rate_limits` (`lib/rate-limit.ts`), aplicado a login, registro, recuperación de contraseña, disponibilidad pública, reserva y gestión por token.
**Motivo:** funciona igual con una o varias instancias y no agrega Redis.

### D-29 · Reservas simultáneas: lock por profesional + exclusion constraint
**Estado:** CONFIRMADO.
**Decisión:** cada alta o reprogramación toma un advisory lock transaccional por profesional y la constraint `appointments_no_overlap` es la garantía final. Los conflictos transitorios se reintentan.
**Motivo:** con solo la constraint, ráfagas de reservas simultáneas terminaban en deadlocks lentos; el lock las pone en fila y la respuesta "horario ocupado" es inmediata.

### D-30 · Precios de referencia y alta manual
**Estado:** REEMPLAZADO por D-32 en cuanto a los valores; la activación manual desde `/admin` sigue vigente.
**Decisión:** plan mensual ARS 7.900 (editable desde `/admin`, tabla `plans`) y licencia de pago único ARS 99.000 (por consulta). Mientras Mercado Pago no tenga credenciales, el plan se activa manualmente desde `/admin`.
**Motivo:** permite vender desde el primer día sin depender de la integración de pagos.

### D-31 · Nueva identidad visual
**Estado:** CONFIRMADO (reemplaza la paleta celeste de D-01; el nombre y el eslogan no cambian).
**Decisión:** "papel y tinta": fondo de papel cálido, verde pino como color de acción, terracota como único acento, títulos en Fraunces e interfaz en Geist. Tokens en `app/globals.css`, tipografías en `app/layout.tsx`, textos y precios en `lib/brand.ts`.
**Motivo:** una identidad propia y reconocible, lejos de la plantilla de panel administrativo.

### D-32 · Precios definitivos y condiciones de la licencia
**Estado:** CONFIRMADO.
**Decisión:** dos modalidades con el mismo peso comercial. **Plan Profesional:** ARS 9.900 por mes, 14 días de prueba, hosting y soporte incluidos. **Licencia independiente:** ARS 149.000, pago único, licencia de uso permanente, instalación y configuración incluidas, hosting, dominio y soporte incluidos durante 12 meses, instalación independiente y sin entrega del código fuente. Las condiciones de renovación de los servicios anuales se muestran antes de comprar (landing, `/precios`, `/licencia` y casilla de aceptación en el formulario); el valor de la renovación se publica con `PRICE_LICENSE_RENEWAL`. Las cards comerciales no mencionan actualizaciones.
**Motivo:** decisión comercial del dueño.

### D-33 · Compra de la licencia por Mercado Pago
**Estado:** CONFIRMADO.
**Decisión:** la licencia se compra en `/licencia` con un pago único de Checkout Pro. La orden (`license_orders`) solo pasa a pagada con un pago aprobado consultado a la API (webhook `payment`, retorno del checkout o reconciliación), por el importe y la moneda de la orden. La instalación se crea después, a mano, con `deploy/instance.sh`.
**Motivo:** mismo criterio que las suscripciones: nunca confiar en el navegador ni en el cuerpo del webhook.

### D-34 · Las licencias se alojan en el servidor de la plataforma
**Estado:** CONFIRMADO (revisable si una instalación necesita recursos propios).
**Decisión:** como la licencia incluye 12 meses de hosting, cada instalación independiente corre en el mismo VPS que el SaaS como un proyecto de Docker Compose aparte: base de datos, secretos, contenedores y copias propios, detrás del proxy HTTPS compartido. `deploy/docker-compose.standalone.yml` también sirve para un servidor separado (perfil `proxy`).
**Motivo:** un servidor por licencia costaría más que lo que deja la licencia; el aislamiento de datos se mantiene porque no se comparte ni la base ni el proceso.

### D-35 · Verificación de email obligatoria
**Estado:** CONFIRMADO.
**Decisión:** una cuenta nueva no puede usar la aplicación hasta abrir el enlace de verificación (token de un uso, 48 horas, guardado como hash). Restablecer la contraseña desde el email también confirma la casilla. Sin canal de email (desarrollo, pruebas) la cuenta nace verificada. `admin:grant` exige una cuenta verificada.
**Motivo:** impide registrar cuentas con el email de otra persona y garantiza que la recuperación de contraseña llegue a su dueño.

### D-36 · Página pública personalizable sin CSS del usuario
**Estado:** CONFIRMADO.
**Decisión:** cada negocio elige dos colores (hexadecimales validados), una tipografía entre cinco opciones y sus datos de contacto. `lib/theme.ts` calcula a partir de eso las variables de color de la página y garantiza contraste AA: un color claro se usa tal cual en botones y portada, y oscurecido en textos y bordes. No se acepta CSS, HTML ni fuentes arbitrarias. La personalización está incluida en el plan actual y funciona igual en modo standalone.
**Motivo:** identidad propia para cada negocio sin abrir la puerta a inyección de estilos ni a páginas ilegibles.

### D-37 · Imágenes en PostgreSQL
**Estado:** CONFIRMADO (revisable si el volumen crece).
**Decisión:** logo y portada se validan por contenido, se reescalan y se guardan como WebP en la tabla `organization_images` (≈ 20 KB y ≈ 150 KB). Se sirven por `/api/media/<id>` con caché inmutable; reemplazar una imagen crea un id nuevo y borra la anterior en la misma transacción.
**Motivo:** persisten sin depender del disco del contenedor, entran en los mismos backups y restauraciones que el resto de los datos, funcionan en las instalaciones independientes sin configuración y no requieren servicios ni credenciales nuevas. Con 100 negocios ocupan unos 20 MB. Alternativas descartadas: volumen de Docker (habría que sumarlo a los backups y a cada instalación) y object storage (costo y credenciales nuevas). `modules/public-page/images.ts` es el único punto a cambiar para migrar.

### D-38 · Enlaces anteriores al cambiar el identificador
**Estado:** CONFIRMADO.
**Decisión:** al cambiar el identificador de URL, el anterior queda como alias (`organization_slug_aliases`) y redirige (307) al actual, incluidas las subrutas. Un alias no puede ser tomado por otro negocio. Se conservan los 5 más recientes por negocio.
**Motivo:** no romper enlaces ni códigos QR ya compartidos, sin permitir que un negocio acapare identificadores indefinidamente.

### D-39 · «Consultá tus turnos» con enlace temporal por email
**Estado:** CONFIRMADO.
**Decisión:** el cliente ingresa su email en `/<negocio>/mis-turnos` y, solo si tiene turnos en ese negocio, recibe un enlace válido por 60 minutos. La respuesta en pantalla es siempre la misma y el envío ocurre después de responder. El token se guarda como hash, vale para un negocio y un email, se puede abrir más de una vez dentro de su vigencia y se invalida al pedir otro. Límites: 8 pedidos por hora por IP y 3 por hora por casilla y negocio. Cancelar y reprogramar reutilizan la página existente `/turno/<token>`.
**Motivo:** acceso sin cuenta ni contraseña, sin exponer quién es cliente de un negocio ni datos personales a quien no controla la casilla.

### D-40 · Un solo patrón para enviar formularios
**Estado:** CONFIRMADO.
**Decisión:** todos los formularios usan `useForm` (`components/form/use-form.ts`): el envío se hace con `onSubmit`, no con `<form action={…}>`. Valida en el navegador (restricciones nativas con mensajes en español y, donde hay, el mismo esquema Zod del servidor), muestra cada error debajo de su campo, lleva el foco al primero, convierte los fallos de red en un mensaje e ignora envíos repetidos. El servidor valida siempre. Los requisitos de contraseña tienen una única definición (`lib/password-rules.ts`) de la que salen el esquema y los indicadores en pantalla.
**Motivo:** con `<form action>` React reinicia los campos no controlados cada vez que la acción termina, también cuando devuelve un error: la persona perdía lo que había escrito. Sin librerías nuevas.

### D-41 · No comunicar «sin tarjeta»
**Estado:** CONFIRMADO.
**Decisión:** los textos visibles no mencionan tarjetas para describir la prueba; se comunica «14 días gratis». La lógica de la prueba y de los pagos no cambia.
**Motivo:** decisión comercial del dueño.

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

### D-24 · Row-Level Security como segunda capa de aislamiento multi-tenant
**Estado:** DIFERIDO. El aislamiento actual es por aplicación: toda consulta y toda escritura filtra por el `organizationId` resuelto en el servidor (`lib/dal.ts`, `updateMany`/`deleteMany` con `organizationId`), con tests de aislamiento. RLS exige un rol de base separado y envolver cada consulta en una transacción con `SET LOCAL`, incluidas las públicas y las del worker (que cruzan organizaciones por diseño); se retoma cuando haya equipos por organización o más de un desarrollador.
**Decisión:** además del filtrado por `organizationId` ya implementado en `lib/dal.ts`, agregar policies RLS de PostgreSQL sobre las tablas operativas (`appointments`, `customers`, `services`, etc.), usando `SET LOCAL app.current_organization_id` por transacción. Ver `docs/SECURITY.md` §1.
**Motivo:** una segunda capa de aislamiento que no depende de que cada query de aplicación recuerde filtrar correctamente — PostgreSQL se convierte en el árbitro final, no solo el código.

### D-25 · CI/CD con GitHub Actions, staging separado y migraciones manuales a producción
**Estado:** CONFIRMADO como diseño; implementación cuando se apruebe la infraestructura de producción (D-23).
**Decisión:** GitHub Actions corre lint/typecheck/test/build en cada PR (sin deploy). El deploy a producción es automático vía la integración nativa de la plataforma al hacer merge a `main`, pero `prisma migrate deploy` contra la base de producción requiere una aprobación manual explícita — nunca migra solo. Staging usa una base de datos completamente separada. Ver `docs/INFRASTRUCTURE.md` §6.
**Motivo:** evita que una migración destructiva llegue a producción sin que un humano la confirme, sin renunciar a que el resto del pipeline sea automático.

### D-02 · Stack tecnológico base
**Estado:** CONFIRMADO.
**Decisión:** Next.js (App Router), TypeScript, PostgreSQL, Prisma, Tailwind CSS, shadcn/ui.
**Motivo:** ecosistema maduro, un solo lenguaje full-stack, bajo costo operativo, despliegue simple, consistente con monolito modular (sin NestJS ni microservicios).

### D-03 · Proveedor de autenticación
**Estado:** CONFIRMADO.
**Decisión:** Auth.js (NextAuth v5), proveedor Credentials + adapter Prisma, con recuperación de contraseña (token de un solo uso, expiración corta) y seguridad de sesión (cookies `httpOnly`/`secure`/`sameSite`, hashing bcrypt/argon2, invalidación de sesión ante cambio de contraseña).
**Motivo:** es una librería, no un servicio alojado — funciona igual en SaaS y standalone sin dependencia externa; permite agregar OAuth más adelante sin rediseño.

### D-04 · Hosting inicial del SaaS
**Estado:** SUPERADA por D-23.
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
**Decisión:** 30 días de acceso de **solo lectura** tras el vencimiento de los 14 días de prueba (estado `trial_readonly`). Sin creación/modificación de turnos ni nuevas reservas públicas durante ese período. Sin eliminación automática de datos en ningún momento, ni en `trial_readonly` ni en el estado `locked` posterior.
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

### D-42 · Equipos: agenda propia por profesional, apagado por defecto
**Estado:** CONFIRMADO (etapa 1 implementada; ver `docs/MULTI_PROFESSIONAL.md`).
**Decisión:** cada profesional tiene sus horarios, sus turnos y sus bloqueos; los bloqueos generales (sin profesional) afectan a todos. El modo equipo se activa por negocio (`Organization.teamModeEnabled`, con `scripts/team-mode.mjs`) o para toda la instalación (`TEAM_MODE_ENABLED=1`) y está apagado por defecto: apagado, el negocio se comporta como con un único profesional aunque la base tenga más filas. Un negocio con un solo profesional conserva exactamente la experiencia y la disponibilidad de antes.
**Motivo:** poder atender a barberías, estéticas y consultorios sin arriesgar a los negocios en producción ni cambiar lo que ya funciona.

### D-43 · Planes por cupo de profesionales activos
**Estado:** CONFIRMADO (capacidades en `lib/plans.ts`; precios y cobro no cambian).
**Decisión:** Plan Profesional hasta 2 profesionales activos, Plan Equipo hasta 5, la prueba gratuita hasta 2. La cuenta administrativa que no atiende y los profesionales desactivados no ocupan cupo; el dueño que atiende sí. `Organization.extraProfessionals` permite ampliaciones futuras. Los límites se validan en el servidor, con un lock por organización para que altas o reactivaciones simultáneas no los superen. Una reducción de plan nunca borra ni desactiva nada: bloquea altas y reactivaciones y deja al administrador elegir a quién desactivar.
**Motivo:** la diferencia entre planes es la escala del equipo, no las funcionalidades.

### D-44 · Asignación automática por menor carga, con un lock por profesional
**Estado:** CONFIRMADO.
**Decisión:** con «cualquier profesional» se asigna el elegible libre con menos turnos activos ese día, con desempate determinista (orden del equipo). Los candidatos se prueban de a uno, cada uno en su transacción con el lock de ese profesional; nunca se toman dos locks de profesional a la vez. La restricción de exclusión por profesional sigue siendo la garantía final. Los reintentos y dobles envíos se resuelven con una clave de idempotencia por formulario.
**Motivo:** reparto parejo y predecible, sin deadlocks ni duplicados.

### D-45 · Migración aditiva con trigger de compatibilidad
**Estado:** CONFIRMADO.
**Decisión:** `team_foundation` solo agrega estructura y rellena `professionalId` de los horarios con el profesional original; las claves foráneas son compuestas `(organizationId, id)` para que la base impida cruces entre organizaciones; los turnos ya no se borran en cascada al borrar un profesional. La columna de los horarios queda opcional y un trigger la completa para la versión anterior de la aplicación, de modo que el rollback sea seguro mientras el modo equipo esté apagado. La restricción obligatoria llega en una migración de cierre posterior.
**Motivo:** poder volver atrás sin pérdida de datos durante el lanzamiento.

### D-46 · Métricas de consumo con las tablas existentes
**Estado:** CONFIRMADO.
**Decisión:** el consumo por negocio (profesionales activos, turnos, correos por estado, tipo y reintentos) se calcula con `notifications`, `appointments` y `professionals`, y se muestra en `/admin`. Sin analítica externa ni infraestructura nueva.
**Motivo:** los correos son el único costo variable y hay que verlo antes de definir planes.

### D-47 · Oferta comercial vigente: ARS 9.900 mensual, licencia ARS 149.000, prueba de 14 días
**Estado:** CONFIRMADO. Reemplaza los importes y la prueba de D-32 (ARS 14.000 / 199.000 / 7 días).
**Decisión:** Plan Profesional ARS 9.900 por mes con 14 días de prueba, sin permanencia, configuración inicial asistida, hosting y soporte. Licencia independiente ARS 149.000 de pago único: uso permanente, instalación y configuración, base de datos propia, sin código fuente, y hosting, dominio y soporte durante los primeros 12 meses; desde el segundo año se renuevan por separado y **el precio de esa renovación no está definido** (no se publica). Sin suscripción anual ni descuentos. Todo vive en `lib/brand.ts` (`pricing`, `trialPolicy`, `licenseTerms`). Las pruebas ya iniciadas y las suscripciones activas no se tocan: el vencimiento de la prueba se calcula al registrarse y cada suscripción guarda su propio importe.
**Oferta futura (definida, no publicada):** Equipo mensual ARS 19.900 (hasta 5 profesionales), Licencia Profesional ARS 149.000 (hasta 2), Licencia Equipo ARS 249.000 (hasta 5); en `futurePricing`, sin uso en ninguna página. La prueba admitirá hasta 2 profesionales activos.

### D-48 · Permisos centralizados en el servidor
**Estado:** CONFIRMADO.
**Decisión:** `lib/permissions.ts` define qué puede hacer cada rol y `requireWriteContext(permiso)` / `requirePermission(permiso)` (lib/dal.ts) lo exige en cada acción de equipo, horarios, turnos, servicios y clientes, leyendo el rol de la base. Un rol desconocido no puede nada. Hoy `owner` y `admin` pueden todo; las cuentas de profesionales siguen sin habilitarse (etapa 4).

### D-49 · Reasignación explícita y desactivación con turnos resueltos
**Estado:** CONFIRMADO.
**Decisión:** un profesional con turnos futuros no se desactiva hasta que el administrador los pase a otro profesional (validado: activo, realiza el servicio, horario libre) o los cancele, uno por uno o todos juntos. Nada se reasigna ni se cancela solo; el historial se conserva; el cliente recibe un correo propio de «cambió el profesional» (`professional_change`).

### D-50 · WhatsApp manual gratuito con wa.me; el automático queda como diseño
**Estado:** CONFIRMADO (manual implementado; automático solo documentado en `docs/WHATSAPP_AUTOMATION.md`).
**Decisión:** mensajes preparados que el negocio revisa y envía desde su propio WhatsApp; Agendia no envía, no registra envíos ni muestra estados de entrega, y no usa proveedores. Mensajes sin datos sensibles y con versión discreta.

### D-51 · La migración de cierre de `availability_rules.professionalId` NO se aplica todavía
**Estado:** CONFIRMADO.
**Decisión:** producción corre una versión anterior que inserta horarios sin profesional; el trigger de compatibilidad y la columna opcional son lo que permite volver atrás. Se aplicará (columna obligatoria, sin trigger) solo cuando la versión con equipos esté en producción, estable y sin necesidad de rollback.

### D-52 · Reserva pública con elección de profesional
**Estado:** CONFIRMADO (implementada, deshabilitada por defecto con el modo equipo).
**Decisión:** el paso de profesional aparece solo con dos o más opciones reales, calculadas con la misma regla que valida la reserva; «Cualquier profesional» usa el motor y la asignación de la etapa 1. Reprogramar respeta la intención del cliente: quien eligió a alguien lo conserva (o se le informa que ya no está disponible); quien eligió «cualquiera» conserva al vigente si puede y, si no, se le avisa el cambio. La reasignación del negocio no cambia lo que el cliente pidió.

### D-53 · Rollback no destructivo
**Estado:** CONFIRMADO.
**Decisión:** para volver a una versión anterior con filas que esta no entiende (fotos de profesionales, avisos de cambio de profesional) se usa `scripts/prepare-rollback.mjs`, que las aparta en tablas de respaldo y se puede revertir; borrar filas no es parte del procedimiento. La reducción del Plan Equipo con exceso de profesionales queda **sin implementar** hasta que el dueño apruebe una política (alternativas en `docs/MULTI_PROFESSIONAL.md` §15.10).

