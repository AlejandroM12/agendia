# WhatsApp automático con facturación centralizada: Tech Provider + proveedor oficial (comparación)

> **Estado:** análisis, **nada contratado ni implementado**. Investigación del 2026-11-19 sobre documentación oficial y páginas de los proveedores. **[sin confirmar]** marca lo que no pude verificar en una fuente oficial. Complementa `docs/WHATSAPP_ANALISIS_META.md`. Los precios de venta de los paquetes **no están fijados**: los importes de venta de §5 son **hipótesis de cálculo**, no propuestas.

## 1. El modelo que se busca, y cómo se logra

El objetivo: el cliente contrata Agendia, conecta su WhatsApp con un asistente, compra paquetes en pesos con Mercado Pago y **nunca ve a Meta ni paga en dólares**.

Meta lo permite así (documentación oficial):
- **Agendia es Tech Provider** (aplicación de Meta con acceso avanzado) y **incorpora a cada negocio con Embedded Signup**: el negocio crea o elige su cuenta de WhatsApp y verifica su número dentro de la pantalla de Agendia. Los clientes mantienen la propiedad de sus activos.
- **Meta no factura a los Tech Providers** (es una regla explícita en las preguntas frecuentes de Twilio: «Meta no factura a los ISV directamente»). Hace falta un **Solution Partner / proveedor de soluciones (BSP)** que tenga la línea de crédito: es el modelo **Multi-Partner Solution**, donde los clientes «comparten la línea de crédito del Solution Partner asociado» y los cargos van a la cuenta de mensajería que envió cada mensaje.
- El BSP factura a **Agendia** (no a cada negocio) y Agendia **revende en pesos** los paquetes por Mercado Pago. Con esto el negocio no agrega ningún medio de pago en Meta.
- Límite de incorporación: **200 clientes nuevos por semana** (suficiente).

## 2. Proveedores comparados

**360dialog (Partner Platform, facturación al partner)** — datos de su página oficial
- Cuota mensual fija del partner: **Starter € 250** (incluye 5 canales/números), **Growth € 500** (10), **Premium € 1.000** (20).
- Canal adicional por mes: **€ 49** (Starter), **€ 25** (Growth), **€ 15** (Premium). Altas a mitad de mes, prorrateadas.
- Mensajes: **tarifas de Meta, sin recargo propio** («zero message markup»); los de marketing enviados por el endpoint estándar llevan un 7 %. Los primeros 1.000 mensajes de servicio por número y mes son gratis.
- Facturación en **EUR o USD** (no en pesos), pago con tarjeta con **4 % de comisión** (sin comisión con Pix/boleto, transferencia con gastos bancarios).
- Modo **«partner-paid»**: todo se factura al partner, con un saldo compartido entre canales; el partner pone sus precios a los clientes. Hay modo «direct-paid» (factura al cliente) que **no sirve** para este objetivo.
- Costo de alta: **ninguno publicado**. Soporta **coexistencia** (el negocio conserva la app WhatsApp Business), pero la página **no dice qué países** y hay condiciones de antigüedad y calidad de la cuenta; **Argentina: [sin confirmar]**.

**Twilio (Tech Provider Program)** — datos de su página y documentación
- El programa **no tiene costo**. Meta factura a Twilio y Twilio factura al ISV según su precio o contrato.
- **US$ 0,005 por mensaje, entrante o saliente**, más las tarifas de Meta («pass-through»). No encontré cuota mensual por número en su página: **[sin confirmar el cargo fijo por remitente]**. Hay US$ 0,001 por mensaje fallido.
- Modelo técnico: **una subcuenta de Twilio por cliente**, una cuenta de WhatsApp por subcuenta; Embedded Signup devuelve `waba_id` y `phone_number_id` y el alta del remitente se hace llamando a Twilio, **sin llamar a las API de Meta**. El cliente puede usar **su propio número** o uno de Twilio. Requisitos del ISV: verificación del negocio, App Review y verificación de acceso.
- El documento oficial **no menciona que el cliente deba cargar un medio de pago**. No aclara si el ISV puede revender (en la práctica es el modelo habitual; **[confirmar en el contrato]**).
- **Coexistencia:** Twilio indica que todavía no puede agregar la solución a cuentas existentes y que planea soportarlo. Para el alta de un negocio nuevo no aplica.

**Gupshup / Infobip / Zenvia / Bird (otros oficiales)**
- Gupshup: recargo del 6 % sobre marketing desde 1/1/2026 y tarifa de sesión de US$ 0,001 en su página de autoservicio; la tarifa de partner para Latinoamérica **no es pública [sin confirmar]**.
- Infobip: programa de ISV a Tech Provider y programa de revendedores por **formulario de contacto**; los precios de partner **no son públicos**.
- Zenvia, Bird y otros proveedores locales: **no encontré precios públicos**. Pedirían cotización.

## 3. Cómo lo resuelven otras plataformas de turnos
La práctica común es **medir los mensajes**, no incluirlos ilimitados, y cobrar el exceso:
- **Fresha:** algunos mensajes incluidos por mes por integrante del equipo (las fuentes discrepan entre 20 y 100) y luego un cargo por mensaje.
- **SimplyBook.me:** paquetes de créditos (**100 créditos de WhatsApp por US$ 8**, o sea ≈ US$ 0,08 por mensaje).
- **AgendaPro:** las fuentes discrepan: cupo gratis mensual y extras a US$ 7 por 50 mensajes (≈ US$ 0,14), o un complemento aparte desde 5.000 pesos chilenos por 50 mensajes.
- Nadie le pide al cliente que abra una cuenta en Meta con su tarjeta: usan un proveedor intermedio o un partner y **revenden con margen**. Estas cifras salen de blogs comparativos, no de las páginas de los proveedores: **a verificar**.

## 4. Supuestos del cálculo (todos modificables)
- Tarifa de Meta para Argentina, **utilidad ≈ US$ 0,030 por mensaje** (publicada por terceros entre 0,026 y 0,031; **la oficial en pesos no se pudo leer [sin confirmar]**).
- Tipo de cambio **ARS 1.560 por dólar** (el de referencia ya usado en los documentos) y **1 € = US$ 1,10** (supuesto).
- Un **turno** genera **2 mensajes salientes** (confirmación y recordatorio) y **1 entrante** (la respuesta con botón). Un negocio típico: **100 turnos por mes**.
- Comisión de Mercado Pago **6 %** del cobro (rango 2,2 %–7,9 %, **sin verificar**).
- Costo por mensaje saliente con Twilio ≈ **ARS 58,50** (Meta + Twilio + el entrante prorrateado); con Mercado Pago, el equilibrio ronda **ARS 62 por mensaje**.

## 5. Rentabilidad mensual por cantidad de negocios (100 turnos por negocio)
Importes en ARS; el precio de venta por mensaje es una **hipótesis**.

**Twilio (sin cuota fija)**
- A ARS 100 por mensaje: 1 negocio **+7.100**; 5: **+35.500**; 10: **+71.000**; 20: **+142.000**; 50: **+355.000**.
- A ARS 150 por mensaje: 1: **+16.500**; 5: **+82.500**; 10: **+165.000**; 20: **+330.000**; 50: **+825.000**.
- A ARS 200 por mensaje: 1: **+25.900**; 5: **+129.500**; 10: **+259.000**; 20: **+518.000**; 50: **+1.295.000**.

**360dialog (partner-paid)**
- La cuota fija sale **ARS 429.000** hasta 5 negocios, **≈ 849.000** con 10, **≈ 1.287.000** con 20 y **≈ 2.488.000** con 50.
- Por negocio: **≈ ARS 85.800** con 5 negocios, **≈ 84.900** con 10, **≈ 64.350** con 20 y **≈ 49.800** con 50.
- Resultado: **pierde dinero en todos los escenarios con 100 turnos por negocio**: con 1 negocio, **−410.000** (a ARS 150 por mensaje); con 50, **−1.546.000**. No cierra salvo que cada negocio pague **más de ARS 85.000 por mes** solo por tener el número.
- Esto sin contar que factura en EUR o USD con 4 % de recargo por tarjeta.

**Lectura:** una cuota por número de ≈ € 50 es **incompatible** con planes de ARS 9.900 y 19.900. Un proveedor **sin cuota fija por número** es el único compatible con el modelo.

## 6. Experiencia real de incorporación del cliente
Con Embedded Signup, desde un botón «Conectar WhatsApp» el negocio:
1. Inicia sesión con **Facebook** (necesita una cuenta).
2. Elige o **crea un portfolio comercial** de Meta.
3. Crea su cuenta de WhatsApp Business y **verifica el número por SMS o llamada**.
Fricciones reales: la cuenta de Facebook; y que el número **no puede estar activo en WhatsApp común**: un comercio que hoy usa WhatsApp en su celular **perdería esa línea** salvo que use un **número nuevo** (por ejemplo una línea prepaga dedicada) o **coexistencia** (no confirmada para Argentina). Esto hace que el **asistente de Agendia guíe y acompañe** y que la opción «número dedicado» sea la ruta principal.
- **Alternativa de número provisto por el proveedor:** Twilio admite sus propios números; su disponibilidad para Argentina y el costo **[sin confirmar]**.

## 7. Comenzar con un solo negocio
- Con **Twilio** es viable: sin cuota fija, sin mínimos publicados. Lo que lleva tiempo es del lado de Agendia: **verificación del negocio de AtajoLab, App Review de Meta, solicitud de acceso al programa de Twilio**, y todo eso exige los **datos legales** que todavía faltan (razón social, CUIT, domicilio, términos y privacidad publicados).
- Para desarrollar y mostrar sin esperar: el **número de prueba de Meta** (sin verificación) y un simulador propio en las pruebas.

## 8. Recomendación
**Twilio como proveedor (Tech Provider asociado a un Solution Partner con facturación centralizada a AtajoLab), un número por negocio, paquetes en pesos con Mercado Pago.**
- **Por qué:** sin cuota fija por número, el costo sube solo con el uso y siempre queda margen; el cliente no carga ningún pago en Meta; Embedded Signup lo hace dentro de Agendia; empezar con un solo negocio no cuesta cuotas.
- **Lo que debería confirmarse antes de decidir (preguntas concretas para Twilio):** cargo fijo por remitente; tarifa de Meta para Argentina en pesos y cómo se pasa; condiciones de reventa de mensajes y de facturación en dólares; números de Argentina para WhatsApp; fecha de coexistencia; plazos de alta.
- **Alternativa si la coexistencia es imprescindible:** pedir cotización a Infobip y Gupshup (no públicas) antes de descartarlas; 360dialog queda fuera por su cuota fija.
- **Riesgos:** dependencia de un solo proveedor (se mitiga con una interfaz de proveedor intercambiable); riesgo cambiario (los costos están en dólares y la venta en pesos: los paquetes deben poder reajustarse); calidad de mensajes y bloqueos de destinatarios compartida por la plataforma.

## 9. Decisiones que necesito de vos
1. ¿Avanzamos con **Twilio** como proveedor objetivo (sin contratar todavía) y que yo prepare las preguntas para su equipo comercial?
2. ¿Aceptás empezar con **número dedicado por negocio** (no coexistencia) y recomendar a los clientes una línea nueva?
3. **Precio de los paquetes:** con el costo de ≈ ARS 58,50 por mensaje y ≈ ARS 62 de equilibrio, ¿qué margen buscás? (No fijo ninguno sin tu aprobación.)
4. Datos legales de AtajoLab para la verificación de Meta (los mismos de la parte legal).

## Fuentes (2026-11-19)
- Meta, Multi-Partner Solutions: <https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/multi-partner-solutions>
- Meta, precios: <https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing>
- 360dialog, precios de partner: <https://docs.360dialog.com/partner/get-started/pricing> · modelos de facturación: <https://docs.360dialog.com/partner/get-started/billing-models> · coexistencia: <https://docs.360dialog.com/partner/waba-management/whatsapp-coexistence>
- Twilio, precios: <https://www.twilio.com/en-us/whatsapp/pricing> · Tech Provider FAQ: <https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/faq> · guía de integración: <https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide>
- Comparativas de terceros (no oficiales): blogs sobre Fresha, SimplyBook.me y AgendaPro; tablas de tarifas de proveedores de Argentina.
