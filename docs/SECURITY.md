# Seguridad y multi-tenancy en producción — Agendia

> Este documento profundiza, para el contexto de producción, los puntos que `ARCHITECTURE.md` §10 ya enumera como requisitos transversales. No repite lo que ya está resuelto en la Fase 1 (hashing de contraseñas, cookies de sesión, validación con Zod, tokens opacos) — se enfoca en lo que falta reforzar antes de aceptar clientes reales: aislamiento multi-tenant en profundidad, protección a escala de endpoints públicos, y manejo de secretos en un entorno de CI/CD real.

## 1. Aislamiento multi-tenant: dos capas, no una sola

**Hoy (Fase 1):** el aislamiento es enteramente de aplicación — todo acceso a datos pasa por `lib/dal.ts`, que resuelve el `organizationId` siempre desde la sesión del servidor, nunca desde un parámetro del cliente (ver `lib/dal.ts` y los tests de `test/organization-isolation.test.ts`). Es un diseño correcto, pero es una sola capa: un error humano futuro (un query que se olvida de filtrar por `organizationId`) no tiene una segunda red de seguridad.

**Propuesta para cuando existan entidades operativas (Fase 3 — `Appointment`, `Customer`, `Service`, etc.):** agregar **Row-Level Security (RLS) de PostgreSQL** como segunda capa, independiente del código de la aplicación:

1. Cada tabla con datos de organización (`appointments`, `customers`, `services`, etc.) tiene una policy RLS que exige `organization_id = current_setting('app.current_organization_id')::uuid`.
2. Al abrir cada transacción de Prisma, la aplicación ejecuta `SET LOCAL app.current_organization_id = '<id>'` con el id resuelto por `lib/dal.ts` — nunca con un valor que venga del cliente.
3. Aunque una consulta de aplicación se olvide del filtro por `organizationId`, PostgreSQL de todas formas no devuelve filas de otra organización.

Esto no reemplaza el filtrado explícito en el código (sigue siendo la primera línea de defensa, y la más fácil de razonar al leer el código) — es una capa adicional que no depende de que cada desarrollador la recuerde en cada query nueva. Se implementa junto con el esquema de la Fase 3, no antes, porque hoy no hay ninguna tabla operativa a la que aplicarle una policy.

## 2. Prevención de reservas simultáneas (reconfirmación para producción)

El diseño ya documentado en `ARCHITECTURE.md` §5 —constraint de exclusión de PostgreSQL sobre `(professionalId, tsrange(startsAt, endsAt))`— es una garantía de la base de datos, no de la aplicación. Esto importa especialmente en producción porque:

- **Es agnóstica a cuántas instancias de la app estén corriendo.** Si en el futuro la app web escala horizontalmente (varias instancias de Next.js detrás de un balanceador), la constraint sigue siendo válida sin ningún cambio ni coordinación entre instancias — PostgreSQL es el único árbitro.
- **No depende de locks distribuidos ni de Redis.** No hay que introducir infraestructura adicional para mantener esta garantía a medida que el sistema crece.

No se propone ningún cambio a este diseño — se reconfirma que sigue siendo válido en cualquiera de las opciones de hosting evaluadas en `INFRASTRUCTURE.md`.

## 3. Rate limiting en producción

Diseño actual (`ARCHITECTURE.md` §6, decisión pendiente D-10): contador en base de datos o en memoria, sin Redis obligatorio. Para producción:

- **Mientras la app corra en una sola instancia** (el caso inicial en cualquiera de las tres opciones de hosting), el diseño actual alcanza sin cambios.
- **Si la app escala a múltiples instancias** (Railway y Vercel lo permiten con un clic; en VPS requeriría agregar un balanceador), un contador en memoria por instancia deja de ser confiable — cada instancia vería solo una fracción de los intentos. En ese momento, migrar a un store compartido (Redis administrado) es la corrección correcta, sin cambiar la interfaz del rate limiter en el código.
- Los endpoints a proteger en producción, como mínimo: `/login` (fuerza bruta de contraseñas), `/registro` (spam de cuentas), `/reservar/[slug]` y sus acciones (abuso de reservas públicas), `/olvide-contrasena` (enumeración de emails y spam de envíos), y el webhook de Mercado Pago (validar primero la firma, `SECTION 5` de `INFRASTRUCTURE.md`, antes de cualquier otro procesamiento, para que una request sin firma válida ni siquiera consuma trabajo de negocio).

No se activa Redis hoy — se documenta el punto de activación (D-10) para no tener que rediseñar cuando llegue el momento.

## 4. Enumeración de cuentas y filtrado de información

Ya implementado y verificado en la Fase 1 (`modules/auth/password-reset.ts`, `test/password-reset.test.ts`): la recuperación de contraseña responde igual exista o no la cuenta, para no revelar qué emails están registrados. El mismo principio debe mantenerse al agregar, en fases futuras:
- Mensajes de error de login (ya cumplido: "Email o contraseña incorrectos", sin distinguir cuál de los dos falló).
- Cualquier endpoint público nuevo que reciba un email o identificador (ej. reserva pública): nunca confirmar o negar la existencia de un dato con mensajes distintos según el caso.

## 5. Secretos y credenciales en CI/CD

Ampliado en `INFRASTRUCTURE.md` §7. Principios de seguridad específicos:
- Secretos de staging y producción **nunca** se comparten — un secreto de staging comprometido no debe dar acceso a datos reales de clientes.
- El workflow de GitHub Actions nunca imprime un secreto en los logs (evitar `echo $SECRET` o similar en cualquier paso).
- `MERCADOPAGO_WEBHOOK_SECRET` se usa exclusivamente para validar la firma de los webhooks — nunca se reutiliza como si fuera el `MERCADOPAGO_ACCESS_TOKEN` (son credenciales con propósitos distintos, y tratarlas como intercambiables sería un error de seguridad real, no solo de estilo).
- Rotación documentada como procedimiento, no solo como posibilidad: `AUTH_SECRET` (invalida sesiones activas), credenciales de Mercado Pago, y la contraseña de la base de datos — cada una con su propio runbook antes del lanzamiento comercial.

## 6. Auditoría

`ARCHITECTURE.md` §10 ya define la tabla `AuditLog` para cambios de estado de turno, cambios comerciales y acciones de administración SaaS. Para producción, se agrega un criterio concreto: toda acción ejecutada desde `/admin` (suspender/reactivar una cuenta, modificar un plan, etc.) **debe** quedar registrada en `AuditLog` con el `userId` del administrador que la ejecutó — no es opcional ni se puede omitir "por ahora", porque es la única forma de reconstruir qué pasó si una cuenta de cliente reporta un problema comercial.

## 7. Qué queda explícitamente fuera de esta revisión

- Un test de penetración formal o una auditoría de seguridad externa — razonable antes de manejar pagos reales en volumen (Fase 5 en adelante), no antes.
- Cifrado de datos en reposo más allá de lo que el proveedor de base de datos ya ofrece por defecto — revisar si algún requisito regulatorio específico lo exige, una vez que haya claridad sobre el mercado objetivo.
- Un WAF (Web Application Firewall) dedicado — las plataformas evaluadas en `INFRASTRUCTURE.md` ya incluyen protecciones básicas de borde; se reevalúa si el volumen de tráfico abusivo lo justifica.

## Equipos y roles (pendiente)

Hoy los roles `owner` y `admin` no se verifican en ningún punto del código y todo miembro puede todo; es inocuo porque solo existe el dueño (no hay invitaciones). **Antes de habilitar cuentas de profesionales** hay que resolver los cinco riesgos descriptos en `docs/MULTI_PROFESSIONAL.md` §10 (roles sin verificación, una membresía por usuario, avisos internos a todas las membresías, consultas sin alcance por profesional, acciones que validan escritura y no rol). Las claves foráneas compuestas `(organizationId, id)` ya impiden, en la base de datos, asociar turnos, horarios, bloqueos y servicios con profesionales de otra organización.

## Cuentas, roles e invitaciones (etapa 4)

Los riesgos de roles que seguían abiertos (`docs/MULTI_PROFESSIONAL.md` §10) quedaron resueltos: el rol se verifica en el servidor en cada acción y página (`lib/permissions.ts`, `lib/dal.ts`); una persona puede tener varios negocios con el activo resuelto en el servidor; los avisos internos van al destinatario correcto; y toda consulta de turnos y clientes pasa por `modules/access/scope.ts`. Las invitaciones usan tokens aleatorios guardados como hash, de un solo uso y con vencimiento. Detalle, límites y riesgos restantes en `docs/AUTH_AND_ACCESS.md`.


## Revisión de seguridad previa al lanzamiento (etapa 5)

**Alcance y método.** Revisión del código y de las pruebas existentes más pruebas nuevas, todo **local**: no se hizo un test de penetración, no se atacó ningún servidor y no se tocó producción. Etiquetas: **Verificado** (hay una prueba o una lectura del código que lo confirma) · **Corregido** (se encontró y se arregló) · **Pendiente**.

### Hallazgos y correcciones
1. **Corregido — páginas de plataforma protegidas solo por el layout.** `/admin` y `/admin/negocios/<id>` dependían de `app/(admin)/admin/layout.tsx`. Un layout no se vuelve a evaluar al navegar entre páginas, así que la comprobación pasó a hacerse **también dentro de cada página** (`requireContext` + `canAccessPlatformAdmin`), y las acciones de plataforma ya la repetían. Prueba E2E: un usuario común recibe 404 en ambas rutas y no ve datos.
2. **Corregido — enlaces de invitación sin correo.** `ALLOW_INVITATIONS_WITHOUT_EMAIL` ya no puede activarse por error: solo vale con el servidor en `localhost` y **nunca** en una instalación independiente (`lib/test-flags.ts`, `test/test-flags.test.ts`). Una variable olvidada en producción o en una licencia no tiene efecto. (`ALLOW_REGISTRATION_WITHOUT_EMAIL` solo abre el registro, no revela secretos; sigue siendo para pruebas y *staging*.)
3. **Corregido — sesiones que no se podían cerrar de a una.** Antes, cerrar sesión invalidaba todas las sesiones de la persona. Ahora cada inicio de sesión es una fila revocable (`user_sessions`) con descripción corta del dispositivo (sin IP ni *user agent* completo); se puede cerrar una, o «las demás», y un cambio de contraseña sigue cerrándolas todas. Un `sid` ajeno no sirve para entrar ni para revocar. Compatible con Auth.js (JWT + comprobación en el servidor); no debilita nada: las sesiones anteriores a la tabla siguen regidas por `sessionVersion`. **Rollback:** una versión anterior no consulta esa tabla, por eso `prepare-rollback` sube `sessionVersion` a quien tenga sesiones revocadas.
4. **Corregido — auditoría incompleta.** Ahora quedan registrados (quién, qué, sobre qué, sin datos personales ni motivos escritos): horarios, copia de horarios, bloqueos (alta y baja), reglas de reserva, servicios de un profesional, alta de profesionales en el onboarding, cancelación y reprogramación de turnos desde el panel, revocación de sesiones, cambios y conciliación de suscripciones, selección de profesionales ante un exceso de cupo, habilitación de funciones y alineación de precios (plataforma). Ya existían los de equipo, permisos, invitaciones, accesos y administración de cuentas. Los scripts de operación (`team-mode`, `grant-admin`, `create-reset-link`) ya insertaban su auditoría.
5. **Verificado — aislamiento entre negocios.** Toda consulta pasa por `lib/dal.ts` (el negocio activo sale de la sesión y de las membresías vigentes, la cookie es solo una pista) y por `modules/access/scope.ts`; las claves foráneas compuestas `(organizationId, id)` y la restricción de exclusión de turnos son la segunda capa en la base. Código nuevo de la etapa 5: ninguna acción recibe un `organizationId` del navegador (usan el del contexto); `setKeepSelection` valida que los profesionales sean activos del negocio; las sesiones se buscan siempre dentro de las del usuario; las acciones de plataforma exigen `isPlatformAdmin`. Pruebas: `tenant-isolation`, `active-organization`, `capacity`, `user-sessions`, `admin-overview`.
6. **Verificado — permisos por profesional.** Un profesional ve solo su agenda y los clientes con los que tiene o tuvo turnos; los permisos finos (crear, reprogramar, cancelar, resultado, contacto, bloqueos, horarios, ver agenda del equipo) los decide el propietario y se leen de la base en cada pedido. Un profesional **restringido por exceso de cupo** conserva sus turnos confirmados y sus permisos, pero no recibe reservas nuevas. Sin permiso de facturación no se ve ningún mensaje comercial (`AccountBanner`).
7. **Verificado — rate limiting.** Registro (8/h por IP), ingreso (30 por IP y 10 por cuenta cada 15 min), recuperación de contraseña, verificación de email, compra de licencia, consulta de turnos por email, reservas públicas, invitaciones (aceptación y alta) y cambios de turno por enlace. El contador está en PostgreSQL (`rate_limits`), válido mientras haya **una sola instancia web**. El webhook de Mercado Pago no tiene límite propio: valida la firma antes de hacer cualquier trabajo. `/api/internal/tick` exige `CRON_SECRET` con comparación en tiempo constante.
8. **Verificado — webhooks.** Firma HMAC con ventana de 10 minutos, evento único e idempotente, estado siempre consultado a la API, importe y organización verificados (`docs/MERCADOPAGO.md` §3).
9. **Verificado — registros (logs).** No hay `console.log`/`info` en el código de la aplicación; los `console.error` registran identificadores y mensajes de error, no contraseñas, tokens ni enlaces de invitación (los enlaces nunca se registran). Un error de envío puede incluir la dirección del destinatario: la ficha de plataforma la oculta antes de mostrarla. *Pendiente:* revisar los logs reales de Docker en el primer piloto.
10. **Verificado — invitaciones.** Token aleatorio guardado como hash, un solo uso, vencimiento, una pendiente por perfil y por correo, el correo de quien acepta debe coincidir, el rol se valida en el servidor, y revocar corta el acceso en el siguiente pedido.
11. **Verificado — cuenta suspendida o en solo lectura.** Los turnos ya confirmados siguen pudiéndose cancelar y cerrar en solo lectura; una cuenta suspendida no puede nada.

### Acceso histórico de los profesionales a clientes
**Situación:** un profesional con cuenta ve a todo cliente con el que tiene **o tuvo** algún turno, y su historial **con él** (no el de otros profesionales), sin límite de antigüedad. No ve notas internas del negocio. El teléfono lo ve solo si tiene el permiso de contacto.
**Consecuencias:** un profesional que deja el negocio pierde el acceso al revocarle la cuenta (inmediato); mientras sigue activo conserva acceso a clientes que atendió hace años. Es razonable para continuidad clínica y de servicio, pero amplía la superficie de datos personales, y en salud y psicología son **datos sensibles**.
**Opciones** (no se implementó ninguna; **no se fijó ningún plazo**):
- A. Mantener (hoy). Simple; el propietario controla quién tiene cuenta.
- B. Permiso opcional «ver solo clientes con turnos recientes o futuros» configurable por el propietario, con el período que él elija (sin valor predeterminado inventado).
- C. Ocultar el contacto de clientes sin turnos futuros, conservando el historial.
- D. Revisión periódica asistida: listar profesionales con acceso a clientes que no atienden hace mucho.
**Recomendación:** B + C como mejora posterior, definiendo el criterio con asesoramiento legal (`docs/LEGAL_REVIEW.md`). **Nunca** borrar historial por este motivo. *Pendiente de decisión.*

### Protección de datos personales
- Se guardan solo los datos necesarios (nombre, contacto, turnos, notas internas opcionales). No hay datos de tarjeta. Contraseñas con hash (bcrypt); tokens (invitación, recuperación, verificación, gestión de turno, acceso del cliente) con hash o aleatorios largos con vencimiento donde corresponde.
- **WhatsApp manual:** el mensaje nunca incluye notas, motivo de consulta, precio ni nombre del servicio; hay un modo discreto para salud.
- **Auditoría y administración de plataforma:** sin datos de clientes, notas, motivos ni credenciales.
- **Pendiente (legal):** política de privacidad, base de datos ante la autoridad de aplicación, conservación y eliminación, y datos sensibles de salud (ver `docs/LEGAL_REVIEW.md`). **No se fijaron plazos de eliminación.**

### Autenticación en dos pasos (2FA): evaluación, no implementada
- **Riesgo que cubre:** robo o reutilización de la contraseña del propietario o de un administrador (acceso a clientes, facturación y cuentas del equipo).
- **Opciones:** (1) TOTP (app autenticadora) opcional para propietarios y administradores, con códigos de recuperación; (2) código por correo (peor: el correo es el mismo canal de recuperación de contraseña); (3) *passkeys* (WebAuthn): mejor experiencia y más seguridad, más trabajo e interacción con Auth.js.
- **Costos y riesgos:** quedarse sin acceso (hace falta recuperación asistida y soporte), una columna y tabla de secretos cifrados, interacción con la revocación de sesiones, y no hay dependencia hoy. La verificación de email al registrarse y el rate limiting por cuenta ya reducen la fuerza bruta.
- **Recomendación:** TOTP opcional para propietarios, después del primer piloto y con recuperación definida. **No es requisito del lanzamiento** y su ausencia **no** justifica dejar sin corregir nada de lo anterior.

### Pendientes de seguridad
- Prueba de penetración o revisión externa antes de manejar volumen de pagos.
- *Row-Level Security* como segunda capa de aislamiento (propuesta existente, §1): no se hizo en esta etapa por ser un cambio de arquitectura sin un hallazgo que lo justifique.
- Rate limiting compartido (Redis) si la web pasa a más de una instancia.
- Rotación de secretos: runbooks por escrito (`AUTH_SECRET` invalida todas las sesiones).
- Login con `bcryptjs` (JavaScript puro): ≈ 4 ingresos por segundo y por proceso (medido, ver `docs/PRODUCTION_READINESS.md` §14); sobra para la escala prevista, pero un ataque de fuerza bruta distribuido consumiría CPU antes de llegar al límite por cuenta.

## WhatsApp automático

- **Credenciales**: token y secreto de aplicación de cada negocio se guardan cifrados (AES-256-GCM, vector aleatorio por cifrado) con una clave de plataforma fuera de la base (`WHATSAPP_ENCRYPTION_KEY`, con rotación). Nunca se devuelven al navegador, a registros ni a auditoría: solo los últimos 4 caracteres del token. Probado en `test/whatsapp-admin.test.ts` y `test/whatsapp-core.test.ts`.
- **Administración**: solo administradores de la plataforma; cada acción vuelve a verificar el permiso en el servidor y queda auditada. El negocio solo puede pedir la activación y elegir sus avisos: no ve credenciales ni cambia el límite.
- **Webhook**: firma `X-Hub-Signature-256` con el secreto de la conexión del `phone_number_id` indicado (nada del cuerpo se toma como cierto antes de validarla); token de verificación guardado como hash; reenvíos idempotentes.
- **Aislamiento entre negocios**: una acción por WhatsApp exige que el turno sea del mismo negocio que la conexión y que responda el teléfono del cliente del turno; consumo, límites, historial y consentimientos son por negocio. Probado en `test/whatsapp-webhook.test.ts` y `test/whatsapp-delivery.test.ts`.
- **Consentimiento y baja**: solo se envía con consentimiento versionado; BAJA lo revoca y anula lo pendiente. Cancelar por WhatsApp requiere una segunda confirmación.
- **Entrega**: cada aviso se envía a lo sumo una vez; un estado incierto no se reenvía; token vencido apaga la conexión.
- **Demos**: la demo pública nunca envía WhatsApp real; la supervisada solo a números autorizados.
- **Registros (logs)**: el token de verificación del webhook viaja en la URL del apretón de manos de Meta. La configuración de Caddy (`deploy/Caddyfile`) lo reemplaza por `REDACTED` en el registro de acceso (verificado con un contenedor de prueba). El servidor de desarrollo (`next dev`) sí lo escribe en su consola local.
