# Oferta comercial y cómo se conecta con el producto (etapa 5)

Este documento es la referencia de **qué se vende, a qué precio, quién puede qué y cómo se relacionan el plan, los lugares, la suscripción y los interruptores**. Lo que dice acá sale del código (`lib/brand.ts`, `lib/plans.ts`, `lib/features.ts`, `modules/billing/*`, `modules/team/capacity.ts`); si algo no coincide, manda el código y este documento está desactualizado.

> **Estado general:** todo lo de abajo está **implementado y probado localmente** (con Mercado Pago simulado), **nada está activado ni publicado en producción** y **Mercado Pago no se probó nunca contra el sandbox real** (ver `docs/MERCADOPAGO.md`). Los textos son comerciales, **no legales** (ver `docs/LEGAL_REVIEW.md`).

Etiquetas que se usan en todos los documentos de la etapa 5: **Implementado** · **Probado localmente** · **Probado en sandbox** · **Pendiente de configuración** · **Pendiente de prueba real** · **Pendiente de activación** · **Pendiente de decisión comercial**.

## 1. La oferta (importes en ARS)

| | Plan Profesional | Plan Equipo | Licencia Profesional | Licencia Equipo |
|---|---|---|---|---|
| Precio | **9.900** por mes | **19.900** por mes | **149.000** pago único | **249.000** pago único |
| Profesionales activos | hasta **2** | hasta **5** | hasta **2** | hasta **5** |
| Permanencia | ninguna | ninguna | licencia de uso permanente | licencia de uso permanente |
| Qué incluye | todas las funciones | las mismas funciones | instalación independiente con base propia; instalación y configuración incluidas; alojamiento, dominio y soporte el primer año; sin código fuente | ídem |

- **Los dos planes mensuales incluyen exactamente lo mismo**; solo cambia la cantidad de profesionales activos (y el precio). Sin límites artificiales de turnos, clientes ni agendas.
- **Prueba gratuita:** 14 días, hasta 2 profesionales activos, funciones del Plan Profesional, sin suscripción previa y sin ningún cobro automático.
- **Licencias, desde el segundo año:** el alojamiento, el dominio y el soporte se renuevan **por separado**. **No hay precio de renovación definido** (`PRICE_LICENSE_RENEWAL` vacío) y **no se promete** actualizaciones gratuitas de por vida. *Pendiente de decisión comercial.*
- **Quién ocupa un lugar:** solo un profesional **activo** que atiende. Quien administra pero no atiende, los profesionales desactivados y las cuentas individuales **no** ocupan lugar ni se cobran.
- **No hay planes anuales ni descuentos.** Los precios no se cambian por un efecto colateral del código: ver §2.

## 2. Una sola fuente de verdad para los precios

| Qué | Dónde vive | Quién lo usa |
|---|---|---|
| **Precio de lista** (lo que se muestra) | `lib/brand.ts` → `pricing`, que lee `PRICE_MONTHLY`, `PRICE_TEAM_MONTHLY`, `PRICE_ONE_TIME`, `PRICE_LICENSE_TEAM` (con los valores acordados como predeterminados) | landing, `/precios`, `/licencia`, «Mi plan», correos, FAQ, administración, y `PLAN_CAPABILITIES` (`lib/plans.ts`) |
| **Precio contratable** (lo que se manda a Mercado Pago) | tabla `plans` (`code` = `mensual` para el Profesional, `equipo`) | `modules/billing/plan-change.ts` |
| **Importe contratado** por cada suscripción | `subscriptions.contractedAmount/contractedCurrency`, guardado al crearla | verificación al sincronizar con Mercado Pago; «Mi plan» |

**Precedencia y reglas**

1. El precio de lista se lee **en ejecución** (la landing y `/precios` ya no son estáticas): cambiar `PRICE_*` y reiniciar alcanza. *Implementado · probado localmente.*
2. `getSellablePlan()` **no deja vender** un plan si su precio en `plans` o su moneda difieren del precio de lista: devuelve un error claro y lo deja en el log. Es preferible no cobrar a cobrar un importe distinto del que se mostró. `/admin` muestra la diferencia y un botón **«Alinear con los publicados»** (auditado). Ya **no existe un campo libre de precio** en `/admin`.
3. Las **suscripciones vigentes nunca se tocan** al cambiar un precio: conservan el importe que autorizaron en Mercado Pago. Una prueba en curso conserva su plazo de 14 días.
4. La migración `20261119000000_commercial_plans` es **idempotente**: crea el Plan Equipo (19.900) si no existe y pasa el Plan Profesional de **14.000** (el valor sembrado originalmente) a **9.900 solo si todavía tiene ese valor** (si alguien lo cambió, no se toca). Probada sobre el esquema anterior con datos representativos (`test/commercial-migration.test.ts`).
5. Un test (`test/commercial.test.ts`) verifica que ningún módulo escriba los importes a mano fuera de `lib/brand.ts`.

## 3. Relación entre plan, lugares, suscripción e interruptores

```
precio de lista (lib/brand.ts)  ──►  PLAN_CAPABILITIES (lib/plans.ts)  ──►  cupo = f(plan, estado, pago verificado, extraProfessionals)
                                                                                         │
tabla plans (precio contratable) ──► suscripción (Mercado Pago) ──► estado de la cuenta ─┘
                                                                                         │
interruptores (lib/features.ts) ──► ¿puede el negocio usar modo equipo / cuentas? ───────┘
```

**Cupo de profesionales activos** (`resolveProfessionalLimit`):

| Situación | Cupo |
|---|---|
| Instalación independiente | el de su licencia (`LICENSE_TIER`: `profesional` = 2, `equipo` = 5; sin valor, 2) |
| Prueba, o cuenta cancelada / suspendida | 2 |
| Plan Profesional vigente | 2 |
| Plan Equipo **con pago verificado** | 5 |
| Plan Equipo **sin** pago verificado (suscripción pendiente, autorizada sin cobro, o volver de la pantalla de pago) | **2** |
| Cualquiera de los anteriores + `extraProfessionals` | + los cupos adicionales pactados |

**«Pago verificado»** (`hasVerifiedPayment`): hubo un cobro aprobado **consultado a Mercado Pago** (`lastPaymentAt`) y la suscripción sigue vigente (activa, en mora —se da margen— o cancelada con el período ya pago en curso). **Nunca** se expande el cupo porque la persona volvió de la pantalla de pago ni por un parámetro del navegador. *Probado localmente.*

**Interruptores** (`lib/features.ts`), todos **apagados por defecto**:

| Interruptor | Efecto |
|---|---|
| `TEAM_MODE_ENABLED=1` / `organizations.teamModeEnabled` | modo equipo (varios profesionales), global / por negocio |
| `TEAM_ACCOUNTS_ENABLED=1` / `organizations.teamAccountsEnabled` | cuentas individuales e invitaciones, global / por negocio |
| `PUBLISH_TEAM_PLANS=1` | **publicación comercial**: muestra ambos planes en la landing, acepta la intención de plan en el registro, permite contratar el Plan Equipo y habilita modo equipo y cuentas para **todos** los negocios según su plan (sin que AtajoLab active nada a mano). Se lee en ejecución. |
| `TEAM_FEATURES_PAUSED=1` | **interruptor de emergencia**: detiene la activación automática y la venta del Plan Equipo. No apaga lo que un negocio ya tiene habilitado explícitamente ni borra nada. |

Tres modos de uso (probados): **individual** (un profesional, sin interruptores), **varios profesionales sin cuentas** (solo modo equipo) y **varios con cuentas individuales** (modo equipo + cuentas). El cupo lo sigue limitando el plan en los tres.

**Activación comercial sin trabajo manual:** con `PUBLISH_TEAM_PLANS=1` cada compra habilita sola las funciones que corresponden a su plan; los interruptores por negocio (`/admin/negocios/<id>`) quedan para pilotos y soporte. **No se activó nada en producción**; el orden está en `docs/DEPLOYMENT.md` §5 (fases A–D).

## 4. Registro y onboarding

- **Registro** (`/registro`): rápido, sin elegir plan, siempre con la prueba de 14 días. Si llega desde el CTA «Empezar gratis con el Plan Equipo» (`/registro?plan=equipo`, solo con `PUBLISH_TEAM_PLANS=1`) se guarda `organizations.intendedPlan` **como intención**: no crea suscripción, no da lugares, no cobra, y la pantalla lo explica («empezás con la prueba de 14 días, con hasta 2 profesionales activos y sin ningún cobro»). *Implementado · probado localmente (unitario y E2E).*
- **Onboarding «¿Cómo trabajás?»** (solo si el negocio puede usar equipos):
  - **Trabajo por mi cuenta:** negocio → servicios → horarios (sin paso de equipo).
  - **Trabajo con otras personas:** negocio → **equipo** (¿atendés vos?, ¿quiénes más?; opcional, «Completar más tarde») → servicios → horarios. El horario habitual se copia a los profesionales que todavía no tienen uno. Respeta el cupo de la prueba (2) y lo explica; no obliga a invitar a nadie, subir fotos ni cargar todos los servicios. Sin esto AtajoLab no tiene que configurar nada a mano.
  - Sin las funciones de equipo, el onboarding es exactamente el de siempre.

## 5. «Mi plan» y quién lo ve

`/dashboard/facturacion` (solo con el permiso `billing.manage`, es decir **el propietario**): plan actual, estado, precio, próxima renovación y próximo cobro, «Estás utilizando 2 de 2 profesionales», lugares disponibles, días de prueba, qué incluye, opciones para contratar o cambiar, cancelar y descartar un cambio en curso. Si la cuenta no puede pagar online, lo dice y da el contacto; nunca ofrece un botón que no funciona.

- **Sin permiso de facturación** (administradores, profesionales): no ven «Mi plan» en el menú ni mensajes comerciales; el aviso de la cuenta (`AccountBanner`) se limita a informar un estado de solo lectura, **sin precios ni enlaces al plan**. La página y todas las acciones vuelven a exigir el permiso en el servidor. *Probado.*
- Contratar, cambiar y cancelar son del propietario autorizado; los límites se validan siempre en el servidor.

## 6. Cambios de plan y reducción de lugares

### Profesional → Equipo
Confirmación (`/dashboard/facturacion/cambiar?plan=equipo`): plan actual y nuevo, precio, lugares, cuándo rige y cuánto se paga hoy. **El plan nuevo rige recién cuando Mercado Pago confirma la autorización y un cobro aprobado** (ver `docs/MERCADOPAGO.md` §4). Mientras tanto «Mi plan» muestra «cambio en curso» y los lugares no cambian. **Pendiente de decisión comercial:** si se reintegra o acredita lo ya pagado del Plan Profesional del mes; hoy se informa que no se reintegra automáticamente.

### Equipo → Profesional (política implementada y probada)
1. La baja se programa para el **fin del período ya pago**; se informa que el Plan Profesional admite 2, se **lista a los profesionales activos** con sus turnos futuros y el propietario **elige quiénes siguen recibiendo reservas** (`professionals.keepBookable`). Puede reasignar o resolver turnos antes (flujo existente de la agenda).
2. Cuando el plan menor **empieza a regir** (primer cobro aprobado) y hay más profesionales activos que lugares, empieza el **período de adaptación**: **7 días** (`CAPACITY_GRACE_DAYS`, configurable). Durante el período todo sigue funcionando; **no se puede agregar ni reactivar** profesionales.
3. Terminado el período, los profesionales **excedentes dejan de recibir reservas nuevas** (página pública, «cualquier profesional» y turnos cargados en la agenda). Quiénes son se decide **de forma determinista**: primero los marcados por el propietario; sin elección, el criterio de continuidad **(a) quien atiende por una cuenta de propietario, (b) más turnos futuros confirmados, (c) orden del equipo**. El propietario puede cambiar la selección cuando quiera.
4. **Nunca** se borran perfiles, cuentas, membresías, clientes ni historial, y **nunca** se cancela un turno automáticamente. Los excedentes siguen atendiendo y gestionando sus turnos ya confirmados según sus permisos. Pueden **reprogramarlos**, pero no más allá de `RESCHEDULE_HORIZON_DAYS` (30) desde el fin del período (o de la fecha original del turno, la que sea posterior): la reprogramación no sirve para eludir el límite.
5. **Recontratar el Plan Equipo** (con pago verificado) devuelve el cupo completo, cierra el período y quita la restricción.
6. Se avisa **por correo al propietario** al empezar el período y al terminar (`account_notice`), una sola vez cada aviso.
7. La política se puede revisar antes de activar comercialmente: está en un solo módulo (`modules/team/capacity.ts`) con las constantes arriba. **Pendiente de decisión comercial:** confirmar los 7 días y el horizonte de 30; si se quiere un cobro proporcional al bajar.

## 7. Fin de la prueba

- **Avisos al propietario** (por correo, pocos): 3 días antes (`trial_ending`) y al terminar (`trial_ended`), una vez cada uno; incluyen la fecha, los planes disponibles (el Equipo solo si está publicado), qué pasa si no contrata y cómo recuperar el acceso completo. «Mi plan» y el aviso del panel muestran lo mismo.
- **Qué pasa si no contrata:** la cuenta pasa a **solo lectura** durante 30 días (`readonlyGraceDays`) y luego queda **pausada**; **nunca se borra** nada (clientes, turnos, profesionales, configuración).
- **Revisión de la política de solo lectura (cambio hecho):** antes, en solo lectura el propietario **no podía** cancelar ni cerrar un turno ya confirmado. Ahora, con la prueba terminada o la suscripción cancelada, **se pueden seguir gestionando los turnos ya confirmados** —cancelarlos y marcarlos como completados o ausentes— (`requireScopedManage`, `canManageExisting`); **no** se pueden crear ni mover turnos, ni se reciben reservas nuevas. Una cuenta **suspendida** no puede nada. Los clientes ya podían cancelar su turno. Los recordatorios ya programados siguen saliendo mientras el turno esté confirmado.
- **Pendiente de decisión comercial / legal:** cuánto tiempo se conservan los datos de una cuenta pausada que nunca contrata y cuándo (si alguna vez) se anonimizan o se ofrece la exportación. **No se implementó ningún borrado.** Hay que definirlo con asesoramiento legal (Ley 25.326) **antes** de cualquier cambio irreversible.

## 8. Notificaciones y costo de correo

| Tipo | Destinatario | Qué es | Estado |
|---|---|---|---|
| `booking_confirmation`, `reminder`, `reschedule`, `professional_change`, `cancellation` | **cliente** | esenciales: se mantienen | sin cambios |
| `booking_received_owner`, `reschedule_owner`, `cancellation_owner` | **interno** (propietario, administradores, profesional asignado) | operativos, con preferencia propia (`notifyBookings`) | **nuevas cuentas: apagados por defecto** (opt-in desde «Mi cuenta»); lo ya configurado **no se toca** |
| `account_notice` | propietario | fin de prueba, exceso de cupo | nuevo, pocos, una vez cada uno |
| Seguridad (verificación de email, restablecer contraseña, invitaciones) | la persona | esenciales | **nunca se desactivan** |

No hay duplicados cuando el propietario es también el profesional asignado, ni digest ni push (se evalúan a futuro). La administración de la plataforma muestra los correos del mes **por tipo y por negocio** (`/admin`), distinguiendo cliente / interno / cuenta. Estimación del costo de correo: `docs/PRODUCTION_READINESS.md` §5. No se agregó ningún plan de correo.

## 9. Vista de plataforma (AtajoLab)

`/admin` (separado de los administradores de cada negocio: exige `users.isPlatformAdmin`, que solo se otorga desde el servidor) y **`/admin/negocios/<id>`** por negocio: plan, estado de la suscripción, cambio pendiente, prueba, profesionales activos / lugares / disponibles, cuentas vinculadas e invitaciones pendientes, estado del modo equipo y de las cuentas, exceso y período de adaptación, turnos, correos por tipo y fallos recientes, y **«qué falta para cobrar»**. Acciones seguras y **auditadas** (quién, qué, valor anterior): habilitar o apagar el modo equipo y las cuentas por negocio (piloto), conciliar la suscripción con Mercado Pago, alinear precios. **Nunca** muestra contraseñas, tokens, credenciales, datos de clientes, notas ni información clínica (los errores de envío se limpian de direcciones de correo). *Probado (`test/admin-overview.test.ts`, E2E).*

## 10. Qué falta decidir o hacer antes de cobrar

Ver la lista completa en el informe de la etapa y en `docs/DEPLOYMENT.md` §5.4. Lo comercial: renovación de licencias (sin precio), reintegro al pasar de Profesional a Equipo, duración de la adaptación, retención de datos de cuentas inactivas, **textos legales** y **datos del titular** (`docs/LEGAL_REVIEW.md`), y **validar Mercado Pago en sandbox** (`docs/MERCADOPAGO.md`).
