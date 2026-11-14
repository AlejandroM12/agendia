# Preparación para producción — Agendia

Evaluación técnica y económica previa al primer despliegue real. Fecha: noviembre de 2026.

> **Nada de esto está contratado, desplegado ni cobrando.** Los precios de terceros son estimaciones tomadas de búsquedas de mercado (en su mayoría agregadores, no las páginas oficiales) y varios no coinciden entre fuentes: antes de pagar cualquier cosa hay que confirmar el precio vigente en el sitio del proveedor. Tipo de cambio usado: **US$ 1 ≈ ARS 1.570** (dólar oficial, principios de noviembre de 2026).

## 1. Resumen

- **Arquitectura recomendada para el MVP:** un VPS de 2 vCPU / 4 GB con el `docker-compose.yml` que ya está en el repositorio (probado en local y en CI). No requiere cambios de código.
- **Costo mensual estimado de mantenerla funcionando:** entre **US$ 15 y US$ 47** (≈ ARS 24.000 a 74.000) según cantidad de negocios, más la comisión de Mercado Pago por cada cobro y los impuestos.
- **Precios vigentes:** Plan Profesional ARS 9.900 por mes (14 días de prueba); Licencia independiente ARS 149.000, pago único (DECISIONS D-47). El análisis de costos y márgenes de la sección 5 ya está recalculado con estos importes y con la oferta multiprofesional futura.
- **Bloqueos para abrir al público** (ninguno es de código): contratar servidor y dominio, cuenta de Resend con dominio verificado, credenciales de Mercado Pago validadas en sandbox, y textos legales.
- **Mientras Resend no esté configurado, el registro permanece cerrado en producción**: sin email no hay recuperación de contraseña.

## 2. Bloqueos

Estado al cierre de la preparación para el lanzamiento. Lo que queda depende de cuentas y decisiones del dueño; el código y el empaquetado están listos y probados en local (ver `docs/DEPLOYMENT.md`).

| # | Bloqueo | Quién | Efecto si falta |
|---|---|---|---|
| B1 | Servidor (VPS) y dominio | Dueño | No hay dónde desplegar. |
| B2 | Cuenta de Resend + dominio verificado (`RESEND_API_KEY`, `EMAIL_FROM`) | Dueño | Registro cerrado; no salen verificación de email, confirmaciones, recordatorios ni recuperación de contraseña. |
| B3 | Credenciales de **prueba** de Mercado Pago + checklist de sandbox (§6) | Dueño + desarrollo | "Mi plan" y `/licencia` muestran contacto en lugar de pago; los planes se activan a mano desde `/admin`. |
| B4 | Términos de servicio, política de privacidad y texto de la licencia de uso | Dueño (texto legal) | No se deberían aceptar pagos ni datos de terceros sin ellos. |
| B5 | Destino de la copia externa de los backups (`deploy/rclone.conf`) | Dueño (elige destino) | Si se pierde el servidor, se pierden también las copias. |
| B6 | Valor de la renovación anual de la licencia (`PRICE_LICENSE_RENEWAL`) y qué pasa si el cliente no renueva | Dueño | El sitio dice que el valor se informa por escrito antes de comprar. |
| B7 | Credenciales **productivas** de Mercado Pago | Dueño (autorización explícita) | No hay cobros reales. |

Resueltos en el código desde la evaluación inicial: verificación de email al registrarse, compra de la licencia por Mercado Pago, instalaciones independientes alojadas en el mismo servidor, copia externa de backups y precios definitivos.

Se puede abrir a la **primera profesional** con B1 + B2 resueltos, activando su plan a mano desde `/admin`; B3 y B7 hacen falta para cobrar online.

## 3. Infraestructura: comparación

La aplicación necesita cuatro cosas: un proceso web (Next.js), un proceso worker liviano, PostgreSQL con extensión `btree_gist`, y HTTPS. Cualquier opción que dé eso sirve sin tocar el código.

| | VPS + Docker Compose | Railway | Render | Vercel + Neon |
|---|---|---|---|---|
| Encaje con el código actual | Directo (es lo que está armado y probado) | Bueno: web + worker + Postgres como tres servicios | Bueno: web + background worker + Postgres | Malo: no hay proceso worker; habría que reemplazarlo por cron de la plataforma y revisar conexiones a la base |
| Costo fijo estimado | US$ 10–24/mes | Plan US$ 5–20 + uso; ~US$ 20–35/mes | ~US$ 20–45/mes (web US$ 7 + worker US$ 7 + Postgres US$ 6–20, según fuente) | ~US$ 40–55/mes en planes sin suspensión |
| Suspensión por inactividad | No | No | No en planes pagos (sí en el gratuito) | La base suspende salvo configuración paga |
| Despliegue | `./deploy/deploy.sh` por SSH | Automático desde GitHub | Automático desde GitHub | Automático desde GitHub |
| Backups | Servicio `backup` incluido (diario, rotación) + copia externa a configurar | Incluidos según plan | Incluidos según plan | Incluidos (point-in-time) |
| Mantenimiento a cargo nuestro | Actualizaciones del sistema operativo y de Docker, firewall, disco | Casi nada | Casi nada | Casi nada |
| Escalar | Subir de plan el servidor (minutos de corte); más adelante, base separada | Deslizar recursos | Cambiar de plan | Automático |
| Sirve para la licencia de pago único | Sí, es el mismo empaquetado | No | No | No |

**Capacidad.** La carga esperada es muy baja para cualquier servidor moderno: 100 negocios con ~150 turnos mensuales cada uno son unos 15.000 turnos y ~40.000 emails por mes. Un VPS de 4 GB tiene margen de sobra para 10, 50 y 100 negocios; el primer límite real no es la capacidad sino la **disponibilidad** (un solo servidor = un solo punto de falla).

| Negocios | VPS recomendado | Costo VPS | Alternativa administrada (Railway) |
|---|---|---|---|
| 10 | 2 vCPU / 2–4 GB | US$ 10–24 | ~US$ 20–30 |
| 50 | 2 vCPU / 4 GB | US$ 20–24 | ~US$ 30–40 |
| 100 | 2 vCPU / 4 GB (evaluar 8 GB) | US$ 24–40 | ~US$ 40–60 |

**Proveedores de VPS (a verificar al contratar):**
- **Vultr** — 2 GB ≈ US$ 10–12; 4 GB ≈ US$ 20–24. Hasta donde sé, tiene regiones en Sudamérica (menor latencia desde Argentina); verificar al contratar.
- **DigitalOcean** — 2 GB ≈ US$ 12; 4 GB ≈ US$ 24. Hasta donde sé, sin región sudamericana (verificar).
- **Hetzner** — el más barato (≈ € 6 por 4 GB), pero en 2026 subió precios dos veces y, según varias fuentes, **restringió el alta de servidores nuevos**; además solo tiene centros de datos en Europa y EE. UU. No conviene planificar sobre él sin confirmar disponibilidad.
- **Hostinger** — 8 GB ≈ US$ 9 promocional, pero renueva a US$ 15–25 y exige contratos largos.

## 4. Arquitectura recomendada para el MVP

1. **Un VPS de 2 vCPU / 4 GB**, Ubuntu LTS, en la región más cercana a Argentina que ofrezca el proveedor elegido. 4 GB (y no 2) porque la imagen se construye en el propio servidor y `next build` necesita memoria.
2. **El `docker-compose.yml` del repositorio tal cual**: Caddy (HTTPS automático), web, worker, migraciones, PostgreSQL y backup diario.
3. **Resend** para email (plan gratuito para la beta; Pro al superar ~10 negocios activos).
4. **Monitor de uptime externo gratuito** sobre `https://DOMINIO/api/health`.
5. **Copia externa de los backups** a un object storage (servicio `offsite`, centavos de dólar por mes).
6. **Las licencias independientes, en el mismo servidor**, cada una como un proyecto de Compose aparte (DECISIONS D-34).

Por qué no una plataforma administrada desde el inicio: cuesta entre 2 y 3 veces más para la misma carga, no sirve para la licencia de pago único y el empaquetado en Docker ya está hecho y probado. Por qué sí podría convenir: si no querés ocuparte de actualizar un servidor. Migrar a Railway más adelante es posible sin cambios de código (los mismos tres procesos); **no se migra nada sin tu aprobación**.

Cuándo revisar esta decisión: al pasar ~100 negocios, o al primer incidente de disponibilidad que le cueste dinero a un cliente. El paso siguiente natural es separar la base de datos a un servicio administrado, no cambiar de arquitectura.

## 5. Costos operativos y rentabilidad

> **Actualizado con la oferta vigente y la futura multiprofesional** (D-47): Plan Profesional ARS 9.900/mes, Plan Equipo ARS 19.900/mes (futuro, sin publicar), Licencia Profesional ARS 149.000 y Licencia Equipo ARS 249.000 (futura). Los importes anteriores (ARS 14.000 y 199.000) ya no rigen.
>
> **Qué es dato y qué es hipótesis.** Los costos de proveedores (VPS, Resend, dominio, comisión de Mercado Pago) son **los rangos que ya estaban documentados en este archivo** (cifras de prensa y de las páginas de los proveedores al redactarlos); **no se verificaron de nuevo ni se inventó ninguna tarifa**. Todo lo demás son hipótesis explícitas, listadas abajo, que hay que reemplazar por datos reales apenas existan. Un número de esta sección no es una promesa de capacidad ni de ingresos.

### Hipótesis

- Tipo de cambio: **ARS 1.560 por US$** (el implícito en los cálculos anteriores). Hay que actualizarlo: casi todos los costos están en dólares y el precio en pesos.
- **120 turnos por profesional por mes**; **2,5 correos por turno** (confirmación, recordatorio y aviso al negocio; los de reasignación y cambio de profesional suman poco).
- Plan Profesional: **1,5 profesionales activos** en promedio (de 1 a 2); Plan Equipo: **3** (de 2 a 5). Cada profesional con foto: ≈ 60 KB.
- Dos mezclas de clientes: **A**, todos en Plan Profesional; **B**, 70 % Profesional y 30 % Equipo (el Equipo todavía no se vende).
- Comisión de Mercado Pago: **2,2 % a 7,9 %** (según plazo de acreditación; **verificar en el simulador de tu cuenta**, no se encontró la tarifa de suscripciones).
- Infraestructura: VPS de 2 vCPU / 4 GB (US$ 12–24), Resend gratuito (3.000 correos al mes, 100 por día) mientras alcance y **Resend Pro (≈ US$ 20)** cuando no, dominio ≈ US$ 1,5 prorrateado, copia externa ≈ US$ 1. **Se asume** que el plan Pro cubre el volumen de abajo: **hay que verificar el límite mensual vigente** (con 100 negocios de la mezcla B serían ≈ 58.000 correos al mes y quizá haga falta un plan superior).
- No incluye impuestos ni el valor de tu tiempo.

### Costos: fijos, variables y marginales (SaaS)

- **Fijos** (no dependen de la cantidad de negocios): VPS, dominio, monitor, copia externa. ≈ US$ 14–27 por mes con el plan gratuito de correo; ≈ US$ 47 con Resend Pro y VPS de 4 GB.
- **Escalonados:** Resend Pro al superar el tope gratuito (≈ 10 negocios activos o antes, si un día supera los 100 correos); un VPS de 8 GB si la memoria o el disco lo piden.
- **Variables por cobro:** comisión de Mercado Pago (2,2 %–7,9 % de lo que paga cada negocio).
- **Marginales por negocio nuevo:** solo la comisión de cobro y sus correos (los correos caen dentro del plan de Resend ya pagado) más **tu tiempo**: configuración inicial asistida (~1 h por negocio, hipótesis) y soporte (~0,5 h por mes, hipótesis). **El tiempo es el costo real más grande** y no está en las tablas: con ARS 9.900 por mes, cada hora de soporte consume buena parte del margen.
- **Base de datos y disco:** un turno ocupa ≈ 1 KB con índices; las fotos, ≈ 60 KB por profesional. 100 negocios de la mezcla B (≈ 195 profesionales) son ≈ 12 MB de fotos y ≈ 23.000 turnos por mes (≈ 0,3 GB por año): irrelevante frente a un disco de VPS, pero **sí crece el tamaño de cada backup diario**. La capacidad real del VPS **no está medida** (nunca se hizo una prueba de carga contra el servidor real): antes de prometer 100 negocios hay que hacerla.

### Escenarios SaaS (por mes, en ARS)

Mezcla A: solo Plan Profesional.

| Negocios | Ingresos | Infra | Comisión MP | Margen antes de tiempo e impuestos |
|---:|---:|---:|---:|---:|
| 10 | 99.000 | ≈ 72.500 | 2.200–7.800 | ≈ 18.600–24.300 |
| 25 | 247.500 | ≈ 72.500 | 5.400–19.600 | ≈ 155.000–170.000 |
| 50 | 495.000 | ≈ 72.500 | 10.900–39.100 | ≈ 383.000–412.000 |
| 100 | 990.000 | ≈ 72.500 | 21.800–78.200 | ≈ 839.000–896.000 |

Mezcla B: 70 % Profesional y 30 % Equipo.

| Negocios | Ingresos | Correos/mes | Margen antes de tiempo e impuestos |
|---:|---:|---:|---:|
| 10 | 129.000 | ≈ 5.900 | ≈ 46.000–54.000 |
| 25 | 327.500 | ≈ 14.900 | ≈ 229.000–248.000 |
| 50 | 645.000 | ≈ 29.300 | ≈ 522.000–558.000 |
| 100 | 1.290.000 | ≈ 58.500 | ≈ 1.116.000–1.189.000 |

(La infraestructura usa el techo del rango, ≈ US$ 46,5 con Resend Pro.) Lecturas:

- **Con 10 negocios el margen es de apenas ≈ ARS 1.900–2.400 por negocio y por mes** en la mezcla A: no paga ni una hora de soporte por negocio. A 25 negocios sube a ≈ ARS 6.200–6.800. **Los costos fijos pesan hasta ~15–20 negocios.**
- El Plan Equipo mejora el margen por negocio (≈ ARS 4.600–5.400 con 10 y ≈ ARS 11.000–11.900 con 100) porque el costo marginal casi no sube con la cantidad de profesionales: el costo de un profesional extra es un puñado de correos y filas.
- **Cuándo hace falta más infraestructura** (sin medir, solo señales): el plan gratuito de correo se queda corto desde ~10 negocios; un VPS de 8 GB al acercarse a 100 negocios o si `next build` y los backups compiten por memoria; separar la base de datos ante el primer incidente de disponibilidad con costo para un cliente. No se contrató ni se cambió nada.
- **Sensibilidad:** si el dólar sube un 20 % y el precio en pesos no se ajusta, la infraestructura suma ≈ ARS 14.500 por mes: a 25 negocios (mezcla A) el margen baja de ≈ 63 % a ≈ 57 % de los ingresos; con 10 negocios casi desaparece.

### Instalaciones independientes (licencias), primer año

El hosting corre en el mismo VPS (D-34): ≈ 350–450 MB de RAM por instalación (≈ US$ 3–4 por mes, estimación previa). Para la Licencia Equipo se supone un **25 % más** (más profesionales, fotos y correos): hipótesis.

| | Licencia Profesional | Licencia Equipo (futura) |
|---|---:|---:|
| Precio (ARS / ≈ US$) | 149.000 / 96 | 249.000 / 160 |
| Costos del año (hosting, dominio 0–15 US$, comisión MP) | ≈ 59.400–110.000 | ≈ 75.700–136.700 |
| **Margen antes de tiempo e impuestos** | **≈ 39.000–90.000** | **≈ 112.000–173.000** |

- **No hay costo de licencia de software de terceros** que recuperar, pero tampoco un ingreso recurrente: el ingreso es único y los costos se repiten.
- **Licencia Profesional (ARS 149.000):** con 1–2 horas de instalación y soporte durante 12 meses, **el margen real puede ser casi cero o negativo** si el cliente consume más de unas pocas horas (el margen del extremo desfavorable es de ≈ ARS 39.000 en todo el año: dividilo por el valor que le des a tu hora para saber cuántas horas de soporte lo consumen). Es sostenible **solo si el soporte es acotado y la renovación posterior está definida**.
- **Licencia Equipo (ARS 249.000):** deja ≈ 3 veces más margen absoluto; es la más sostenible, siempre que el consumo de soporte no crezca con el equipo.
- **Desde el segundo año** el hosting, dominio y soporte se renuevan por separado; **el valor no está definido (B6)**. Para no perder plata en infraestructura la renovación tendría que ser, como mínimo, de **≈ ARS 56.000–98.000 por año (Profesional)** y **≈ ARS 70.000–117.000 (Equipo)**, sin contar soporte. Como referencia, el Plan Profesional suma ARS 118.800 por año y el Equipo ARS 238.800.
- **Capacidad:** al pasar de ~6 instalaciones hay que subir el servidor o sumar otro (ver arriba): costo escalonado que hoy ninguna licencia financia después del primer año.

### Datos que hay que obtener para reemplazar las hipótesis

1. Consumo real de correos por negocio (ya disponible en `/admin` → «Consumo del mes») y el límite mensual del plan de Resend que se elija.
2. Comisión real de Mercado Pago para suscripciones y pagos únicos (simulador de la cuenta).
3. Memoria, CPU y disco del VPS contratado bajo una prueba de carga con datos de varios negocios.
4. Horas reales de configuración y soporte por negocio y por licencia (llevar un registro desde el primer cliente).
5. Costo vigente del dominio de cada instalación y del proveedor elegido.
6. Tipo de cambio y régimen impositivo.

No se decidió ni se cambió ningún precio; las conclusiones sobre la licencia de ARS 149.000 son una alerta, no una propuesta.

## 6. Mercado Pago: estado y checklist de sandbox

**Qué está implementado** (`modules/billing/`, `app/api/webhooks/mercadopago/`): compra de la licencia con un pago único de Checkout Pro (`POST /checkout/preferences`, orden en `license_orders`, confirmación por webhook `payment`, por el retorno del checkout o por reconciliación; ver casos 14 a 20), y alta de suscripción sin plan asociado (`POST /preapproval`, estado `pending`, redirección al `init_point`), webhook con validación de firma `x-signature` (HMAC-SHA256, tolerancia de 10 minutos), registro idempotente de eventos (`payment_events`), estado tomado siempre de la API y nunca del cuerpo del webhook, cancelación (`PUT /preapproval/{id}`), y reconciliación periódica desde el worker. Está cubierto por tests con respuestas simuladas; **nunca se ejecutó contra Mercado Pago real**.

**Configuración necesaria:**
1. Crear una aplicación en el panel de desarrolladores de Mercado Pago.
2. Webhooks → URL `https://DOMINIO/api/webhooks/mercadopago`, con los eventos **Planes y suscripciones** (`subscription_preapproval`, `subscription_authorized_payment`) y **Pagos**. Copiar la clave secreta que genera → `MERCADOPAGO_WEBHOOK_SECRET`.
3. Access token de **prueba** → `MERCADOPAGO_ACCESS_TOKEN` (en un entorno de staging, no en producción).
4. Crear dos usuarios de prueba (vendedor y comprador). El `back_url` debe ser HTTPS público: el sandbox no funciona contra `localhost`.

**Checklist** (marcar cada punto en staging antes de usar credenciales productivas):

| # | Caso | Cómo probarlo | Resultado esperado |
|---|---|---|---|
| 1 | Alta | Desde "Mi plan", suscribirse con el email del comprador de prueba y una tarjeta de prueba aprobada | Vuelve a "Mi plan"; en minutos la cuenta pasa a "Plan activo" con fecha de próximo cobro. En `/admin` figura "Activa". |
| 2 | Email del pagador distinto | Suscribirse con un email que no es el de la cuenta de Mercado Pago que paga | Mercado Pago lo rechaza; la cuenta sigue en prueba y se puede reintentar. |
| 3 | Abandono | Iniciar la suscripción y cerrar la pestaña en Mercado Pago | La cuenta no se activa. Queda una suscripción `pending` que no da acceso. |
| 4 | Renovación | Esperar/forzar el siguiente cobro en sandbox | Llega `subscription_authorized_payment`; se actualiza "último pago" y el próximo vencimiento; el acceso no se interrumpe. |
| 5 | Pago rechazado | Usar una tarjeta de prueba que rechace el cobro recurrente | La cuenta pasa a "Pago pendiente" con aviso visible; **sigue pudiendo operar** (período de regularización). |
| 6 | Rechazos repetidos | Dejar que Mercado Pago agote los reintentos (cancela sola tras 3 cuotas rechazadas) | Llega la cancelación; la cuenta pasa a solo lectura. Los datos se conservan. |
| 7 | Cancelación por el usuario | "Cancelar suscripción" en "Mi plan" | Estado "cancelada"; conserva el acceso hasta el fin del período pago y luego pasa a solo lectura. |
| 8 | Cancelación desde Mercado Pago | Cancelar desde la cuenta del comprador | Igual que el caso 7, disparado por webhook. |
| 9 | Webhook duplicado | Reenviar la misma notificación desde el simulador del panel | Responde 200; no cambia nada; en `payment_events` hay un solo registro. |
| 10 | Firma inválida | `curl -X POST` al webhook sin firma o con firma alterada | Responde 401; no se registra ni procesa nada. |
| 11 | Webhook perdido (reconciliación) | Detener `web` mientras se autoriza una suscripción; volver a levantarlo | Mercado Pago reintenta y/o el worker reconcilia: la cuenta termina activa sin intervención (el worker revisa suscripciones sin novedades hace más de 6 horas). |
| 12 | Reactivación | Volver a suscribirse con una cuenta cancelada o con la prueba vencida | Vuelve a "Plan activo" con todos sus datos. |
| 13 | Cuenta suspendida | Suspender desde `/admin` una cuenta con suscripción y recibir un pago | La cuenta **sigue suspendida** (la suspensión manual tiene prioridad). |

| 14 | Compra de licencia aprobada | En `/licencia`, completar el formulario, aceptar las condiciones y pagar con una tarjeta de prueba aprobada | Vuelve a `/licencia/orden/…` con "Recibimos tu pago". En `/admin` la orden figura "Pagada". Llegan dos emails: al comprador y al email de contacto. |
| 15 | Compra de licencia rechazada | Pagar con una tarjeta de prueba rechazada | La orden queda "Pago rechazado"; no se envía ningún email de compra. Reintentar con una tarjeta aprobada desde el mismo checkout la deja "Pagada". |
| 16 | Compra abandonada | Llegar al checkout y cerrar la pestaña | La orden queda "Sin pago confirmado" y no genera ningún aviso. |
| 17 | Pago en efectivo o pendiente | Elegir un medio de pago offline | La página de la orden muestra "Estamos esperando la confirmación"; pasa a "Pagada" cuando Mercado Pago acredita. |
| 18 | Webhook de pago duplicado | Reenviar la notificación `payment` desde el simulador | Responde 200 con `duplicate`; no se repiten emails ni cambia la orden. |
| 19 | Webhook de pago perdido | Detener `web` durante el pago y volver a levantarlo | Al abrir la página de la orden, o en la siguiente reconciliación (hasta 30 minutos), queda "Pagada". |
| 20 | Devolución | Devolver el pago desde la cuenta del vendedor de prueba | La orden pasa a "Devuelta". |

**Puntos a confirmar durante el sandbox** (supuestos del código que solo se validan contra la API real): que `GET /preapproval/{id}` devuelve `status`, `external_reference` y `next_payment_date` como se espera; el formato exacto de `subscription_authorized_payment` y de `GET /authorized_payments/{id}`; el valor de `data.id` que firma Mercado Pago en cada tipo de evento; y, para la licencia, que la notificación `payment` llega al webhook configurado en el panel (la preferencia no define `notification_url`) y que `GET /v1/payments/search?external_reference=…` devuelve los pagos de la orden. Si alguno difiere, el ajuste está acotado a `modules/billing/`.

**No pasar a credenciales productivas sin tu autorización explícita.**

## 7. Licencia independiente

**Qué compra el cliente** (DECISIONS D-32): licencia de uso permanente, instalación y configuración, y 12 meses de hosting, dominio y soporte. Sin entrega del código fuente.

**Cómo se vende:** `/licencia` → formulario con aceptación de las condiciones → pago único en Mercado Pago → la orden aparece como "Pagada" en `/admin` y llegan los avisos por email. Sin credenciales de Mercado Pago la página muestra el contacto en lugar del formulario.

**Cómo se entrega:** una instalación por cliente, creada con `deploy/instance.sh create <nombre> <dominio>` en el mismo servidor del SaaS (paso a paso en `docs/DEPLOYMENT.md` §9). Cada instalación tiene:

| Componente | Detalle |
|---|---|
| Aplicación y worker | Contenedores propios, con las mismas imágenes del SaaS y `DEPLOYMENT_MODE=standalone`. |
| Base de datos | PostgreSQL propio, con volumen propio. No comparte base con el SaaS ni con otras instalaciones. |
| Secretos | `AUTH_SECRET`, `CRON_SECRET` y contraseña de la base generados para esa instalación. |
| Dominio y HTTPS | El dominio del cliente (o un subdominio), con certificado automático en el proxy compartido. |
| Backups | Copia diaria propia en `instances/<nombre>/backups`, incluida en la copia externa. |
| Email | La cuenta de Resend de la plataforma; el remitente se puede personalizar por instalación. |

**Qué cambia en modo standalone:** sin prueba gratuita ni restricciones por estado comercial, sin "Mi plan", sin `/admin`, sin landing, precios ni venta de licencias (la raíz lleva al ingreso), y el registro acepta **una sola cuenta** (la primera, que verifica su email).

**Sin entrega del código:** el cliente no tiene acceso al servidor. Si alguna vez una instalación se muda a un servidor del cliente, se usa `docker-compose.standalone.yml` con el perfil `proxy` y las imágenes exportadas (`docker save`); el repositorio no se clona ahí.

**Lo que no existe y hay que decidir:**
- **Qué pasa al mes 13 si el cliente no renueva** (B6): la licencia de uso es permanente, pero el hosting es un servicio anual. No hay un corte automático: suspender una instalación es una acción manual (`docker compose -p agendia-<nombre> stop`), y entregarle sus datos, también (`instance.sh backup`).
- **Verificación técnica de licencia** (firma Ed25519, DECISIONS D-06): no implementada. Mientras las instalaciones estén alojadas por la plataforma no hace falta; solo importaría al entregar imágenes a un tercero.
- **Texto de la licencia de uso** (B4).

## 8. Seguridad multi-tenant: auditoría

Se revisaron todos los puntos de entrada: 10 archivos de server actions, 5 route handlers, las páginas con consultas y los módulos de dominio.

**Cómo está resuelto el aislamiento:** la organización nunca llega como parámetro. `lib/dal.ts` la resuelve en cada request a partir de la sesión y verifica contra la base que el usuario exista, que su sesión no haya sido invalidada y que siga siendo miembro. Toda consulta filtra por ese `organizationId`, y las escrituras por identificador usan `updateMany`/`deleteMany` con `organizationId` o una lectura previa acotada a la organización. Los identificadores son UUID; los enlaces públicos de gestión usan tokens opacos de 192 bits.

**Resultado:** no se encontró ningún acceso cruzado entre negocios en lecturas ni escrituras. Sí se encontraron y corrigieron estos problemas:

| Hallazgo | Riesgo | Corrección |
|---|---|---|
| El acceso a `/admin` se definía por una lista de emails en configuración, y el registro no verifica emails | Alguien podía registrarse con el email de un administrador que todavía no tuviera cuenta y heredar el panel de plataforma | El permiso ahora es una marca en la base (`users.isPlatformAdmin`) que solo se otorga desde el servidor (`scripts/grant-admin.mjs`) y queda auditada |
| Una reserva pública con el email de un cliente existente completaba datos faltantes de esa ficha | Un tercero podía agregarle un teléfono falso a un cliente ajeno | Las reservas públicas ya no modifican clientes existentes; solo el profesional puede completar datos |
| Los pasos del onboarding se podían reenviar con el onboarding terminado | El propio dueño (o una request repetida) podía reemplazar su lista de servicios | Las acciones del onboarding se rechazan una vez completado |
| Un cliente podía reprogramar su turno en una cuenta en solo lectura | Entraban "reservas" nuevas a una cuenta sin plan | Reprogramar exige que la cuenta pueda operar; cancelar sigue permitido |
| (Sesión anterior) Cerrar sesión no invalidaba el JWT en el servidor | Una respuesta en vuelo podía revivir la sesión | Cerrar sesión incrementa la versión de sesión |

**Tests agregados:** `test/tenant-isolation.test.ts` ejecuta las server actions reales con la sesión de un negocio y los identificadores de otro (servicios, clientes, turnos, bloqueos, búsqueda, disponibilidad, panel de plataforma, modo solo lectura y onboarding). `test/registration.test.ts` cubre la apertura del registro y la protección de fichas de clientes.

**Riesgos que quedan (aceptados o pendientes):**
- **Verificación de email: resuelto.** Una cuenta nueva no puede usar la aplicación hasta confirmar su email (§9). Una cuenta sin confirmar con un email ajeno no bloquea a su dueño real: al usar «Olvidé mi contraseña» recupera esa cuenta y cierra cualquier sesión abierta.
- **Sin segunda capa en la base (RLS)**: el aislamiento depende del código y de los tests (DECISIONS D-24).
- **Rate limiting por IP**: confía en la cabecera que pone Caddy. Es correcto mientras `web` no se exponga directamente a Internet (el compose no publica su puerto).
- **Sin doble factor** para el panel de plataforma: usar una contraseña única y larga en esa cuenta.

## 9. Recuperación de contraseña y registro

- El enlace de recuperación se envía **solo por email** (token de un uso, 1 hora, guardado como hash). En producción nunca se muestra en pantalla.
- **Registro cerrado sin email:** en producción, `/registro` solo acepta cuentas nuevas si `RESEND_API_KEY` y `EMAIL_FROM` están configurados. Si no, muestra "Todavía no abrimos el registro" con el contacto. `ALLOW_REGISTRATION_WITHOUT_EMAIL=1` lo fuerza y existe únicamente para pruebas automatizadas y staging.
- Sin email, `/olvide-contrasena` deriva a soporte en lugar de prometer un envío.
- **Respaldo de soporte:** `scripts/create-reset-link.mjs <email>` genera un enlace de un solo uso desde el servidor (queda auditado). Usarlo solo tras verificar la identidad del titular por otro medio.
- Cambiar o restablecer la contraseña cierra todas las sesiones abiertas.
- **Verificación de email:** al registrarse, la cuenta recibe un enlace (un uso, 48 horas) y no puede usar la aplicación hasta abrirlo; desde la pantalla de espera se puede pedir otro. Restablecer la contraseña desde el email también confirma la casilla. `admin:grant` solo acepta cuentas verificadas.

## 10. Configuración de Resend

1. Crear la cuenta en resend.com.
2. **Agregar y verificar el dominio de envío** (Domains → Add domain): cargar en el DNS del dominio los registros SPF y DKIM que indica Resend. Recomendado: usar un subdominio (por ejemplo `avisos.TU-DOMINIO`) y agregar un registro DMARC. Sin dominio verificado solo se puede enviar a tu propio email.
3. Crear una API key con permiso de **solo envío** → `RESEND_API_KEY`.
4. Definir el remitente con ese dominio → `EMAIL_FROM="Agendia <turnos@avisos.TU-DOMINIO>"`.
5. Verificar desde el servidor:
   ```sh
   docker compose --env-file .env.production run --rm migrate node scripts/send-test-email.mjs tu@email.com
   ```
6. Reiniciar `web` (`up -d`): el registro se abre solo y "Recordatorios" muestra el canal como **Activo**.

Ambas variables están documentadas en `.env.example` y `deploy/.env.production.example`. No hay credenciales en el repositorio.

## 11. Pasos concretos de despliegue

1. **Contratar** el VPS (2 vCPU / 4 GB, Ubuntu LTS) y registrar el dominio. Apuntar el registro A del dominio a la IP del servidor.
2. **Preparar el servidor:** usuario sin privilegios con acceso por clave SSH, firewall con solo 22/80/443, Docker Engine + plugin Compose, actualizaciones automáticas de seguridad.
3. **Clonar** el repositorio en el servidor (requiere una *deploy key* de solo lectura en GitHub).
4. **Configurar** `.env.production` a partir de `deploy/.env.production.example` (`chmod 600`): dominio, contraseña de la base, `AUTH_SECRET`, `CRON_SECRET`, contacto.
5. **Levantar:** `docker compose --env-file .env.production up -d --build`. Verificar `https://DOMINIO/api/health`.
6. **Email:** completar §10 y verificar con el script de prueba.
7. **Tu cuenta:** registrarte, confirmar el email, completar el onboarding y otorgarte el panel: `docker compose --env-file .env.production run --rm migrate node scripts/grant-admin.mjs tu@email.com`.
8. **Monitoreo:** alta de un monitor de uptime sobre `/api/health` con aviso por email.
9. **Backups:** confirmar que aparece `backups/daily/…`, correr el simulacro `./deploy/restore.sh <archivo>` y activar la copia externa (`docs/DEPLOYMENT.md` §7).
10. **Prueba de humo en producción:** crear un turno, reservar desde la página pública con otro email, verificar que llegan confirmación y aviso, cancelar desde el enlace.
11. **Publicar** términos y privacidad (B4) antes de invitar negocios.
12. **Mercado Pago:** completar §6 en staging; recién después, con tu autorización, cargar credenciales productivas.

Operación diaria, actualización, rollback y recuperación: `docs/DEPLOYMENT.md`.

## 12. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Caída del único servidor | Media | Alto (nadie puede reservar) | Monitor externo, reinicio automático, backups probados, procedimiento de reconstrucción (DEPLOYMENT §8). Objetivo realista: horas, no minutos. |
| Pérdida del servidor con sus backups | Baja | Crítico | Copia externa diaria (B5). |
| Emails que caen en spam | Media | Medio (recordatorios que no llegan) | Dominio verificado con SPF/DKIM/DMARC; remitente claro. |
| La integración de Mercado Pago difiere de lo supuesto | Media | Medio | Checklist de sandbox (§6) antes de cobrar; activación manual como respaldo. |
| Inflación sobre un precio fijo en pesos con costos en dólares | Alta | Medio | Revisión periódica del precio (editable desde `/admin`). |
| Un solo desarrollador operando | Alta | Medio | Runbook escrito, CI en cada cambio, scripts de deploy y restauración. |
| Abuso del registro o de las reservas públicas | Media | Bajo | Rate limiting en base, campo trampa, registro condicionado al email. |

## 13. Fuentes de los costos

Búsquedas de noviembre de 2026; confirmar siempre en el sitio oficial antes de contratar.

- Hetzner: bitdoze.com/hetzner-cloud-cost-optimized-plans · betterstack.com/community/guides/web-servers/hetzner-cloud-review
- DigitalOcean: infratally.com/articles/digitalocean-droplet-pricing-guide-2026 · onedollarvps.com/pricing/digitalocean-pricing.html
- Vultr y Hostinger: vpsbenchmarks.com/hosters/vultr · findstack.com/resources/hostinger-renewal-price
- Railway: railway.com/pricing (vía temps.sh/blog/railway-pricing-2026)
- Render: render.com/pricing (vía temps.sh/blog/render-pricing-2026)
- Resend: resend.com/pricing
- Mercado Pago (comisiones): ambito.com (nota n5766651) · tiendanube.com/blog/que-tarjetas-acepta-mercado-pago
- Mercado Pago (suscripciones): mercadopago.com.ar/developers/es/docs/subscriptions
- Dólar oficial: cronista.com · c5n.com (6–7 de noviembre de 2026)
- Monotributo: hacecuentas.com/datos-monotributo-2026 · cotizacion-dolar.com.ar/economia/categorias-monotributo-agosto-2026.html
