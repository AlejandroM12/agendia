# WhatsApp automático: análisis técnico, costos y decisiones (Meta Cloud API)

> **Estado:** análisis previo a implementar. **No se escribió código de WhatsApp automático.** Fecha de la investigación: 2026-11-19, sobre la documentación oficial de Meta consultada ese día. Lo que **no** pude confirmar en fuentes oficiales está marcado **[sin confirmar]**. Esto no es asesoramiento legal.
> El WhatsApp manual actual (`docs/WHATSAPP_AUTOMATION.md` §1) **se mantiene** como alternativa en todos los casos.

## 1. Qué exige Meta (documentación oficial)

**Alta técnica y comercial**
- Hace falta un **portfolio comercial de Meta** (Meta Business Suite) y una cuenta de WhatsApp Business (WABA) con un **número de negocio verificado** (por SMS o llamada) y un **nombre para mostrar** aprobado.
- Para **incorporar negocios de terceros** hay que ser **Tech Provider** o **Solution Partner** y usar **Embedded Signup**: el negocio inicia sesión en Meta, elige o crea su portfolio y su WABA, verifica su número y devuelve a nuestra aplicación `waba_id`, `phone_number_id` y un código que se canjea por un token del cliente.
- **No se puede incorporar negocios hasta que la aplicación de Meta tenga «acceso avanzado»** (App Review) para los permisos de WhatsApp. La verificación del negocio de AtajoLab no es obligatoria para empezar, pero **sube el límite de incorporación** de 10 a 200 cuentas nuevas por 7 días, junto con App Review.
- **Los clientes son dueños de sus activos:** «los negocios incorporados mediante Embedded Signup son dueños de todos sus activos de WhatsApp» y tienen acceso completo a WhatsApp Manager, algo que **no se puede restringir**.
- Embedded Signup v2 y v3 quedan **discontinuados el 15/10/2026**: hay que implementar **v4 o posterior**.

**Límites de envío**
- Un portfolio nuevo parte de **250 contactos únicos por 24 h** para mensajes fuera de la ventana de atención. Sube a **2.000** verificando el negocio (o con 2.000 envíos de calidad en 30 días) y luego escala a 10.000, 100.000 e ilimitado.
- **El límite es del portfolio** y lo comparten todos sus números: «un número puede consumir toda la capacidad del portfolio».

**Plantillas y consentimiento (política de mensajería)**
- Solo se puede **iniciar** una conversación con **plantillas aprobadas**. Fuera de la ventana de 24 h solo se pueden enviar plantillas.
- Se necesita **consentimiento explícito** antes de escribir, que cubra **cada categoría** de mensaje; el negocio es «el único responsable» de cómo lo obtiene. Hay que dar **instrucciones claras para darse de baja**, respetar los bloqueos y bajas, y mantener una **política de privacidad publicada**.
- Se puede automatizar dentro de la ventana de 24 h, pero con **vías de escalado claras** a una persona.
- **No** se puede hacerse pasar por otra empresa ni representar una afiliación falsa; **no** se puede reenviar información del chat de un cliente a otro; **no** se pueden enviar mensajes a menores de 18.
- Los usuarios pueden **bloquear y reportar**: la calidad baja y Meta limita los envíos.

**Webhooks**
- Eventos de **mensajes recibidos** (respuestas y pulsaciones de botones) y de **estados** (enviado, entregado, leído, fallido, con datos de facturación). Se suscribe la aplicación al webhook de **cada WABA** de cada cliente. *Firma `X-Hub-Signature-256` con el secreto de la aplicación y verificación inicial con token: estándar de la Graph API [a confirmar al implementar].*

## 2. Costos

**Modelo vigente (oficial):** precio **por mensaje entregado** desde el 1/7/2025. Categorías: marketing, utilidad, autenticación (plantillas) y **servicio** (respuestas libres dentro de las 24 h).
- **Desde el 1/10/2026** las respuestas de servicio y las **plantillas de utilidad dentro de la ventana de atención** **se cobran** (antes eran gratis). Cada número tiene **1.000 mensajes de servicio gratis por mes** (no se acumulan).
- La facturación en **pesos (ARS)** existe desde el 1/4/2026. Argentina tiene tarifa propia; sus tarifas de utilidad y autenticación bajaron el 1/10/2025.
- **Importes de Argentina: la página oficial no los publica en el texto** (están en archivos CSV/PDF que no pude abrir). **[sin confirmar]** Un proveedor (BSP) publica para Argentina, vigente 1/10/2026: **utilidad ≈ US$ 0,030** (0,0299), **marketing ≈ US$ 0,071**. Hay que verificarlo en la tarifa oficial antes de fijar cualquier precio.

**Estimación de consumo** (utilidad ≈ US$ 0,0299 y tipo de cambio de referencia ARS 1.560, ambos **a verificar**; dos mensajes por turno: confirmación y recordatorio; no incluye los avisos de cancelación ni reprogramación):
- 40 turnos/mes → 80 mensajes ≈ **ARS 3.700**.
- 120 turnos/mes (un profesional activo) → 240 mensajes ≈ **ARS 11.200**.
- 240 turnos/mes (dos profesionales) → 480 mensajes ≈ **ARS 22.400**.
- Un equipo de cinco, ~600 turnos/mes → 1.200 mensajes ≈ **ARS 56.000**.
- **Conclusión:** el costo de Meta de un negocio activo **iguala o supera el precio del plan** (ARS 9.900 / 19.900). El WhatsApp automático no puede ir incluido en los planes actuales: tiene que ser un **complemento pagado** o un costo que el negocio paga directamente a Meta.
- A esto se suman, si se revende con Mercado Pago, sus comisiones (2,2 %–7,9 %, sin verificar).
- Las **respuestas** de los clientes (botones) abren la ventana de 24 h; contestarles con texto libre cae dentro del cupo de **1.000 mensajes de servicio gratis por número**.

## 3. Modelos posibles para varios negocios

**A. Un número centralizado de Agendia para todos los negocios — NO recomendado.**
- Los destinatarios dieron su consentimiento **al negocio**, no a Agendia, y el remitente que ven sería «Agendia»: choca con las reglas de identidad y de consentimiento.
- Las condiciones de la plataforma **prohíben «distribuir, vender, revender o alquilar» la plataforma a terceros** y habilitan la suspensión si **un cliente** infringe. No encontré una prohibición textual del modelo, pero es el de mayor riesgo **[riesgo legal sin confirmar con Meta]**.
- **Un solo portfolio, un solo límite y una sola calidad compartidos**: un negocio que genere bloqueos puede degradar o suspender el servicio de todos.
- Es el único modelo en el que Agendia podría **vender paquetes de mensajes** como propios y cobrarlos por Mercado Pago.

**B. Una WABA y un número por negocio, con Embedded Signup (Agendia como Tech Provider) — recomendado.**
- Cada negocio es **dueño** de su WABA, con su identidad, su consentimiento, su calidad y su límite: **aislamiento real por negocio**.
- Cada negocio **agrega su medio de pago en Meta** y paga a Meta directamente (en pesos). Agendia no revende mensajes.
- Requiere: aplicación de Meta con **acceso avanzado** (App Review con video, política de privacidad y términos publicados), alta como Tech Provider, e idealmente **verificación del negocio de AtajoLab** (datos legales: razón social, CUIT, domicilio, sitio).
- Cada negocio necesita un número que **no esté ya registrado** en WhatsApp (o usar la opción C).

**C. Coexistencia (B + el negocio sigue usando la app WhatsApp Business en el mismo número).**
- Es lo más cercano a lo que hacen los comercios chicos: conservan su número y su app, y la API se suma. Los mensajes de la app siguen siendo gratis y los de la API se cobran; el historial se sincroniza (hasta 180 días).
- Limitaciones documentadas: sin grupos, sin listas de difusión, sin mensajes temporales; el caudal queda fijo en 20 mensajes por segundo.
- **No pude confirmar si está disponible en Argentina** **[sin confirmar]**: hay que consultarlo con el soporte de Meta («WABiz: Onboarding → Embedded Signup - Coexistence Onboarding»).

**D. Para desarrollo y demostraciones: el número de prueba de Meta.**
- Meta ofrece un número de prueba sin verificación comercial para enviar a un máximo de destinatarios verificados **[detalle de límites sin confirmar]**. Sirve para construir y para demostraciones reales supervisadas, sin costo.

## 4. Diseño propuesto (sin cambiar la arquitectura actual)

- **Proveedor intercambiable** (`WhatsappProvider`): `MetaCloudProvider` (oficial, el único real) y `SimulatedProvider` (para pruebas y para `/demo`, **nunca** envía nada).
- **Reutiliza el outbox y el worker** (`notifications`, tick cada 15–60 s): se agrega el canal `whatsapp` con las mismas garantías (reintentos con tope, deduplicación por clave, sin envío repetido, aislamiento por `organizationId`).
- **Conexión por negocio** (`WhatsappConnection`): `waba_id`, `phone_number_id`, token **cifrado en reposo**, estado, calidad y límite informados por Meta.
- **Consentimiento** por cliente final (`WhatsappConsent`): casilla explícita en la reserva pública, texto y versión, fecha, origen; **baja** por respuesta («BAJA») y por bloqueo de Meta; se respeta siempre y se registra.
- **Plantillas** de utilidad (es): confirmación, recordatorio, cancelación, reprogramación, con **botones de respuesta rápida** («Confirmo», «Cancelar») y un **botón con enlace** al turno (`/turno/<token>`) para reprogramar. Una pulsación de «Cancelar» pide una **segunda confirmación**; reprogramar siempre pasa por la página segura del turno.
- **Webhook de WhatsApp** propio, con verificación de firma, mapeo `phone_number_id → organización`, estados de entrega y respuestas; **historial de mensajes y estados** por turno visible en el panel.
- **Configuración por negocio**: qué avisos, con cuánta anticipación, y límite mensual de mensajes; sin saldo o con el límite alcanzado **no se envía** (y el correo sigue funcionando).
- **Paquetes y Mercado Pago:** se prepara la contabilidad de cupos y el cobro con la misma integración, **sin fijar precios** (ver decisión 2).
- Todo lo anterior se puede construir y probar **sin credenciales de Meta**, con un simulador de la API de Meta en las pruebas automatizadas.

## 5. Decisiones que necesito de vos (bloquean la implementación real)

1. **Modelo:** ¿B (WABA por negocio, recomendado), con C si Meta lo confirma para Argentina? ¿Descartamos A?
2. **Quién paga a Meta y qué significa «paquetes»:**
   - En B, **cada negocio paga a Meta** y Agendia puede cobrar un **complemento mensual por la función** (no por mensaje). Los paquetes «prepagos» con Mercado Pago **no son posibles** sin ser Solution Partner con línea de crédito de Meta.
   - Si querés vender mensajes (modelo A o Solution Partner), el riesgo legal y operativo es mucho mayor.
3. **Datos legales de AtajoLab** para Meta (verificación del negocio, App Review, Tech Provider): razón social o nombre completo, CUIT, domicilio, sitio web, **política de privacidad y términos publicados**. Son los mismos datos que faltan para la parte legal y **no se pueden inventar**.
4. **Cuenta de Meta para desarrolladores:** crear la aplicación de Meta y el portfolio comercial. **No lo creo yo.** Yo te indico exactamente qué crear y qué credenciales cargar.
5. **Precios de paquetes o complemento:** **no los fijo.** Con los costos de §2 podés decidirlos; la tarifa oficial en ARS hay que bajarla del CSV de Meta.
6. **Texto de consentimiento** que verá el cliente final al reservar (lo redacto como borrador, lo aprueba tu abogado).
7. **Uso del número de prueba de Meta** para la demostración real supervisada de la Etapa 2.

## 6. Riesgos
- App Review y la verificación del negocio pueden **demorar días o semanas** y dependen de los datos legales pendientes.
- La aprobación de plantillas es de Meta: puede rechazarlas o recategorizarlas (utilidad ↔ marketing), con distinto precio.
- Los cobros, las tarifas y los límites **cambian por calendario trimestral** de Meta.
- Lo no confirmado: tarifas oficiales de Argentina, disponibilidad de coexistencia en Argentina, límites exactos de botones por plantilla y del número de prueba.

## Fuentes consultadas (2026-11-19)
- Precios: <https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing>
- Embedded Signup: <https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview>
- Coexistencia: <https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users>
- Límites de mensajería: <https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits>
- Condiciones de la plataforma: <https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform>
- Política de mensajes: <https://whatsappbusiness.com/es-la/policy/>
- Importes de Argentina (tercero, a verificar): tabla de un BSP citada en la investigación; no es fuente oficial.
