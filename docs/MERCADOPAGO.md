# Mercado Pago: integración, estado real y estrategia de cambios de plan

> **Estado real, sin rodeos:** la integración está **implementada y probada con Mercado Pago simulado** (la API se reemplaza por una función en las pruebas). **Nunca se ejecutó contra el sandbox ni contra la API real**: no hay credenciales de prueba cargadas. **No se puede afirmar que funcione hasta correr el checklist de §6.** No se usó ninguna credencial productiva y no se generó ningún cobro.
> Etiquetas: **Implementado** · **Probado localmente** (simulado) · **Pendiente de prueba real** (sandbox) · **Pendiente de configuración**.

## 1. Qué usa la aplicación de Mercado Pago

| Uso | API | Estado |
|---|---|---|
| Suscripción mensual (Profesional y Equipo) | `POST /preapproval` (suscripción **sin plan asociado**, `status: "pending"`, `auto_recurring` con `frequency: 1`, `frequency_type: "months"`, `transaction_amount`, `currency_id: "ARS"`, `external_reference` = id de la organización, `payer_email`, `back_url`, y `start_date` opcional); `GET /preapproval/{id}`; `PUT /preapproval/{id}` con `status: "cancelled"` | Implementado · probado localmente · pendiente de prueba real |
| Cobros de cada período | `GET /authorized_payments/{id}` | ídem |
| Licencia (pago único) | Checkout Pro: `POST /checkout/preferences` (`external_reference: "license:<orden>"`), `GET /v1/payments/{id}`, `GET /v1/payments/search` | ídem |
| Notificaciones | un webhook configurado en «Tus integraciones» con los temas `subscription_preapproval`, `subscription_authorized_payment` y `payment`; firma `x-signature` | Implementado · probado localmente · **pendiente de configuración** |

No se guardan datos de tarjeta: la persona autoriza en Mercado Pago. No se usan SDKs: solo `fetch` (`modules/billing/mercadopago.ts`).

## 2. Qué dice la documentación oficial (verificada al 14/11/2026) y qué NO

Consultada en los sitios de desarrolladores de Mercado Pago (Argentina y regionales):

- **Temas de notificación de suscripciones:** `subscription_preapproval` (alta y cambios de la suscripción), `subscription_preapproval_plan`, `subscription_authorized_payment` (cada cobro recurrente) y `payment` (los pagos asociados). La documentación indica consultar el recurso con `GET /preapproval/…` y `GET /authorized_payments/{id}` después de recibir el aviso: **eso es lo que hace la aplicación** (nunca confía en el cuerpo del webhook).
- **Firma:** header `x-signature` (`ts=…,v1=…`) con HMAC-SHA256 sobre `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` y el secreto del webhook. Implementado en `verifyWebhookSignature` (tiempo constante, rechaza firmas de más de 10 minutos). **Excepción documentada:** con Checkout Pro, si el aviso se configura al crear el pago (`notification_url`), **no se puede validar el origen con `x-signature`**; nuestro flujo **no** usa `notification_url` y se apoya en el webhook de la aplicación en «Tus integraciones» (que sí firma) **más la consulta del pago a la API**. *Verificar en el sandbox que los avisos de `payment` llegan firmados.*
- **Cobros recurrentes:** cada cuota termina en `processed`, `waiting for gateway` o `recycling`; una cuota rechazada se **reintenta hasta 4 veces** dentro de ~10 días; tras **3 cuotas con pagos rechazados la suscripción se da de baja sola** y el vendedor recibe un correo. Consecuencia para nosotros: llega `subscription_preapproval` con `cancelled` y la cuenta pasa a «cancelada» al fin del período pago; mientras tanto el rechazo deja la cuenta en «pago pendiente».
- **Modificar una suscripción:** existe `PUT /preapproval/{id}` y su referencia permite actualizar el motivo, el medio de pago, el estado y **`auto_recurring.transaction_amount`** (la respuesta incluye un campo `version`). **La documentación consultada NO aclara** si cambiar el importe afecta cobros ya generados, si exige que la persona vuelva a autorizar, ni si hay prorrateo.
- **`start_date`** existe dentro de `auto_recurring` (la página no lo explica en detalle).

**Por todo esto no se inventó ninguna capacidad:** no se asume que se pueda cambiar el importe de una suscripción autorizada, ni prorrateo, ni upgrade automático.

## 3. Verificaciones de seguridad implementadas (`subscriptions.ts`)

| Control | Cómo | Probado |
|---|---|---|
| Identificar la organización | se busca la suscripción por **id de Mercado Pago** (vigente o pendiente); si trae `external_reference` y no coincide con la organización dueña → **rechazada** y auditada | ✔ |
| Identificar el plan | el id de Mercado Pago está ligado a una fila nuestra con su plan; un recurso ajeno se ignora | ✔ |
| Importe y moneda | `auto_recurring.transaction_amount` y `currency_id` deben coincidir con el **importe contratado** (suscripción vigente) o el precio del plan nuevo (cambio pendiente); si no → **no se aplica**, queda auditado (`rejected_amount_mismatch`). Un cobro aprobado con otro importe no habilita nada (`rejected_payment_amount`). Si la respuesta no trae `auto_recurring` no se puede verificar y no se aplica | ✔ |
| Autenticidad del webhook | firma `x-signature` + ventana de 10 min; evento sin firma válida → 401, no se registra | ✔ |
| Idempotencia | `payment_events (provider, providerEventId)` único; el estado siempre sale del recurso consultado, así que repetir un evento es inofensivo; la promoción de un cambio es un `UPDATE` condicionado | ✔ |
| Eventos duplicados y desordenados | un cobro que llega antes de que la suscripción figure autorizada no cambia nada; al llegar la autorización y repetirse el cobro, recién se aplica; un `authorized` atrasado no pisa un estado posterior consultado | ✔ |
| Pendiente / aprobado / rechazado / cancelado | `pending` → pendiente; `authorized` → activa; cobro `rejected` → en mora; `cancelled` → cancelada (el acceso ya pago se respeta hasta fin de período); `paused` → en mora | ✔ |
| Reembolsos y contracargos | **no cambian el acceso solos** (es una decisión comercial): queda registrado `subscription.payment_reversed` y se ve en la ficha del negocio. *Pendiente de decisión comercial* | ✔ (registro) |
| Conciliación | el worker reconsulta cada 6 h las suscripciones vivas y los cambios pendientes y **reintenta las bajas pendientes**; `/admin/negocios/<id>` tiene «Conciliar suscripción» | ✔ simulado |
| Doble cobro | un cambio nunca deja dos suscripciones cobrando: ver §4 | ✔ simulado |
| No confiar en el navegador | el `?retorno=1` solo muestra un aviso; no activa nada. Los **lugares del Plan Equipo** exigen un cobro aprobado consultado a la API | ✔ |
| Secretos | `MERCADOPAGO_ACCESS_TOKEN` y `MERCADOPAGO_WEBHOOK_SECRET` solo por entorno; sin ellos no se ofrece el pago online | ✔ |

## 4. Cambios de plan: alternativas y recomendación (sin asumir lo que la API no documenta)

**Objetivo:** que el cliente **no pierda injustificadamente el período que ya pagó**, sin cobrar dos veces y sin habilitar lugares sin un cobro verificado. Cada plan es **su propia suscripción**; no se modifica el importe de una autorizada. Un cambio se hace efectivo **solo** con la suscripción nueva autorizada **y su primer cobro aprobado y verificado**.

### Profesional → Equipo: alternativas evaluadas

- **A. Cobrar el Equipo hoy y cancelar el Profesional.** Los 5 lugares llegan enseguida, pero **lo ya pagado del Profesional se pierde** (no hay prorrateo automático en lo documentado). Es injusto salvo que se compense a mano. *Implementado como opción «Hoy», con el aviso explícito; no es la predeterminada.*
- **B. Empezar el Equipo al terminar el período ya pago (`start_date` = fin del período).** El cliente conserva todo lo abonado, **no paga nada extra hoy**, no hay doble cobro (la anterior se cancela al autorizarse la nueva, antes de su próximo cobro) y los 5 lugares llegan con el primer cobro del Equipo. Costo: **no puede usar más de 2 profesionales hasta renovar**. *Implementado, es la opción predeterminada y recomendada.*
- **C. Habilitar los 5 lugares ya, antes de cobrar.** Descartada: viola la regla «nunca expandir lugares sin pago verificado» (y sería el primer paso de un abuso: contratar, usar, no pagar).
- **D. Cobrar el Equipo hoy y compensar con un reintegro parcial del Profesional** (monto proporcional a los días no usados). Mercado Pago permite reembolsos (totales o parciales) sobre los pagos desde el panel o la API de pagos, pero **no se verificó en el sandbox** que aplique a cobros de suscripciones ni cómo se informa. Sería una operación **manual y auditada de AtajoLab**, no un prorrateo automático. *Pendiente de prueba real y de decisión comercial; no implementado.*
- **E. Cambiar el importe de la suscripción vigente con `PUT /preapproval/{id}`.** La documentación consultada no aclara si exige reautorización, cuándo rige ni qué pasa con un cobro ya generado. No simplifica el problema del período pago y **no se usa** hasta probarlo en sandbox.

**Recomendación:** ofrecer **B por defecto** («al terminar mi período», sin costo extra hoy) y **A como «Hoy»**, con el aviso de que lo ya abonado no se devuelve solo. Si más adelante se quiere «Hoy» sin pérdida, la vía es **D** (reintegro parcial manual), una vez validado el reembolso de cobros de suscripción en el sandbox. Nada de esto inventa prorrateos: el cliente nunca paga dos veces el mismo período sin saberlo, y nunca pierde algo que no se le haya mostrado antes de confirmar.

### Cómo se ejecuta (`modules/billing/plan-change.ts`, `subscriptions.ts`)

**Profesional → Equipo, al renovar (B)**
1. El propietario confirma (plan actual y nuevo, importe, «Rige desde <fecha>», «Pagás hoy: nada»). Se crea la suscripción **Equipo** con `start_date` = fin del período ya pago y se guarda como **cambio pendiente**. El Profesional sigue vigente y cobrando.
2. Cuando la nueva queda **autorizada** (todavía sin cobrar) se **cancela la del Profesional** (antes de su próximo cobro). El acceso ya pago sigue hasta fin de período (cuenta «cancelada con período pago», 2 lugares).
3. Con el **primer cobro aprobado** del Equipo (importe y moneda verificados, suscripción consultada y `authorized`) una transacción atómica e idempotente pasa el plan, el importe contratado y el pago verificado: recién ahí rigen los 5 lugares.
4. **Riesgo documentado:** si ese primer cobro falla, la cuenta queda cancelada al terminar el período; se ve en `/admin` («cambio sin confirmar») y la persona debe contratar de nuevo.

**Profesional → Equipo, hoy (A):** suscripción Equipo con cobro inmediato; con el primer cobro aprobado rige el plan y se cancela la anterior (con reintento desde el worker si Mercado Pago falla). **Lo ya pagado del Profesional no se reintegra solo.**

**Equipo → Profesional:** igual que B pero con el plan menor (`start_date` = fin del período pago), y al regir empieza el período de adaptación (`docs/COMMERCIAL.md` §6).

**Siempre:** un cambio abandonado se descarta sin tocar lo vigente; pedir otro cancela el anterior sin autorizar; nunca se cancela una suscripción vigente antes de tener la nueva autorizada; nunca quedan dos cobrando.

## 5. Lo que se probó y con qué (honesto)

| Qué | Cómo | Resultado |
|---|---|---|
| Lógica de contratación, cambios (inmediatos y al fin del período), importes, org equivocada, duplicados, desorden, idempotencia, cancelaciones, reintento de baja | pruebas de integración con **PostgreSQL real** y Mercado Pago **simulado** (`test/plan-change.test.ts`, `test/billing.test.ts`, `test/licenses.test.ts`, `test/commercial-actions.test.ts`) | ✔ |
| Firma del webhook | pruebas unitarias con firmas generadas localmente | ✔ |
| Formato real de las respuestas de la API, orden real de los avisos, campo `summarized`, comportamiento de `start_date`, reintentos y bajas automáticas, reembolsos | **no probado**: no hay credenciales de sandbox | **Pendiente de prueba real** |
| Recepción del webhook en una URL pública con la firma real | no probado | **Pendiente de prueba real** |
| Cobro real | **no se hizo ni se hará** hasta la aprobación | — |

> La reconciliación **no** hace efectivo un cambio de plan por el resumen de cobros (`summarized`) de la suscripción: ese campo no está confirmado en la documentación consultada. Si el aviso de un cobro se pierde, el cambio queda pendiente y visible en `/admin` hasta conciliarlo a mano o validar un mecanismo en el sandbox.

## 6. Procedimiento exacto para validar en el sandbox (bloqueante para cobrar)

**Reglas:** solo credenciales de **prueba** (`TEST-…`), usuarios de prueba, tarjetas de prueba; ninguna credencial productiva; ningún cobro real. Todo en una base **descartable** local o en un entorno de pruebas, **no** en producción.

**0. Preparación (pendiente de configuración, lo hace el titular de la cuenta de Mercado Pago)**
1. En «Tus integraciones» crear una aplicación de **pruebas** para suscripciones y Checkout Pro y copiar el *Access Token* de prueba.
2. Crear dos **usuarios de prueba** (vendedor y comprador) desde las herramientas de Mercado Pago y anotar el email del comprador (es el `payerEmail` que se ingresa en «Mi plan»).
3. Tener una URL pública **solo de pruebas** para el webhook (por ejemplo un túnel temporal a `localhost`; no se toca DNS ni producción) y registrar el webhook de pruebas con los temas `subscription_preapproval`, `subscription_authorized_payment` y `payment`; copiar el secreto.
4. Variables locales (no versionadas): `MERCADOPAGO_ACCESS_TOKEN=TEST-…`, `MERCADOPAGO_WEBHOOK_SECRET=…`, `PUBLISH_TEAM_PLANS=1`, `APP_URL`/`AUTH_URL` con la URL pública del túnel.
5. Preparar los datos: `npm run demo:seed` (negocios ficticios) o registrar una cuenta nueva.

**1. Contratar el Plan Profesional.** «Mi plan» → Plan Profesional → autorizar con el comprador de prueba. Comprobar: suscripción `pending` → `authorized`; `contractedAmount = 9900`; **autorizar no activa la cuenta (D-68)**; con el primer cobro aprobado queda `lastPaymentAt` y **recién ahí** la cuenta pasa a activa; un `payment_events` por aviso, todos procesados; `/admin/negocios/<id>` sin discrepancias.
**2. Contratar el Plan Equipo** (otra cuenta): ídem con 19.900 y confirmar que los 5 lugares aparecen **solo** tras el cobro aprobado (autorizar sin cobro no los da).
**3. Profesional → Equipo «al terminar mi período»:** que la suscripción nueva tenga `start_date` correcto, que al autorizarla se cancele la anterior, que **nunca haya dos cobros activos** y que el primer cobro habilite los 5 lugares.
**4. Profesional → Equipo «hoy»:** cobro inmediato, baja de la anterior (forzar un fallo de la baja y comprobar el reintento del worker).
**5. Equipo → Profesional:** selección de profesionales, período de adaptación de 7 días y restricción de reservas nuevas a su fin.
**6. Rechazos y bajas:** tarjetas de prueba que rechacen; observar reintentos (hasta 4), estado `recycling`, baja automática tras 3 cuotas rechazadas, y cómo llegan los avisos.
**7. Cancelación por la persona** (acceso hasta fin del período ya pago) y **reembolso / contracargo** (queda `subscription.payment_reversed`; no cambia el acceso solo).
**8. Reembolso parcial de un cobro de suscripción** (alternativa D del §4): ¿se puede?, ¿cómo se informa?
**9. `PUT /preapproval/{id}` con un importe nuevo** (alternativa E): ¿exige reautorización?, ¿cuándo rige?
**10. Licencias con Checkout Pro** (Profesional 149.000 y Equipo 249.000): cobro aprobado, rechazado, pendiente; confirmar que el aviso de `payment` llega **firmado** y que el importe y la orden se verifican.
**11. Eventos duplicados, desordenados y perdidos:** reenviar un aviso, enviarlos fuera de orden, apagar el webhook y comprobar que la conciliación (`/admin/negocios/<id>` → «Conciliar suscripción» y el worker) los recupera.
**12. Registrar los resultados** (fecha, versión, qué se probó, capturas de los avisos) en este documento y marcar cada fila de §5 como «Probado en sandbox».

**Criterio de salida:** los puntos 1–11 sin cobros duplicados, sin lugares habilitados sin cobro, con importes verificados y sin eventos sin procesar. Hasta entonces: **bloqueo comercial** («no cobrar»).
Detalle histórico del checklist: `docs/PRODUCTION_READINESS.md` §6.

## Regla del primer cobro (D-68)
- **Autorizar ≠ cobrar.** La suscripción nueva queda `pending` hasta un primer cobro aprobado y verificado (importe y moneda contra lo contratado, suscripción y organización consultadas a la API). Antes de eso la cuenta no cambia: prueba vigente (con sus días) o solo lectura.
- **Qué se ve:** «Mi plan» muestra «Esperando la confirmación de tu primer pago» o «No pudimos cobrar tu primer pago» y las alternativas (verificar el pago ahora, elegir de nuevo —reemplaza el intento anterior, sin duplicar— o escribirnos).
- **Quien ya pagó un período** conserva las renovaciones, la gracia por cobro rechazado, las cancelaciones con período pago y los cambios de plan.
- **Migración**: `20261122000000_subscription_charge_status` (aditiva: columna `subscriptions.lastChargeStatus`).
