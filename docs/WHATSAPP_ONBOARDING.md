# WhatsApp automático — alta de un negocio (sin tocar código)

Este documento es el procedimiento operativo para activar WhatsApp automático en un negocio. **No requiere código, migraciones, despliegues ni comandos en el servidor**: todo se hace en Meta y en `/admin/negocios/<id>` → «WhatsApp automático». La única configuración global (una vez, para toda la plataforma) es la clave de cifrado.

> Alcance inicial: integración **opcional**, activada **a pedido** y con alta **asistida por AtajoLab**. No incluye paquetes de mensajes, recargas, cobro centralizado ni alta autónoma del negocio (Embedded Signup). Los costos y condiciones se acuerdan personalmente con cada cliente; **no se publican precios de WhatsApp**.

## 1. Validación frente a los requisitos de Meta (leer antes del primer cliente)

Qué está confirmado y qué no. **No se asume nada que no esté verificado.**

| Tema | Estado |
|---|---|
| Solo se usa la **WhatsApp Cloud API oficial**. Sin integraciones no oficiales. | Confirmado (diseño). |
| Cada negocio tiene **su propio número, su propia WABA y su propio pago a Meta** (la conversación se factura al titular de la WABA). Agendia no revende mensajes. | Confirmado (diseño) y coherente con `WHATSAPP_ANALISIS_META.md`. |
| Los mensajes iniciados por el negocio fuera de las 24 h **solo pueden ser plantillas aprobadas por Meta** (categoría *utilidad*). | Confirmado. Agendia crea las 4 plantillas y no envía texto libre fuera de la ventana. |
| El alta asistida **no elimina** los requisitos de Meta para operar sobre activos de terceros. | **Importante.** Ver abajo. |

**Dónde puede aparecer un requisito de Meta aunque el alta sea manual.** Si AtajoLab opera con **una sola aplicación de Meta** que accede a las WABA de varios negocios distintos, Meta lo considera actuar como **proveedor de tecnología (Tech Provider)**, y para eso exige: alta como Tech Provider, **verificación del negocio de AtajoLab**, **App Review con acceso avanzado** a los permisos de WhatsApp (con video, política de privacidad y términos publicados). Que la carga de credenciales la haga una persona y no un flujo automático no cambia eso.

Por eso el modelo implementado guarda **credenciales independientes por negocio**, incluido el **secreto de la aplicación**, y valida la firma del webhook con el secreto de *esa* conexión. Eso permite dos caminos, **a decidir y confirmar con Meta antes del primer cliente real**:

1. **Una aplicación de Meta por negocio** (en el portfolio del propio negocio, o creada junto con el titular): el negocio opera sobre **sus propios activos**, lo que en general funciona con *acceso estándar* y sin App Review. **Sin confirmar con Meta**: depende de cómo AtajoLab figure en el portfolio del cliente (administrador de la cuenta o proveedor) y de que no se la considere proveedor de tecnología.
2. **Una aplicación de AtajoLab para todos los negocios**: requiere Tech Provider + verificación del negocio + App Review. Es el camino del lanzamiento a escala; necesita los datos legales de AtajoLab y la política de privacidad publicada, **que hoy faltan** (no se pueden inventar).

El código admite ambos sin cambios: lo único que difiere es de quién es la aplicación cuyo secreto se carga.

**Número de prueba de Meta**: sirve para desarrollar, probar y hacer demostraciones reales supervisadas, sin verificación comercial y sin costo. Solo envía a destinatarios que se agregan y verifican en el panel de Meta (límite de destinatarios **sin confirmar**). No sirve para atender clientes reales.

## 2. Configuración global (una sola vez)

En el `.env.production` del servidor (lo ejecuta quien administra el VPS; no se hace por cada negocio):

```
WHATSAPP_ENCRYPTION_KEY=<salida de: openssl rand -base64 32>
```

- Guardar la clave en un gestor de contraseñas **aparte** del servidor. Si se pierde, hay que volver a cargar las credenciales de cada negocio.
- Rotación: poner la clave nueva en `WHATSAPP_ENCRYPTION_KEY` y la anterior en `WHATSAPP_ENCRYPTION_KEY_PREVIOUS`; lo cifrado antes se sigue leyendo y se re-cifra al guardar de nuevo.
- Opcional: `WHATSAPP_GRAPH_VERSION` (por defecto `v25.0`).
- Sin la clave, el panel no deja guardar credenciales y lo explica.

## 3. Procedimiento por negocio

### 3.1 Qué necesita del cliente
- Un **número** que no esté usado en WhatsApp ni WhatsApp Business (o que se pueda liberar) y que reciba SMS o llamada para verificarlo.
- Acceso a su **portfolio comercial de Meta** (Meta Business Suite) o permiso para crearlo con él, y su **nombre comercial** para el nombre visible.
- Una **tarjeta o medio de pago** en su cuenta de Meta (los mensajes de utilidad se le facturan a él).
- Que acepte los **términos y condiciones de WhatsApp Business** y la política de comunicaciones.

### 3.2 En Meta (developers.facebook.com / Business Manager)
1. Crear o elegir la **aplicación** (tipo *Empresa*) según el camino de la sección 1 y agregar el producto **WhatsApp**.
2. Crear la **WABA** y registrar el **número**; verificarlo por SMS/llamada y definir el **nombre para mostrar**.
3. Crear un **usuario del sistema** con acceso a esa WABA y generar un **token permanente** con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
4. Anotar: **ID de la WABA**, **ID del número de teléfono** (*Phone number ID*), el **token** y el **secreto de la aplicación** (*App Secret*, Configuración de la app → Básica).

### 3.3 En Agendia (`/admin/negocios/<id>` → «WhatsApp automático»)
1. **Guardar conexión**: cargar ID de la WABA, ID del número, token y secreto. Se guardan **cifrados**; el panel solo muestra los últimos 4 caracteres del token.
2. **Token del webhook**: «Generar token». Se muestra **una sola vez**: copiarlo.
3. En Meta → WhatsApp → Configuración → **Webhook**: URL de devolución `https://agendia.atajolab.dev/api/webhooks/whatsapp`, token de verificación = el del paso anterior; suscribirse al campo **`messages`**.
4. **Validar conexión**: Agendia consulta a Meta con las credenciales del negocio y registra el estado, el nombre verificado y la calidad.
5. **Crear/sincronizar plantillas**: Agendia crea en la WABA las 4 plantillas (confirmación, recordatorio, cancelación, reprogramación; categoría utilidad, idioma `es_AR`). **Meta las aprueba**: suele tardar de minutos a horas; volver a sincronizar hasta que figuren *Aprobadas*.
6. **Límites**: definir el **límite mensual de mensajes** (por defecto 300), los **números autorizados para pruebas** y los avisos que se envían.
7. **Enviar prueba** a un número autorizado y comprobar que llegó (historial: *Enviado → Entregado → Leído*).
8. **Activar**. Solo se deja activar con la conexión validada.
9. Avisar al cliente: en *Configuración → Integraciones* ve el estado, el consumo y el historial, y elige qué avisos enviar.

### 3.4 Qué ve y qué no ve el negocio
Puede: pedir la activación, elegir avisos y anticipación del recordatorio, ver consumo e historial (teléfonos enmascarados). **No puede**: conectar, activar, cambiar el límite ni ver credenciales.

## 4. Operación

- **Consentimiento**: se envía solo a clientes que aceptaron recibir WhatsApp al reservar (texto versionado). Pueden darse de baja respondiendo **BAJA**; se revoca y se anulan los avisos pendientes.
- **Duplicados**: cada aviso se envía a lo sumo una vez; si un envío queda en estado incierto **no se reenvía** (queda registrado como incierto para revisión manual).
- **Token vencido o revocado** (error 190 de Meta): la conexión se apaga sola, queda en *Error* con el detalle y los avisos de correo siguen funcionando. Solución: generar un token nuevo, «Guardar conexión» y «Validar».
- **Límite mensual alcanzado**: no se envían más mensajes ese mes; queda registrado y visible para el negocio.
- **Revocar credenciales** (baja del cliente o sospecha de filtración): «Revocar credenciales» borra token y secreto y apaga la integración. Además, revocar el token en Meta.
- **Auditoría**: cada cambio queda en el registro de auditoría con el administrador que lo hizo, sin secretos.
- **Calidad del número**: si Meta la baja o limita, se ve en el panel; revisar los mensajes marcados como fallidos.

## 5. Demostración con WhatsApp real (supervisada)

1. En Meta, con el número de prueba, agregar **tu celular** como destinatario verificado.
2. En `/admin` → *Demo supervisada*: crear la demo indicando **tu celular** (con característica) y/o tu correo como destinatarios autorizados.
3. En `/admin/negocios/<id de la demo>`: cargar las credenciales del número de prueba, validar, sincronizar plantillas (el número de prueba tiene `hello_world` y permite plantillas propias), enviar prueba y activar.
4. Reservar un turno en la página de la demo con tu celular y el consentimiento tildado: los mensajes llegan de verdad solo a los destinatarios autorizados; a cualquier otro se lo **simula**.
5. La **demo pública** nunca envía WhatsApp real: se ve en la vista previa.

## 6. Pendientes antes del primer cliente

- Decidir con Meta el camino de la sección 1 (aplicación por negocio vs. Tech Provider).
- Datos legales de AtajoLab y política de privacidad/términos publicados (necesarios para App Review y verificación).
- Prueba de punta a punta con el número de prueba (documentada en `docs/DEMO.md`) y con el primer número real.
- Acordar con cada cliente el costo y las condiciones del servicio (fuera de Agendia).
