# Equipos con varios profesionales

Estado: **etapas 1 a 4 implementadas** (modelo de datos, motor de disponibilidad, pantalla «Equipo», horarios por profesional, agenda del equipo, reasignación y reserva pública con elección de profesional; ver secciones 14 y 15). La etapa 5 está diseñada en las secciones 12 y 16 y **no** está implementada. La etapa 4 (cuentas, invitaciones y permisos) está en la sección 16 y en `docs/AUTH_AND_ACCESS.md`. La funcionalidad está **apagada por defecto**: ningún negocio existente cambia de comportamiento hasta que se la enciende a propósito (sección 7).

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

Ambas son seguras con el esquema anterior mientras no existan filas con esos valores nuevos. **El rollback de la aplicación necesita un paso previo cuando existe una foto de profesional o un aviso `professional_change`** (el código anterior los lee y falla con el valor de enum desconocido). El paso **no borra nada**: ver la sección 15.7 (`scripts/prepare-rollback.mjs`). Los valores de enum no se pueden quitar de PostgreSQL, pero quedan sin uso.
**No se aplicó la migración de cierre** de `availability_rules.professionalId` (D-51).

### Costos e infraestructura

Sin servicios, dependencias ni tareas programadas nuevas. Las fotos (~30–60 KB cada una, WebP) viven en PostgreSQL como el logo: cinco profesionales ≈ 300 KB por negocio. La agenda del equipo hace una consulta de turnos, una de horarios y una de bloqueos por pantalla, más la de profesionales; la disponibilidad para reasignar se calcula agrupada por día y duración. WhatsApp manual no hace ninguna solicitud desde el servidor. Cada reasignación genera, como máximo, un correo (más el recordatorio reprogramado) por turno afectado.

### Exceso de cupo tras una baja de plan

No se borra ni se desactiva nada. La pantalla Equipo muestra el exceso; no se puede agregar ni reactivar a nadie hasta quedar dentro del límite; el administrador decide a quién desactivar y debe resolver antes los turnos futuros de esa persona. Los profesionales de más siguen atendiendo hasta que se los desactive: qué hacer si el administrador no actúa es una decisión comercial pendiente.

### Qué no cubre esta etapa

Reserva pública con elección de profesional y correos con el profesional en todos los casos (etapa 3); cuentas, invitaciones y roles de profesional (etapa 4); integración comercial (etapa 5). La etapa 3 puede empezar sin cambios de backend: ya acepta `professionalId`, `"any"` y `idempotencyKey`.

## 15. Etapa 3: reserva pública con varios profesionales (implementada)

Sigue **apagada por defecto** (modo equipo, sección 7). Con el modo apagado, o con un solo profesional elegible, la página pública es la de siempre.

### 15.1 Flujo de reserva

1. **Servicio** (se omite si hay uno solo). 2. **Profesional**, solo si el servicio tiene dos o más opciones reales. 3. **Día y horario.** 4. **Datos** con un **resumen** (negocio, servicio, profesional o «Cualquier profesional», fecha, hora, duración, precio si el negocio lo muestra y los datos del cliente). 5. **Confirmar**; la pantalla final nombra al profesional **efectivamente asignado**.

- Las opciones salen de la misma regla que valida la reserva en el servidor (`eligiblePool` en `modules/team/eligibility.ts`): profesional activo, de este negocio, que realiza el servicio, con reservas online habilitadas y con el modo equipo encendido. Es imposible que la página ofrezca a alguien que la reserva rechazaría.
- Con **un solo elegible no hay paso extra** y no se envía ningún identificador de profesional. Un servicio **sin ningún elegible** se muestra deshabilitado («Por ahora no se puede reservar online») y, si se llega a él, un mensaje invita a elegir otro servicio o contactar al negocio.
- Cambiar de servicio o de profesional descarta el horario elegido y vuelve a pedir la disponibilidad; los datos personales no se pierden. Si el horario se ocupa durante la confirmación: «Ese horario acaba de ocuparse», se conservan los datos y el profesional elegido, y se vuelve a pedir la disponibilidad.
- El doble clic y los reintentos usan la clave de idempotencia de la etapa 1 (misma clave, mismo turno).

### 15.2 Selección de profesional

Tarjetas en el orden definido por el administrador: foto (o la inicial sobre el color de la página del negocio), nombre, descripción breve y, si el profesional no hace todos los servicios, cuáles hace. La última tarjeta es «Cualquier profesional»: *«Encontrá un horario con cualquiera de los profesionales disponibles»* (no promete el primer turno). La página **nunca** recibe teléfono, correo, cuenta, color interno, orden ni configuración administrativa; solo `id`, nombre, descripción y la URL de la foto pública ya procesada (`modules/public-page/team.ts`). El `id` es el UUID del profesional, necesario para elegirlo, y **no es una credencial**: el servidor vuelve a validarlo en cada pedido.

### 15.3 «Cualquier profesional»

Disponibilidad: unión de los horarios de los elegibles, sin duplicados. Asignación: el elegible libre con **menos turnos ese día**, con el desempate fijo de la etapa 1 (orden del equipo); se revalida al confirmar y, si el primero deja de estar libre, se intenta con el siguiente, uno por vez y cada uno en su transacción (sin deadlocks). Si ninguno está libre, se informa el conflicto. No hay lógica de disponibilidad en el navegador: es el mismo motor.

### 15.4 Gestión del turno por el cliente

Mismo mecanismo de enlaces con token. La pantalla «Tu turno» y «Tus turnos» (consulta por email) nombran al profesional **solo en negocios con equipo**. Reglas de reprogramación (comportamiento exacto):

| Situación | Horarios que ve el cliente | Qué pasa al confirmar |
|---|---|---|
| Eligió a un profesional | Solo los de su profesional vigente | Se conserva. Nunca se lo cambia por otro; un horario de otro profesional pedido a mano se rechaza |
| Eligió a un profesional y este ya no atiende ese servicio online (inactivo, sin reservas online o sin el servicio) | Ninguno: mensaje «El profesional de tu turno ya no está disponible para reprogramar online» con el teléfono del negocio | No se reprograma ni se lo reemplaza; puede cancelar |
| Eligió «cualquiera» | La unión de todos los elegibles | Se conserva al profesional vigente si está libre en el nuevo horario; si no, se asigna otro elegible libre. La pantalla avisa antes («puede cambiar quién te atiende») y después («Con este horario te atiende X») |
| El negocio reasignó el turno antes | Se parte del profesional **vigente**; nunca se restaura en silencio al anterior | Quien eligió uno concreto pasa a «elegir al nuevo» (solo ve sus horarios); quien eligió «cualquiera» sigue en «cualquiera» |

Todo se vuelve a validar en el servidor (elegibilidad y disponibilidad) con la misma transacción de las etapas anteriores. **Cancelar** libera el horario de ese profesional, conserva el historial y no toca otras agendas ni otros turnos.

### 15.5 Correos

Confirmación, recordatorio, reprogramación y cancelación incluyen «Profesional» (solo en negocios con equipo). Una reprogramación del cliente que cambia al profesional envía **un solo** correo que lo dice expresamente («antes era X y ahora te atiende Y», asunto «cambió de horario y de profesional»); el dato del profesional anterior viaja en `notifications.payload`. La reasignación administrativa envía «Cambió quién te atiende» (etapa 2). Los avisos pendientes se anulan y se reemplazan en cada cambio, así que no se duplican ni salen avisos de horarios viejos; no suben los correos por turno. Sin motivos de consulta, diagnósticos ni notas.

### 15.6 WhatsApp manual

Sigue igual y se amplía: el mensaje nombra al profesional asignado (salvo el modo discreto) y hay un aviso «Avisar el cambio de profesional» (solo en negocios con equipo y turnos por venir). Los enlaces de gestión, los teléfonos válidos e inválidos y el modo discreto están cubiertos por pruebas. Sin envíos automáticos ni API de Meta (`docs/WHATSAPP_AUTOMATION.md` no cambia).

### 15.7 Migración y rollback

**Migración nueva de la etapa 3** (aditiva): `20261117000000_notification_payload` agrega `notifications.payload` (JSON, opcional; la versión anterior la ignora).

Migraciones pendientes de producción, en orden: `20261115010000_team_foundation` (etapa 1), `20261116000000_professional_photos`, `20261116000100_professional_change_notification` (etapa 2) y `20261117000000_notification_payload`. La de cierre de `availability_rules.professionalId` **sigue sin aplicarse** (D-51).

**Qué impide volver a la versión anterior sin preparar la base:** (a) filas de `organization_images` con `kind = 'professional'` y (b) filas de `notifications` con `type = 'professional_change'`: la versión anterior no conoce esos valores y falla al leerlas (fotos: la página pública y el panel; avisos: la pantalla «Recordatorios»). Un negocio con varios profesionales, sus turnos asignados y sus horarios individuales **no** rompen la versión anterior (el trigger completa `professionalId` en los horarios; los turnos siguen siendo válidos), pero esa versión trataría a todos como un solo profesional: por eso, antes de volver atrás, apagar el modo equipo de los negocios que lo usan (`team:mode off`), que no borra nada.

**Procedimiento no destructivo** (`scripts/prepare-rollback.mjs`, `npm run rollback:prepare`):

1. Copia de seguridad completa (`deploy/backup.sh` o el `pg_dump` de `deploy.sh`).
2. Sin argumentos informa cuántas filas habría que mover; no modifica nada.
3. `--apply`, en **una transacción**: copia las fotos de profesionales a `rollback_backup_professional_images` (con el profesional al que pertenecían) y las saca de `organization_images`; los profesionales quedan sin foto, nada más cambia. Copia los avisos `professional_change` a `rollback_backup_notifications`, anula los pendientes y pasa el tipo de todos a `reschedule`. Es repetible.
4. Volver a la versión anterior: `./deploy/deploy.sh <commit>`.
5. Al volver a la versión nueva: `--restore` repone las fotos con su profesional y el tipo original de los avisos.

Probado contra PostgreSQL real (`test/rollback-prepare.test.ts`): informa sin modificar, aparta, deja la base sin filas desconocidas, conserva turnos, profesionales y logos, es repetible y restaura. **No se ejecutó en producción.** El borrado de filas **no** es parte del procedimiento. Riesgo residual: si se usa `--apply` y no `--restore`, las fotos quedan solo en la tabla de respaldo (hay que volver a cargarlas o restaurarlas); mientras esas tablas existan, los datos no se pierden. Alternativa más conservadora: restaurar la copia `pre-deploy-*.sql.gz` (descarta todo lo cargado después).

### 15.8 Seguridad

Capa de permisos de la etapa 2 en todas las acciones del panel. Para el público, todo se valida en el servidor en cada pedido: negocio por identificador, que acepte reservas (estado de la cuenta, `canPerformWriteActions`), servicio activo, profesional elegible (activo, del negocio, con el servicio, con reservas online, modo equipo), disponibilidad real y límites por IP ya existentes (campo trampa, tope de reservas por hora). Pruebas con identificadores manipulados (de otro negocio, inactivos, privados, inexistentes, con inyección o demasiado largos), con el modo equipo apagado y con cuentas en solo lectura: ninguna crea nada. Tokens: los enlaces `/turno/…` y `/<negocio>/mis-turnos/…` llevan `Referrer-Policy: no-referrer` por encabezado (además de la etiqueta), no hay analítica ni terceros en esas páginas y los tokens no se registran en logs (revisado en `modules/booking`, `modules/appointments` y las páginas). Un token de un turno solo opera ese turno; uno de otro negocio no sirve.

### 15.9 Riesgos que quedan

- Los **identificadores de profesional** viajan al navegador (necesarios para elegir); si algún día se quiere ocultarlos hay que pasar a un código público opaco.
- El enlace de gestión del turno es una **capacidad**: quien lo tenga puede ver, reprogramar o cancelar ese turno (igual que antes y que en los correos); no hay forma de revocarlo salvo cancelar el turno.
- La asignación «menor carga del día» es un criterio simple: no pondera duración ni tipo de servicio.
- Cuentas de profesionales: **siguen sin habilitarse**; los riesgos de la sección 10 (una membresía por usuario, avisos internos a todas las membresías, consultas sin alcance por profesional) se resuelven en la etapa 4.
- No se probó con dispositivos físicos ni con las apps de WhatsApp o Instagram (ver el informe de la etapa).

### 15.10 Reducción de plan con exceso de profesionales: alternativas (decisión comercial pendiente)

Garantías vigentes y no negociables: no se borran profesionales ni datos, no se cancelan turnos solos, no se desactiva a nadie sin una decisión explícita, y se bloquean altas y reactivaciones mientras haya exceso. **No se implementó ninguna restricción nueva.** Alternativas para resolver el exceso, con su impacto en clientes con turnos futuros:

1. **Solo bloquear altas y reactivaciones (hoy).** Los profesionales de más siguen atendiendo y recibiendo reservas. Impacto en clientes: ninguno. Contra: el negocio usa más cupos de los que paga indefinidamente.
2. **Período de adaptación (p. ej. 30 días) con avisos**, luego dejar de ofrecer online a los profesionales que exceden el cupo (los últimos por orden o los que elija el administrador), sin tocar los turnos ya reservados. Impacto: los clientes con turnos futuros no se ven afectados; los nuevos solo ven a los profesionales dentro del cupo. Requiere decidir plazo y criterio.
3. **El administrador elige a quién desactivar**, con la guía de reasignación de la etapa 2, sin plazo forzado. Impacto: es el administrador quien decide qué pasa con cada turno futuro (pasarlo o cancelarlo con aviso). Es lo más respetuoso con los clientes, pero depende de que el administrador actúe.
4. **Congelar las reservas nuevas de todo el exceso desde el primer día** (los turnos existentes se mantienen). Impacto: ningún cliente actual pierde su turno, pero un profesional puede quedar sin agenda nueva de un día para otro: es el más brusco y el que más perjudica al negocio.
5. **Pasar al negocio a la tarifa del Plan Equipo** si tiene más de 2 profesionales (con consentimiento explícito; nunca automático). Impacto en clientes: ninguno; es una decisión de cobro.

Recomendación técnica (a validar): combinar 1 + 3 durante un plazo de adaptación definido por el negocio y avisos claros, y dejar 2 como política de último recurso con aviso previo y consentimiento. **Esperá tu aprobación antes de implementar nada.**

### 15.11 Despliegue, costos y etapa siguiente

Despliegue acumulado de las etapas 1 a 3: `docs/DEPLOYMENT.md`. Costos y rentabilidad actualizados con los precios vigentes y futuros: `docs/PRODUCTION_READINESS.md` §5. La reserva pública no agrega servicios, dependencias, tareas ni variables de entorno.

**Etapa 4 (propuesta): cuentas, invitaciones y permisos.** (1) Resolver primero los riesgos de la sección 10: varias membresías por usuario con un negocio activo en sesión, avisos internos dirigidos al destinatario correcto (el profesional asignado; el propietario sin duplicar), y un único helper de alcance por rol para toda consulta de turnos y clientes (un profesional ve su agenda y los datos mínimos de sus clientes; nunca facturación, suscripción, configuración comercial ni a otros profesionales). (2) Invitación por correo con token de un solo uso, vencimiento y guardado como hash (mismo patrón que la verificación de email), que vincula `Professional.userId`; revocar una cuenta sin perder historial ni turnos. (3) Rol `professional` en `lib/permissions.ts` con permisos acotados a su agenda. (4) Pruebas de aislamiento **dentro del mismo negocio** y de enumeración de invitaciones. (5) Sin cambios comerciales. No avanzar sin aprobación.

## 16. Etapa 4: cuentas individuales, invitaciones y permisos (implementada)

Detalle completo en **`docs/AUTH_AND_ACCESS.md`** (modelo, matriz de permisos, alcance de datos, invitaciones, revocación, notificaciones, auditoría, migración y rollback). Resumen:

- Un usuario puede pertenecer a varios negocios (selector con nombre, logo y rol); el negocio activo y el rol se resuelven en el servidor en cada pedido; una revocación corta el acceso en el siguiente pedido.
- Roles: propietario, administrador y profesional, con permisos centralizados; el profesional ve solo su agenda y sus clientes, con ocho permisos que el propietario configura.
- Invitaciones por correo desde Equipo; aceptación con o sin cuenta; revocar el acceso conserva todo lo del profesional.
- Avisos internos solo a quien corresponde, sin duplicados, revalidados al enviar.
- **Riesgos de la sección 10: resueltos** (roles sin verificación, una membresía por usuario, avisos a todas las membresías, consultas sin alcance, acciones que validaban solo escritura).
- Migraciones nuevas: `20261118000000_accounts_and_invitations` (aditiva). Rollback: `scripts/prepare-rollback.mjs` aparta también las membresías que no son del propietario (sin borrar).
- Interruptor propio: `TEAM_ACCOUNTS_ENABLED` / `teamAccountsEnabled`, apagado por defecto.

### Propuesta para la etapa 5 (integración comercial; NO implementada)

1. **Ofertas y cupos:** publicar Profesional (hasta 2) y Equipo (hasta 5) con los precios definidos (`futurePricing`), elegir plan en el alta y desde «Mi plan», cambio de plan, y que `Plan.code` `equipo` exista en la base y en Mercado Pago (sandbox primero). Las cuentas individuales ya están incluidas en ambos planes: no hay cargo por acceso.
2. **Exceso de cupo:** implementar la política que apruebes de las alternativas de §15.10 (aviso, período de adaptación, elección de a quién desactivar con la guía de reasignación, restricción de reservas del exceso solo como último recurso). Esperá tu aprobación: no se definió el plazo.
3. **Licencias:** Licencia Profesional (ARS 149.000, hasta 2) y Equipo (ARS 249.000, hasta 5) como parámetros de la instalación independiente (`STANDALONE_MAX_PROFESSIONALS` pasa a depender de la licencia), con condiciones claras de lo incluido el primer año y la renovación aún sin precio.
4. **Landing y onboarding:** comunicar equipo sin tecnicismos; onboarding que pregunte si trabaja solo o con equipo y deje el modo listo; capturas y piezas nuevas. Recién ahí se enciende el modo equipo y las cuentas por defecto para los planes que corresponda.
5. **Operación:** panel de plataforma con el estado de equipo/cuentas por negocio y el consumo (invitaciones y avisos internos ya se miden), análisis de costos con datos reales y prueba de carga del VPS.
6. **Pendientes de seguridad a evaluar:** autenticación de dos pasos opcional para propietarios, revocación de sesiones individuales, y auditoría de horarios.
Nada de esto se publica ni se cobra hasta tu aprobación.

