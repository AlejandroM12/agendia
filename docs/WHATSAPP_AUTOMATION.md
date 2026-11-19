# WhatsApp: manual (disponible) y automático (diseño futuro)

**Estado:** el WhatsApp **manual** está implementado y es gratuito en todos los planes. El WhatsApp **automático** es solo un diseño: no hay código, tablas, cuentas de Meta ni cobros. Los paquetes y precios de abajo son **preliminares y no se publican**.

## 1. WhatsApp manual (disponible hoy)

Desde el detalle de un turno, el botón «WhatsApp» despliega los mensajes que tienen sentido para el estado del turno y abre un enlace `https://wa.me/<número>?text=<mensaje>`.

| Estado del turno | Opciones |
|---|---|
| Confirmado y por venir | Enviar confirmación · Enviar recordatorio · Avisar el cambio de horario · Avisar el cambio de profesional (solo negocios con equipo) · Escribir un mensaje |
| Cancelado y por venir | Escribir un mensaje · Avisar la cancelación |
| Pasado, completado o ausente | Escribir un mensaje |

Cómo funciona y qué garantiza:

- **El mensaje sale del WhatsApp de quien administra**, desde su celular o WhatsApp Web. No hay que conectar ninguna cuenta ni número en Agendia.
- **No hay envíos automáticos**: abrir WhatsApp no es enviar. Agendia no registra nada como enviado, no muestra estados de entrega o lectura y no puede saber si el mensaje salió. El código no llama a ningún proveedor (sin Cloud API, sin Twilio) y no agrega dependencias.
- **El texto lo arma el servidor con datos del propio turno** (`modules/whatsapp/messages.ts`, funciones puras): primer nombre del cliente, nombre del negocio, fecha y hora en la **zona horaria del negocio** («hoy», «mañana» o la fecha), profesional (solo si el negocio trabaja con varios) y el **enlace seguro del turno** (`/turno/<token>`, el mismo de los correos), más el teléfono del negocio si está cargado. La persona lo revisa y puede modificarlo en WhatsApp antes de enviarlo.
- **Privacidad:** nunca incluye notas internas, motivo de consulta, diagnóstico, precio ni el nombre del servicio (el módulo ni siquiera los recibe). Hay una casilla «Mensaje discreto» que además quita el nombre del profesional y los datos de contacto, pensada para salud y terapias. El único dato de acceso en los enlaces es el token de gestión del turno que ya usan los correos (24 bytes aleatorios; quien tenga el enlace puede ver, reprogramar o cancelar ese turno, igual que con el correo).
- **Teléfonos** (`lib/phone.ts`, sin dependencias): se normaliza al formato internacional que pide wa.me. Móviles argentinos: se quitan el 0 de llamada y el «15», se agrega el 9 (`011 15 5555-0000` → `5491155550000`). Los números con «+» se respetan (Uruguay, España, EE. UU., etc.). Los números sin «+» se interpretan en el país del negocio, deducido de su zona horaria. Un número inválido o sin característica **no genera enlace** y se avisa; sin teléfono, no se muestra el botón.
- **Límites conocidos:** solo se valida la forma del número (largo y dígitos); no se puede saber si tiene WhatsApp. Para países distintos de Argentina la validación es genérica (largo E.164), sin reglas de móviles por país. El botón solo aparece para roles con el permiso `customers.contact`.

Probado: normalización (formatos argentinos y de otros países, casos inválidos), codificación de caracteres especiales, textos por estado, fechas y zonas horarias, privacidad, ausencia de llamadas de red y de código de proveedores (`test/whatsapp.test.ts`), y los enlaces en navegador de escritorio y de celular emulado (`e2e/team.spec.ts`). **No se probó** abrir WhatsApp en un dispositivo físico ni en WhatsApp Web real.

## 2. WhatsApp automático (futuro, complemento de pago)

### Principios

- El correo sigue incluido y funciona aunque no haya saldo de WhatsApp. El WhatsApp manual sigue gratis.
- El automático es un complemento opcional que se contrata por separado; no sube el precio base. El negocio elige correo, WhatsApp o ambos.
- Sin mensajes ilimitados. Solo mecanismos oficiales de Meta. Sin gastos inesperados para AtajoLab: **sin saldo no hay envíos, nunca saldo negativo, nunca recargas automáticas sin consentimiento explícito**.
- La conexión pertenece al **negocio**, no al profesional: una barbería con cinco profesionales usa un canal y un saldo. Se separan: número de envío automático, número de contacto público del negocio, contacto del profesional y teléfono del cliente. Cada mensaje identifica al negocio y, si corresponde, al profesional.
- Solo propietario/administrador con permiso (nuevo permiso, p. ej. `notifications.manage`) puede contratar, comprar créditos, conectar o desconectar y cambiar preferencias.

### Modalidades a evaluar (nada está asumido como permitido)

**A. Número oficial de Agendia** (el negocio compra un paquete y listo). Antes de construir, verificar con las políticas oficiales de Meta: si se puede enviar en nombre de varios negocios, identidad y transparencia del remitente, consentimiento de los destinatarios, plantillas permitidas, gestión de respuestas, facturación, reputación y límites del número, prevención de abusos y riesgo de suspensión de un número compartido (que dejaría sin servicio a todos). Si no es viable, no se hace.

**B. Número propio del negocio**, con Embedded Signup: el propietario elige «Conectar mi WhatsApp Business», inicia sesión en Meta, elige o crea su negocio, vincula un número autorizado, otorga permisos, completa las verificaciones y recién entonces se habilitan los envíos. Evaluar la coexistencia de WhatsApp Business y Cloud API para cuentas elegibles. No todas las cuentas son compatibles y escribir un número no alcanza. Hay que investigar los requisitos de AtajoLab como proveedor tecnológico antes de empezar.

### Experiencia futura: Configuración → Notificaciones

Elegir correo, WhatsApp o ambos; configurar confirmaciones, recordatorios, cancelaciones y reprogramaciones y la anticipación del recordatorio; ver saldo, consumo y estados de entrega; comprar paquetes; administrar la conexión. Todo autogestionable: AtajoLab no interviene cada vez que alguien contrata.

### Contratación y acreditación (flujo)

1. El administrador elige un paquete. 2. Paga con Mercado Pago. 3. El webhook verifica autenticidad y estado del pago. 4. Se verifica que corresponda a la organización y al paquete. 5. Se acredita el saldo automáticamente. 6. Se habilitan las notificaciones si hay un canal autorizado y operativo. 7. El worker de recordatorios existente procesa los envíos. 8. Se registra el consumo. 9. Al agotarse el saldo se detienen los envíos de WhatsApp. 10. Se avisa al administrador que debe recargar.

### Arquitectura orientativa (no se crea nada todavía)

Modelos equivalentes a `WhatsappConnection`, `WhatsappSettings`, `MessageWallet`, `MessageTransaction`, `WhatsappDelivery` y `NotificationPreference`, siempre con `organizationId` y claves compuestas como el resto. Reutilizar el outbox de notificaciones (`notifications`, con `channel`) y el worker; sin infraestructura nueva salvo que se justifique.

Puntos de diseño a resolver al implementarlo:

- **Saldo:** una billetera por negocio con movimientos inmutables (`MessageTransaction`); el saldo es la suma, nunca un campo editable a mano. Reserva al encolar el mensaje, consumo definitivo al confirmarse el envío, liberación o devolución si falla o se cancela. Operaciones atómicas con bloqueo por negocio; el saldo no puede quedar negativo (restricción en la base).
- **Pagos:** idempotencia por identificador de pago (único); pagos duplicados, webhooks repetidos o fuera de orden no acreditan dos veces; reembolsos y contracargos revierten el crédito si no se consumió.
- **Envíos:** reintentos con límite, errores de entrega registrados, conciliación periódica entre lo cobrado a AtajoLab por Meta y lo consumido por los negocios, auditoría de cada movimiento.
- **Seguridad:** credenciales y tokens cifrados en reposo, con rotación de secretos; aislamiento total por organización; límites por negocio y por día contra abusos; solo plantillas aprobadas.
- **Consentimiento y privacidad:** consentimiento válido del destinatario, forma de darse de baja, identificación clara del remitente, mensajes discretos para profesionales de salud, protección de datos personales, prevención de spam y de daño a la reputación del número.

### Paquetes y precios preliminares (NO definitivos, NO publicados, NO contratables)

| Mensajes | Precio orientativo (ARS) |
|---:|---:|
| 50 | 3.900 |
| 100 | 7.500 |
| 200 | 13.900 |
| 500 | 29.900 |

Pendiente antes de fijar precios: tarifas efectivas de Meta para Argentina por categoría de mensaje (no se asume que las estimaciones sean correctas), mensajes facturables, gratuitos y fallidos, tipo de cambio, impuestos, comisiones de Mercado Pago, costos de intermediarios si los hubiera, margen y variaciones futuras. Pendiente de decisión comercial: vigencia de los créditos, condiciones de devolución y si se ofrecen 10 mensajes de cortesía por única vez (con protección contra abusos). No se definen unilateralmente.

### Qué no se hizo

No se creó código, tablas, migraciones ni dependencias; no se vinculó ninguna cuenta de Meta ni se contrató ningún servicio; la landing no menciona WhatsApp automático ni estos precios (hay una prueba que lo verifica).


## 3. Consistencia con la etapa 5 y otras funciones futuras (revisión)

- **WhatsApp manual** sigue siendo la única forma disponible, en **todos** los planes y licencias, sin costo adicional, y así se comunica (landing, FAQ, «Mi plan»): «mensajes preparados que enviás vos». **Ningún texto comercial promete envíos automáticos**; hay pruebas de E2E que comprueban que la landing no menciona WhatsApp automático.
- **WhatsApp automático** sigue siendo **solo un diseño**: no hay código, tablas, cuentas de Meta ni cobros, y no forma parte del Plan Profesional, del Equipo ni de las licencias. Los paquetes y precios de la §2 son **preliminares y no se publican**. Se evalúa en una etapa posterior (propuesta en el informe de cierre de la etapa 5), después de validar Mercado Pago y el lanzamiento.
- **Otras funciones futuras, no implementadas ni anunciadas:**
  - **PWA instalable** (ícono en el celular, uso sin conexión limitado) y **notificaciones *push***: requerirían un *service worker*, un manifiesto y claves VAPID; las *push* no reemplazan al correo ni son un requisito. Se evalúan después de la salida a producción.
  - **Señas (depósitos) online con Mercado Pago:** cobrar un anticipo al reservar exige pagos por negocio (cuentas conectadas de cada profesional), conciliación, reembolsos y condiciones legales propias. No se implementó ni se anuncia.
  - **Google Calendar** y **aplicaciones nativas:** fuera de alcance.
- La **recepción de mensajes** de clientes por WhatsApp (respuestas) tampoco existe; el negocio las recibe en su propio WhatsApp.
