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

## 4. Estrategia de cambio de plan (sin asumir lo que la API no documenta)

Cada plan es **su propia suscripción**; no se modifica el importe de una autorizada. El cambio se hace efectivo **solo** con la nueva autorizada **y su primer cobro aprobado y verificado**.

**Profesional → Equipo**
1. El propietario confirma (plan actual y nuevo, importe, lugares). Se crea una suscripción **Equipo** nueva (cobro inmediato al autorizar) y se guarda como **cambio pendiente** (`subscriptions.pendingPlanId/pendingProviderSubscriptionId`). El Plan Profesional **sigue vigente y cobrando**; los lugares no cambian.
2. Cuando llega un cobro aprobado de la nueva (importe y moneda verificados, suscripción consultada y `authorized`): una transacción atómica e idempotente pasa el plan, el importe contratado y el pago verificado a la nueva y deja la anterior **marcada para cancelar** (`retiredProviderSubscriptionId`); se cancela en Mercado Pago y, si falla, el worker **reintenta**.
3. **Consecuencia que se informa:** durante unos instantes pueden convivir las dos autorizaciones, pero la anterior se cancela antes de su próximo cobro; **lo ya pagado del Plan Profesional del mes no se reintegra ni se prorratea automáticamente** (*pendiente de decisión comercial*).
4. Si la persona abandona o cancela la nueva, el cambio se descarta sin tocar lo vigente. Pedir otro cambio cancela el anterior sin autorizar.

**Equipo → Profesional**
1. Se crea una suscripción **Profesional** con **`start_date` = fin del período ya pago** y se guarda como cambio pendiente (con la selección de profesionales que siguen recibiendo reservas).
2. Cuando la nueva queda **autorizada** (antes de que empiece a cobrar) se **cancela la de Equipo** (antes de su próximo cobro): no hay doble cobro y el Equipo rige hasta el último día pago (la cuenta queda «cancelada con período pago»).
3. Con el primer cobro aprobado de la Profesional se hace efectivo el plan menor y empieza el período de adaptación (`docs/COMMERCIAL.md` §6).
4. **Riesgo documentado:** si el primer cobro de la Profesional falla, la cuenta queda cancelada al terminar el período y la persona debe contratar de nuevo; se ve en `/admin` («cambio sin confirmar»). Es el costo de no cobrar dos veces.

**Alternativa a evaluar en el sandbox:** `PUT /preapproval/{id}` con un importe nuevo evitaría crear una suscripción. **No se usa** hasta comprobar (a) si exige reautorización, (b) cuándo rige y (c) qué pasa con un cobro ya generado. Si resultara seguro, simplificaría los dos cambios.

**Continuidad:** nunca se cancela una suscripción vigente antes de tener la nueva autorizada (upgrade) y nunca se habilitan lugares sin cobro verificado.

## 5. Lo que se probó y con qué (honesto)

| Qué | Cómo | Resultado |
|---|---|---|
| Lógica de contratación, cambios, importes, org equivocada, duplicados, desorden, idempotencia, cancelaciones, reintento de baja | pruebas de integración con **PostgreSQL real** y Mercado Pago **simulado** (`test/plan-change.test.ts`, `test/billing.test.ts`, `test/licenses.test.ts`, `test/commercial-actions.test.ts`) | ✔ |
| Firma del webhook | pruebas unitarias con firmas generadas localmente | ✔ |
| Formato real de las respuestas de la API, orden real de los avisos, campo `summarized`, comportamiento de `start_date`, reintentos y bajas automáticas, reembolsos | **no probado**: no hay credenciales de sandbox | **Pendiente de prueba real** |
| Recepción del webhook en una URL pública con la firma real | no probado | **Pendiente de prueba real** |
| Cobro real | **no se hizo ni se hará** hasta la aprobación | — |

> La reconciliación **no** hace efectivo un cambio de plan por el resumen de cobros (`summarized`) de la suscripción: ese campo no está confirmado en la documentación consultada. Si el aviso de un cobro se pierde, el cambio queda pendiente y visible en `/admin` hasta conciliarlo a mano o validar un mecanismo en el sandbox.

## 6. Qué falta para validar en sandbox (bloqueante para cobrar)

1. Crear en Mercado Pago una aplicación de **pruebas** y dos usuarios de prueba (vendedor y comprador) y cargar `MERCADOPAGO_ACCESS_TOKEN` (de **prueba**, `TEST-…`) y `MERCADOPAGO_WEBHOOK_SECRET`. *Pendiente de configuración.*
2. Exponer una URL pública del entorno de prueba (no se tocó DNS ni se contrató nada) y registrar el webhook con los temas `subscription_preapproval`, `subscription_authorized_payment` y `payment`.
3. Contratar el Plan Profesional y el Plan Equipo con el comprador de prueba; comprobar autorización, primer cobro, `lastPaymentAt` y el importe.
4. Probar Profesional → Equipo y Equipo → Profesional: que nunca queden dos cobros activos, que la baja de la anterior ocurra y que `start_date` difiera el primer cobro.
5. Probar rechazos (tarjetas de prueba), reintentos, baja automática tras 3 rechazos, cancelación por la persona, y reembolso / contracargo.
6. Probar la compra de la Licencia (Profesional y Equipo) con Checkout Pro y confirmar que el aviso de `payment` llega firmado.
7. Probar el `PUT /preapproval/{id}` con un importe nuevo y decidir si simplifica los cambios.
8. Repetir con eventos duplicados, desordenados y perdidos (apagar el webhook y comprobar la conciliación).

Hasta completar esto **Agendia no debe cobrar**. Detalle histórico del checklist: `docs/PRODUCTION_READINESS.md` §6.
