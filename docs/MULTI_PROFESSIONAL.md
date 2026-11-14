# Equipos con varios profesionales

Estado: **etapas 1 y 2 implementadas** (modelo de datos, motor de disponibilidad, pantalla «Equipo», horarios por profesional, agenda del equipo, reasignación; ver sección 14). Las etapas 3 a 5 están diseñadas en la sección 12 y **no** están implementadas. La funcionalidad está **apagada por defecto**: ningún negocio existente cambia de comportamiento hasta que se la enciende a propósito (sección 7).

## 1. Qué cambió y qué no

Antes, Agendia trataba a cada negocio como una única agenda: los horarios eran del negocio, la disponibilidad cruzaba todos los turnos como un solo conjunto «ocupado», y toda reserva se asignaba al primer profesional activo. Existía la tabla `professionals`, pero sin uso real.

Ahora cada profesional tiene su propia agenda: horarios propios, turnos propios y, si corresponde, bloqueos propios. Dos profesionales distintos pueden atender a la misma hora; uno solo nunca tiene turnos superpuestos.

Lo que **no** cambia: un negocio con un único profesional se comporta exactamente como antes (misma disponibilidad —verificada contra el algoritmo anterior—, mismas pantallas, mismos correos). Tampoco cambian precios, planes publicados, landing, suscripciones ni Mercado Pago.

## 2. Conceptos

| Concepto | Qué es |
|---|---|
| Organización | El negocio. Es la unidad de aislamiento (multi-tenant). |
| Propietario / administrador | Usuarios con acceso al sistema (`Membership`, roles `owner` y `admin`). Gestionan el negocio. **No** ocupan cupo por sí mismos. |
| Usuario | Una cuenta de acceso. |
| Profesional | Quien atiende clientes y tiene agenda (`Professional`). Puede existir **sin** cuenta (`userId` vacío). Solo los profesionales **activos** ocupan cupo del plan. |

Un propietario que también atiende tiene su propio `Professional` y ocupa un cupo. Si solo administra, su profesional se desactiva y el cupo queda libre. Hoy el registro crea un profesional para el dueño; la pantalla «Equipo» (etapa 2) permite desactivarlo.

## 3. Modelo de datos (migración `20261115010000_team_foundation`)

| Cambio | Detalle |
|---|---|
| `Professional` ampliado | `description`, `color`, `sortOrder`, `bookableOnline`, `photoImageId` (reutiliza `OrganizationImage`), `userId` (opcional, único), `updatedAt`. |
| `ServiceProfessional` (nueva) | Vínculo servicio ↔ profesional. `Service.allProfessionals` (por defecto `true`): todos los activos lo realizan salvo que se restrinja. |
| `AvailabilityRule.professionalId` | Cada horario pertenece a un profesional. |
| `AvailabilityException.professionalId` | Opcional. Vacío = **bloqueo general** (feriado, cierre) que afecta a todos; con valor, solo a ese profesional. Los bloqueos existentes quedan generales. |
| `Appointment` | `professionalId` (asignado, ya existía), `requestedProfessionalId` (pedido por el cliente; vacío si eligió «cualquiera» o si es anterior a los equipos), `professionalSelection` (`specific` / `any`), `idempotencyKey` (única por organización). |
| `Organization` | `teamModeEnabled` (apagado), `extraProfessionals` (cupos adicionales; no es un precio). |

Decisiones de diseño:

- **Claves foráneas compuestas `(organizationId, id)`** en turnos, horarios, bloqueos y vínculos servicio-profesional. La base de datos —no solo el código— impide asociar algo de una organización con un profesional de otra. Requiere un índice único `(organizationId, id)` en `professionals` y `services`.
- **`onDelete: NoAction` desde los turnos hacia el profesional** (antes era `Cascade`: borrar un profesional borraba todos sus turnos). Ahora un profesional con historial no se puede borrar; se desactiva.
- **Fotos de profesionales:** el campo existe y apunta a `OrganizationImage`. La subida llega en la etapa 2, que además deberá reemplazar el índice único `(organizationId, kind)` por uno parcial (hoy asume un logo y una portada por negocio).
- **Sin precios ni duraciones por profesional**, pero el servicio sigue siendo la fuente de ambos y el vínculo `ServiceProfessional` puede ganar columnas opcionales (`price`, `durationMinutes`) sin cambiar el motor.
- **Recursos compartidos** (salas, sillones, equipamiento) quedan fuera: una barbería con tres sillones y tres barberos se modela hoy como tres profesionales; un consultorio con una sola sala compartida no. Sería un concepto nuevo (`Resource`) con su propio calendario, a evaluar más adelante.

## 4. Motor de disponibilidad

`getTeamAvailability` (`modules/availability/queries.ts`) calcula, para una lista de profesionales y un rango de días:

- por profesional: sus horarios + los bloqueos generales + los suyos + sus turnos;
- reglas de reserva del negocio: duración del servicio, intervalo, descanso entre turnos, anticipación mínima, horizonte máximo y zona horaria;
- reutiliza `computeDaySlots` (función pura) para cada profesional y día.

Devuelve cada horario **una sola vez**, con la lista de profesionales libres para tomarlo. Eso es a la vez la unión para «cualquier profesional» y la base de la asignación automática.

Rendimiento: **tres consultas** para todo el equipo (horarios, bloqueos, turnos), sin consultas por profesional ni por día. El cálculo es en memoria. Con el tope de 5 profesionales por plan, cada pedido de disponibilidad (14 días) calcula 70 días-profesional: del orden de milisegundos.

Elegibilidad (`modules/team/eligibility.ts`, un solo lugar): profesional activo, de la organización, que realice el servicio (todos o los vinculados) y, en el flujo público, habilitado para reservas online. Con el modo equipo apagado solo se considera al profesional «de siempre» (el primero activo).

`getAvailability` conserva la forma anterior (una agenda por negocio) y las pruebas anteriores a los equipos pasan sin modificar.

## 5. Asignación automática y concurrencia

Reserva con «cualquier profesional»:

1. Se buscan los profesionales elegibles y libres en ese horario (validación contra la disponibilidad real, en el servidor).
2. Se ordenan: **menos turnos activos ese día primero** (día local del negocio); desempate determinista por `sortOrder`, fecha de alta e id.
3. Se prueban **de a uno, cada uno en su propia transacción**, con el lock de ese profesional (`pg_advisory_xact_lock`). El primero que entra gana. Si el horario se ocupó para uno, se pasa al siguiente. Si ninguno entra: «ese horario acaba de ocuparse».

Garantías:

| Garantía | Mecanismo |
|---|---|
| Un profesional nunca tiene turnos superpuestos | Restricción de exclusión `appointments_no_overlap` (por `professionalId`), intacta |
| Dos profesionales sí atienden a la vez | La restricción es por profesional; el lock también |
| Sin deadlocks | Una transacción toma **a lo sumo un lock de profesional** y, después, el del cliente (siempre en ese orden). Nunca dos profesionales a la vez |
| Revalidación al confirmar | Se recalcula la disponibilidad al confirmar; la restricción es la última barrera |
| Duplicados por reintento o doble clic | `idempotencyKey` única por organización: el formulario público envía una clave por formulario; misma clave = mismo turno. Sin clave, un envío idéntico del mismo cliente (servicio, horario y pedido de profesional) devuelve el existente, serializado por cliente. Clientes distintos, o formularios distintos, reservan simultáneamente sin problema |
| Atomicidad | Cliente, turno y notificaciones se crean en una sola transacción; si pierde la carrera no queda ni el cliente nuevo |

Límites conocidos: el descanso entre turnos solo lo aplica el motor de disponibilidad (la restricción de la base no lo conoce; igual que antes). Dos personas distintas que comparten el mismo email o teléfono se tratan como el mismo cliente (comportamiento anterior): sin clave de idempotencia, reservar «cualquiera» dos veces para el mismo horario se interpreta como un doble envío.

### Reprogramación y cancelación

- Cliente que **eligió** un profesional: se mantiene ese profesional (también si el cliente es un turno anterior a los equipos).
- Cliente que eligió **«cualquiera»**: se intenta conservar al asignado; si no está libre, se asigna otro elegible libre. El resultado informa `previousProfessionalId` cuando cambió.
- Agenda interna: conserva al profesional salvo que se indique otro (reasignación), sin exigir el horario habitual.
- Cancelar libera el horario de **ese** profesional y conserva el historial.
- Los correos de equipos (modo encendido y más de un profesional activo) incluyen «Profesional: …». **Pendiente (etapa 3):** un aviso explícito de «cambió el profesional» en el correo de reprogramación; hoy el correo muestra al profesional vigente.

## 6. Planes y cupos

Definición única: `lib/plans.ts`. Se valida **en el servidor** (`modules/team/professionals.ts`), no en la interfaz.

| Situación | Profesionales activos |
|---|---|
| Prueba gratuita (también vencida o en pausa) | hasta 2 |
| Plan Profesional (`Plan.code = "mensual"`, el plan actual) | hasta 2 |
| Plan Equipo (`Plan.code = "equipo"`, aún no existe en la base) | hasta 5 |
| Instalación independiente | hasta 2 (provisorio; condiciones comerciales por definir) |
| `Organization.extraProfessionals` | suma cupos en cualquier caso (futuras ampliaciones) |

Reglas: la cuenta administrativa que no atiende no ocupa cupo; el dueño que atiende, sí; los desactivados no ocupan; reactivar respeta el límite; un código de plan desconocido nunca da más cupos. Cancelar, suspender o atrasarse no reduce los cupos de un plan existente.

Concurrencia: crear y reactivar toman un lock por organización dentro de una transacción; dos altas simultáneas no superan el límite (probado con 10 simultáneas).

**Reducción de plan (diseño; llega con la integración comercial, etapa 5):** nunca se borra ni se desactiva nada automáticamente. Si tras bajar de plan hay más profesionales activos que cupos: no se puede crear ni reactivar ninguno, se muestra el exceso (`overLimit`) y el administrador elige a quién desactivar; desactivar exige antes reasignar o cancelar sus turnos futuros. Qué ocurre si el administrador no actúa (por ejemplo, dejar de ofrecer online a los que exceden el cupo tras un plazo) es una decisión comercial pendiente. El historial siempre se conserva.

El modo independiente usa la misma arquitectura; solo cambia el cupo base.

## 7. Activación controlada

`lib/features.ts`. Apagado por defecto. Se enciende:

- **por negocio** (piloto): `docker compose --env-file .env.production run --rm migrate node scripts/team-mode.mjs <enlace-del-negocio> on` (queda en el registro de auditoría); `off` lo apaga; `extra <n>` fija cupos adicionales;
- **para toda la instalación**: variable `TEAM_MODE_ENABLED=1` (desarrollo, pruebas o una instalación independiente que ya lo usa).

No es un detalle de la interfaz: con el modo apagado, el motor, la reserva y el alta de profesionales se comportan como si hubiera uno solo, aunque la base tenga más filas. Mientras la etapa 2 no exista no hay pantalla para sumar profesionales, así que ningún usuario puede llegar a este estado sin intervención del operador.

## 8. Migración y compatibilidad

### Orden y contenido

Una sola migración, atómica y aditiva, `prisma/migrations/20261115010000_team_foundation/migration.sql`:

0. **Guardas:** aborta si algún turno apunta a un profesional de otra organización (se debe resolver a mano) e informa cuántas organizaciones no tienen profesional o tienen más de uno.
1. **Estructura:** columnas con valor por defecto, tabla nueva, índices.
2. **Relleno:** organizaciones sin profesional reciben uno (como habría creado la aplicación al primer turno); `sortOrder` secuencial por organización; los horarios pasan al profesional original (el activo más antiguo, el mismo que usaba la aplicación). Los bloqueos quedan generales.
3. **Claves foráneas** (después del relleno).
4. **Trigger de compatibilidad** (sección siguiente).
5. **Verificación:** si quedó algún horario sin profesional o alguna organización sin profesional, la migración entera se revierte.

No borra ni reescribe turnos, clientes, servicios, bloqueos ni configuración.

### Casos ambiguos

- Negocio con más de un profesional (no ocurre con el código anterior, que no permitía crearlos): los horarios van al más antiguo (activo si lo hay). `npm run team:verify` los lista para revisión manual.
- Turnos de organización cruzada: abortan la migración, con mensaje.

### Verificación posterior

`node scripts/verify-team-data.mjs` (solo lectura): totales para comparar contra la copia previa, negocios sin profesional, horarios sin profesional, referencias cruzadas, negocios con más de un profesional. Termina con código 1 si algo impide el cierre.

### Pruebas de migración

`test/team-migration.test.ts` crea una base nueva, aplica **todas las migraciones anteriores**, siembra datos representativos (un profesional, uno inactivo, ninguno, dos, inactivo más antiguo, cuenta vacía; horarios, bloqueos, turnos pasados, futuros y cancelados), aplica `team_foundation` y verifica: huella idéntica de turnos, servicios, clientes, horarios, bloqueos y configuración; asignación de horarios; horarios disponibles **idénticos antes y después** para los negocios individuales; restricción anti-superposición y claves compuestas; y que una inconsistencia aborta todo sin dejar nada a medias. Además `test/team-compat.test.ts` compara el motor nuevo con el algoritmo anterior en 30 escenarios variados.

### Compatibilidad con la versión anterior de la aplicación (rollback)

La versión anterior inserta horarios **sin** `professionalId`. Un trigger (`availability_rules_default_professional`) completa el campo con el profesional original del negocio, así que la versión anterior sigue funcionando sobre la base migrada. La columna `professionalId` de los horarios se deja **opcional** a propósito durante esta etapa; el motor ignora un horario sin profesional (falla cerrado: un horario sin dueño no ofrece turnos) y el trigger y el verificador evitan que exista.

| Situación | ¿Rollback de la aplicación seguro? |
|---|---|
| Migración aplicada, modo equipo apagado en todos los negocios | **Sí.** Volver al commit anterior (`./deploy/deploy.sh <commit>`) no requiere tocar la base |
| Un negocio con el modo encendido y **un solo** profesional activo | Sí (mismo comportamiento) |
| Un negocio con el modo encendido y **más de un** profesional activo, con turnos de varios | **No es seguro sin pasos previos.** La versión anterior asigna todo al primer profesional y mezcla las agendas, y ya no distingue horarios por profesional. Antes de volver atrás: `team-mode off` del negocio, y reasignar o aceptar que los turnos de los demás profesionales queden sin su agenda |
| Restauración de la copia `pre-deploy-*` | Seguro para la base, pero descarta todo lo cargado después de la copia |

Recuperación sin pérdida silenciosa: apagar el modo equipo (`team-mode off`) no borra nada; los profesionales y sus turnos siguen en la base y vuelven a funcionar al reencenderlo.

### Migración de cierre (etapa posterior, no incluida)

Cuando el rollback ya no haga falta: hacer `availability_rules.professionalId` obligatorio y retirar el trigger. Debe ser una migración aparte, aplicada después de `team:verify` en limpio.

## 9. Métricas de consumo

`modules/system/usage.ts`, sin servicios externos: se calculan con las tablas existentes (`notifications`, `appointments`, `professionals`). Muestran, por negocio y por período (mes en curso): profesionales activos, turnos creados, correos enviados / fallidos / omitidos / pendientes / cancelados, correos con reintentos (`attempts > 1`) y correos por tipo, además del consumo diario de la plataforma. Se ven en `/admin` → «Consumo del mes».

Impacto esperado de los equipos:

- **Resend (único gasto variable):** los correos escalan con los turnos (≈ 2,5 por turno: confirmación, recordatorio y aviso al profesional). Un negocio de 5 profesionales con ≈ 120 turnos mensuales cada uno genera ≈ 1.500 correos al mes; unos pocos negocios así superan el plan gratuito (3.000 al mes, 100 por día) y conviene pasar al plan pago. Estimación de la hipótesis anterior, a validar con el consumo real de `/admin`.
- **Worker:** la cantidad de notificaciones por turno no cambia (se evitan duplicados con la clave de idempotencia de cada notificación y se cancelan las pendientes al cambiar un turno). Más turnos = más filas, no más trabajo por fila.
- **Base de datos:** un índice nuevo `(professionalId, startsAt)`; la disponibilidad hace tres consultas por pedido independientemente del tamaño del equipo. El VPS actual alcanza; no se requiere infraestructura nueva.
- Los avisos internos hoy llegan a **todas** las membresías del negocio (ver riesgos): con cuentas individuales (etapa 4) hay que dirigirlos al destinatario correcto para no multiplicar correos.

## 10. Seguridad y aislamiento

Verificado en esta etapa (con pruebas):

- Toda consulta de disponibilidad, elegibilidad y reserva está acotada por `organizationId` de la organización **de la sesión o de la página pública**, nunca por un dato del cliente. Un identificador de profesional, servicio o turno de otra organización no devuelve nada o se rechaza.
- El identificador de profesional que llega del navegador (reserva pública, agenda interna, reprogramación) es un dato no confiable: se valida contra activo + organización + servicio + reservas online.
- Alta, activación, vínculos servicio-profesional, horarios y bloqueos validan la organización antes de escribir; la base lo vuelve a verificar con las claves compuestas (probado con inserciones directas).
- Los cupos del plan, el modo equipo y el estado de solo lectura se validan en el servidor.

**Riesgos encontrados en el modelo actual de roles y permisos (resolver antes de habilitar cuentas de profesionales, etapa 4):**

1. `MembershipRole` (`owner` / `admin`) **no se verifica en ningún punto del código**: todo miembro puede todo. Hoy es inocuo porque solo existe el dueño (no hay invitaciones ni forma de crear una segunda membresía). Con cuentas individuales sería un acceso total para cualquier profesional.
2. `lib/dal.ts` y `auth.ts` toman **una sola membresía** por usuario (`take: 1`): un usuario pertenece a un solo negocio. Correcto para la etapa 4, pero hay que impedir invitar a un email que ya tiene cuenta en otro negocio (o definir cómo se vincula).
3. Los avisos internos (`modules/notifications/enqueue.ts`) se envían a **todas** las membresías: un profesional con cuenta recibiría los avisos de todo el negocio.
4. Las consultas de turnos, clientes y página «Hoy» filtran por organización, **no** por profesional: un profesional con cuenta vería toda la agenda y todos los clientes.
5. Las acciones del panel validan «cuenta con permiso de escritura», no «rol permitido».

Por eso **no** se habilitó ningún acceso de profesionales: no hay invitaciones, ni nuevo rol efectivo, ni forma de crear un segundo usuario.

## 11. Pruebas de la etapa 1

`test/plans.test.ts`, `test/team-availability.test.ts`, `test/team-booking.test.ts`, `test/team-professionals.test.ts`, `test/team-compat.test.ts`, `test/team-migration.test.ts`, `test/usage.test.ts` (81 pruebas nuevas) contra PostgreSQL real, sin mocks para la concurrencia. Se suman a las 168 anteriores, que pasan sin cambios. Cubren: turnos simultáneos entre profesionales, no superposición, unión sin duplicados, profesionales inactivos y no reservables, servicios restringidos, bloqueos individuales y generales, duración, descanso, anticipación, horizonte y zona horaria; asignación por carga y desempate; 12 reservas simultáneas «cualquiera» sobre 3 profesionales (exactamente 3 entran); reintentos y doble envío; atomicidad; reprogramación y cancelación; cupos de plan (prueba, Profesional, Equipo, extra, desactivados, reactivación, alta concurrente); aislamiento entre organizaciones a nivel de código y de base; equivalencia con el motor anterior; y la migración.

## 12. Etapas siguientes (no implementadas)

### Etapa 2 — Equipo y agenda administrativa

- Sección «Equipo» (`/dashboard/equipo`): alta, edición, foto (reutilizando el procesamiento de imágenes existente), color, activación y desactivación (con el flujo de reasignar o cancelar turnos futuros), servicios asignados, **cupos usados y disponibles** según el plan.
- Horarios individuales con «copiar de otro profesional», descansos, vacaciones y ausencias; bloqueos individuales y generales.
- Agenda administrativa: todo el equipo, filtro por profesional, **columnas por profesional en escritorio** y **selector de profesional en celular** (sin tablas horizontales), alta manual eligiendo profesional, reasignar turnos, disponibilidad individual. Con un solo profesional, la pantalla es la actual.
- Migración de cierre de `availability_rules.professionalId` (cuando se decida), índice parcial de imágenes por profesional.
- La pantalla de «Horarios» actual pasa a editar al profesional elegido.

### Etapa 3 — Reserva pública

- Servicio → profesional o «Cualquier profesional» → fecha → horario → datos → confirmar. El paso de profesional se omite si hay una sola opción elegible. Foto, nombre y descripción breve; disponibilidad real; respeta la personalización de la página (logo, portada, colores, tipografías) y los formularios que conservan los datos.
- El profesional asignado en confirmación, correos (confirmación, recordatorio, reprogramación con aviso de cambio de profesional), consulta de turnos y detalle.
- El backend ya está listo (acepta `professionalId`, `"any"` y `idempotencyKey`).

### Etapa 4 — Cuentas, invitaciones y permisos

- Invitación por email: token de un solo uso, temporal, guardado como hash (mismo patrón que la verificación de email); vincula `Professional.userId`.
- Permisos centralizados en el servidor para consultas y mutaciones (un único helper de alcance por rol): propietario y administrador, todo; profesional, solo su agenda y los datos necesarios de sus clientes; nunca facturación, suscripción, configuración comercial, otros profesionales ni la página pública. Opción para ver la disponibilidad general del equipo sin datos privados.
- Resolver los cinco riesgos de la sección 10 **antes** de habilitar nada, con pruebas de aislamiento dentro del mismo negocio.
- Avisos internos al destinatario adecuado (el profesional asignado; el propietario, sin duplicar si es la misma persona).
- Revocar una cuenta sin borrar su historial ni sus turnos.

### Etapa 5 — Integración comercial

Landing y precios (Plan Profesional hasta 2 profesionales, ARS 9.900; Plan Equipo hasta 5, ARS 19.900; Licencia Profesional ARS 149.000 y Licencia Equipo ARS 249.000; importes definidos en `futurePricing`, sin publicar), onboarding, cupos visibles, cambio de plan y reducción de plan, adaptación de Mercado Pago (plan nuevo, renovaciones, vencimientos), condiciones del modo independiente, documentación, capturas y piezas publicitarias. **No se cobra ni se promociona hasta que las etapas 2 a 4 estén completas y verificadas.**

## 13. Procedimiento de despliegue de la etapa 1

No se desplegó ni se migró producción. Cuando se autorice:

1. Revisar `git log HEAD..origin/main` y que el CI esté en verde.
2. `./deploy/deploy.sh` (copia previa → build → **migración automática** → verificación de `/api/health`).
3. Inmediatamente: `docker compose --env-file .env.production run --rm migrate node scripts/verify-team-data.mjs` (debe terminar en «OK») y comparar los totales con la copia previa.
4. Revisar `/admin`: la sección «Consumo del mes» debe cargar.
5. Probar una reserva pública en un negocio existente (debe comportarse como siempre).
6. Instalaciones independientes: `./deploy/instance.sh update-all` (cada una hace su copia previa).

Rollback: ver la tabla de la sección 8. Con el modo equipo apagado en todos los negocios (el estado de salida), `./deploy/deploy.sh <commit anterior>` es suficiente y no toca la base.

## 14. Etapa 2: gestión del equipo y agenda administrativa (implementada)

Sigue **apagada por defecto**: todo lo de esta sección solo aparece con el modo equipo encendido (sección 7). Con el modo apagado, o con un solo profesional activo, las pantallas son las de siempre.

### Qué se puede hacer

- **Equipo** (`/dashboard/equipo`): alta sin cuenta de usuario (la administra el propietario), nombre, descripción, color, orden (subir/bajar), reservas online sí/no, «Soy yo» (identifica al propietario que también atiende), foto (JPG/PNG/WebP, hasta 8 MB, mínimo 160 × 160, recorte cuadrado de 512 px en WebP, mismo procesamiento seguro que el logo), servicios que realiza, activar y desactivar. Muestra cupos usados y disponibles, y avisa si hay exceso de cupo (sin borrar ni cancelar nada).
- **Horarios por profesional** (`/dashboard/disponibilidad?profesional=`): selector, horario semanal con varias franjas por día (los descansos son el hueco entre franjas), «copiar horarios de…», vacaciones y ausencias (un día, un rato o varios días seguidos), y cierres generales del negocio en una sección aparte. Las franjas superpuestas se rechazan en el servidor.
- **Agenda del equipo**: selector «Todo el equipo / profesional» (también en celular), columnas por profesional en escritorio, lista con quién atiende y color en celular, bloqueos y horarios del día por profesional, alta manual eligiendo profesional o «cualquiera disponible», reprogramar con los horarios del propio profesional.
- **Reasignar** un turno futuro desde su detalle (solo ofrece a quienes tienen ese horario libre y realizan el servicio) y **resolver los turnos antes de desactivar** (pasarlos o cancelarlos, de a uno o todos; los que no se puedan pasar quedan pendientes y se informan). El cliente recibe un correo de «cambió el profesional».
- **WhatsApp manual** desde el turno: ver `docs/WHATSAPP_AUTOMATION.md`.

### Seguridad

- Permisos por rol en el servidor (`lib/permissions.ts`; D-48) en todas las acciones nuevas y en las de turnos, servicios, clientes y horarios.
- Todo identificador (profesional, servicio, turno, bloqueo, imagen) se valida contra la organización de la sesión; los bloqueos individuales y generales no se borran desde la pantalla equivocada. Pruebas con identificadores manipulados en `test/team-actions.test.ts` y `test/team-admin.test.ts`.
- Se corrigió un problema real de la etapa 1: reprogramar desde la agenda interna ofrecía horarios libres de **cualquier** profesional aunque el turno se conserva con el suyo; ahora ofrece los de su profesional.
- Riesgos que **siguen** (sección 10) y que impiden habilitar cuentas de profesionales: una membresía por usuario, avisos internos a todas las membresías, consultas sin alcance por profesional. Resueltos en esta etapa: roles sin verificación y acciones que validaban solo escritura.

### Migraciones nuevas (aditivas)

1. `20261116000000_professional_photos`: valor `professional` en `OrganizationImageKind`; la unicidad `(organizationId, kind)` pasa a un índice parcial solo para logo y portada, de modo que cada profesional puede tener su foto. Los logos y portadas existentes no cambian.
2. `20261116000100_professional_change_notification`: valor `professional_change` en `NotificationType`.

Ambas son seguras con el esquema anterior mientras no existan filas con esos valores nuevos. **El rollback de la aplicación deja de ser seguro cuando existe una foto de profesional (el código anterior lee todas las imágenes del negocio y fallaría con el valor desconocido) o un aviso `professional_change` pendiente.** Antes de volver atrás: quitar las fotos de profesionales (`DELETE FROM organization_images WHERE kind = 'professional'`; el campo `photoImageId` pasa a nulo solo) y esperar o anular los avisos pendientes de ese tipo. Los valores de enum no se pueden quitar, pero quedan sin uso. Probadas sobre la base local y con la prueba de migración existente.
**No se aplicó la migración de cierre** de `availability_rules.professionalId` (D-51).

### Costos e infraestructura

Sin servicios, dependencias ni tareas programadas nuevas. Las fotos (~30–60 KB cada una, WebP) viven en PostgreSQL como el logo: cinco profesionales ≈ 300 KB por negocio. La agenda del equipo hace una consulta de turnos, una de horarios y una de bloqueos por pantalla, más la de profesionales; la disponibilidad para reasignar se calcula agrupada por día y duración. WhatsApp manual no hace ninguna solicitud desde el servidor. Cada reasignación genera, como máximo, un correo (más el recordatorio reprogramado) por turno afectado.

### Exceso de cupo tras una baja de plan

No se borra ni se desactiva nada. La pantalla Equipo muestra el exceso; no se puede agregar ni reactivar a nadie hasta quedar dentro del límite; el administrador decide a quién desactivar y debe resolver antes los turnos futuros de esa persona. Los profesionales de más siguen atendiendo hasta que se los desactive: qué hacer si el administrador no actúa es una decisión comercial pendiente.

### Qué no cubre esta etapa

Reserva pública con elección de profesional y correos con el profesional en todos los casos (etapa 3); cuentas, invitaciones y roles de profesional (etapa 4); integración comercial (etapa 5). La etapa 3 puede empezar sin cambios de backend: ya acepta `professionalId`, `"any"` y `idempotencyKey`.

