# Preparación para producción — Agendia

Evaluación técnica y económica previa al primer despliegue real. Fecha: noviembre de 2026.

> **Nada de esto está contratado, desplegado ni cobrando.** Los precios de terceros son estimaciones tomadas de búsquedas de mercado (en su mayoría agregadores, no las páginas oficiales) y varios no coinciden entre fuentes: antes de pagar cualquier cosa hay que confirmar el precio vigente en el sitio del proveedor. Tipo de cambio usado: **US$ 1 ≈ ARS 1.570** (dólar oficial, principios de noviembre de 2026).

## 1. Resumen

- **Arquitectura recomendada para el MVP:** un VPS de 2 vCPU / 4 GB con el `docker-compose.yml` que ya está en el repositorio (probado en local y en CI). No requiere cambios de código.
- **Costo mensual estimado de mantenerla funcionando:** entre **US$ 15 y US$ 47** (≈ ARS 24.000 a 74.000) según cantidad de negocios, más la comisión de Mercado Pago por cada cobro y los impuestos.
- **Bloqueos para abrir al público** (ninguno es de código): contratar servidor y dominio, cuenta de Resend con dominio verificado, credenciales de Mercado Pago validadas en sandbox, y textos legales.
- **Mientras Resend no esté configurado, el registro permanece cerrado en producción**: sin email no hay recuperación de contraseña.

## 2. Bloqueos

| # | Bloqueo | Quién | Efecto si falta |
|---|---|---|---|
| B1 | Servidor (VPS) y dominio | Dueño | No hay dónde desplegar. |
| B2 | Cuenta de Resend + dominio verificado (`RESEND_API_KEY`, `EMAIL_FROM`) | Dueño | Registro cerrado; no salen confirmaciones, recordatorios ni recuperación de contraseña. |
| B3 | Credenciales de Mercado Pago + checklist de sandbox (§6) completo | Dueño + desarrollo | "Mi plan" muestra contacto en lugar de pago; los planes se activan a mano desde `/admin`. |
| B4 | Términos de servicio y política de privacidad | Dueño (texto legal) | No se deberían aceptar pagos ni datos de terceros sin ellos. |
| B5 | Copia externa de los backups (§8) | Dueño (elige destino) | Si se pierde el servidor, se pierden también las copias. |
| B6 | Definir la política de retención para cuentas pausadas (DECISIONS D-11) | Dueño | Los datos se conservan indefinidamente (comportamiento actual, seguro pero sin política escrita). |

Se puede lanzar una **beta cerrada** con B1 + B2 resueltos y activando planes a mano; B3 hace falta para cobrar online.

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
5. **Copia externa de `backups/`** a un object storage (centavos de dólar por mes).

Por qué no una plataforma administrada desde el inicio: cuesta entre 2 y 3 veces más para la misma carga, no sirve para la licencia de pago único y el empaquetado en Docker ya está hecho y probado. Por qué sí podría convenir: si no querés ocuparte de actualizar un servidor. Migrar a Railway más adelante es posible sin cambios de código (los mismos tres procesos); **no se migra nada sin tu aprobación**.

Cuándo revisar esta decisión: al pasar ~100 negocios, o al primer incidente de disponibilidad que le cueste dinero a un cliente. El paso siguiente natural es separar la base de datos a un servicio administrado, no cambiar de arquitectura.

## 5. Costos operativos y rentabilidad

### Costo mensual de infraestructura

| Concepto | 10 negocios | 50 negocios | 100 negocios |
|---|---|---|---|
| VPS | US$ 12–24 | US$ 24 | US$ 24 |
| Email (Resend) | US$ 0 (gratis: 3.000/mes, 100/día) o US$ 20 | US$ 20 | US$ 20 |
| Dominio (prorrateado) | ~US$ 1,5 | ~US$ 1,5 | ~US$ 1,5 |
| Copia externa de backups | ~US$ 1 | ~US$ 1 | ~US$ 1 |
| Monitor de uptime | US$ 0 | US$ 0 | US$ 0 |
| **Total** | **US$ 15–47** | **≈ US$ 47** | **≈ US$ 47** |
| **En pesos** | **ARS 24.000–74.000** | **≈ ARS 74.000** | **≈ ARS 74.000** |

Supuestos: ~100–150 turnos por negocio por mes y ~2,5 emails por turno (confirmación, recordatorio y aviso al profesional). Con 10 negocios el plan gratuito de Resend alcanza en volumen mensual pero su tope de **100 emails por día** puede cortarse en un día cargado: conviene pasar a Pro apenas haya clientes pagos.

### Ingresos y margen (plan mensual de ARS 7.900)

Comisión de Mercado Pago con tarjeta de crédito, según plazo de acreditación (cifras de prensa de 2026, **verificar en el simulador de costos de tu cuenta**; no encontré la tarifa específica de suscripciones): ≈ 2,2 % a 35 días, ≈ 5,2 % a 10 días, ≈ 7,9 % en el momento (todas con IVA incluido).

| | 10 negocios | 50 negocios | 100 negocios |
|---|---|---|---|
| Facturación mensual | ARS 79.000 | ARS 395.000 | ARS 790.000 |
| Comisión MP (2,2 %–7,9 %) | 1.700–6.200 | 8.600–31.000 | 17.100–62.000 |
| Infraestructura | 24.000–74.000 | ≈ 74.000 | ≈ 74.000 |
| **Margen antes de impuestos** | **≈ −1.000 a 53.000** | **≈ 290.000–312.000** | **≈ 654.000–699.000** |

- **Costo marginal por negocio:** ≈ ARS 350–800 por mes (comisión de cobro + emails). El cómputo adicional es despreciable. El margen por cada negocio extra es superior al 90 %.
- **Punto de equilibrio de infraestructura:** 4 negocios con la configuración mínima; 8 con Resend Pro.
- **Impuestos (no incluidos arriba):** dependen de tu situación fiscal. Como referencia, la cuota de Monotributo categoría A informada para el segundo semestre de 2026 ronda los ARS 49.500 por mes, con tope de facturación anual de ≈ ARS 12.000.000 (≈ 127 negocios a este precio). Si esta fuera tu única actividad, con 10 negocios la cuota se lleva casi todo el margen. Consultalo con tu contador; Ingresos Brutos varía por provincia.

### Evaluación de los precios actuales

- **ARS 7.900/mes equivale a ≈ US$ 5.** Cubre holgadamente el costo variable, pero el negocio recién deja margen relevante a partir de unas pocas decenas de clientes. Los costos principales (servidor, email, dominio) están en dólares y el precio en pesos: **conviene revisar el precio periódicamente** (por ejemplo, cada trimestre) para que no lo erosione la inflación. El precio es editable desde `/admin` sin tocar código.
- **ARS 99.000 por la licencia equivale a ≈ US$ 63, una sola vez** — lo mismo que 12,5 meses de un plan mensual, sin ingreso recurrente. Entregarla exige trabajo tuyo (instalación, configuración de dominio y email, verificación: estimá de 1 a 3 horas) y genera consultas de soporte. Además, **para el cliente es más cara que el SaaS**: tiene que pagar su propio servidor (≈ US$ 12–24/mes ≈ ARS 19.000–38.000, más del doble de la cuota mensual). Recomendación: mantenerla como opción para quien necesita infraestructura propia, pero cobrando **por separado la instalación y un mantenimiento anual** (actualizaciones y verificación de backups), o subir el precio de la licencia. Es una decisión comercial tuya; el producto ya describe hosting, soporte y actualizaciones como ítems aparte.

## 6. Mercado Pago: estado y checklist de sandbox

**Qué está implementado** (`modules/billing/`, `app/api/webhooks/mercadopago/`): alta de suscripción sin plan asociado (`POST /preapproval`, estado `pending`, redirección al `init_point`), webhook con validación de firma `x-signature` (HMAC-SHA256, tolerancia de 10 minutos), registro idempotente de eventos (`payment_events`), estado tomado siempre de la API y nunca del cuerpo del webhook, cancelación (`PUT /preapproval/{id}`), y reconciliación periódica desde el worker. Está cubierto por tests con respuestas simuladas; **nunca se ejecutó contra Mercado Pago real**.

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

**Puntos a confirmar durante el sandbox** (supuestos del código que solo se validan contra la API real): que `GET /preapproval/{id}` devuelve `status`, `external_reference` y `next_payment_date` como se espera; el formato exacto de `subscription_authorized_payment` y de `GET /authorized_payments/{id}`; y el valor de `data.id` que firma Mercado Pago en cada tipo de evento. Si alguno difiere, el ajuste está acotado a `modules/billing/`.

**No pasar a credenciales productivas sin tu autorización explícita.**

## 7. Licencia de pago único (instalación independiente)

**Qué se instala en la infraestructura del cliente** (todo, es una copia completa y aislada):

| Componente | Detalle |
|---|---|
| Servidor | VPS propio del cliente (2 vCPU / 2–4 GB), con Docker. |
| Dominio y DNS | Del cliente, apuntando a su servidor. HTTPS automático con Caddy. |
| Aplicación y worker | Imágenes de Docker ya construidas (`runner`), con `DEPLOYMENT_MODE=standalone`. |
| Base de datos | PostgreSQL propio, en el mismo servidor, con volumen persistente. |
| Migraciones y scripts | Imagen `migrator` (no contiene el código fuente de la app). |
| Backups | Servicio `backup` diario; la copia externa la define el cliente. |
| Email | Cuenta de Resend y dominio de envío **del cliente** (o no hay emails ni recuperación de contraseña). |

**Cómo se entrega sin transferir el código fuente:** se usa `deploy/docker-compose.standalone.yml`, que referencia imágenes en lugar de construir desde el repositorio. Las imágenes se generan con `docker build -t agendia:VERSION .` y `docker build --target migrator -t agendia-migrator:VERSION .`, y se entregan con `docker save`/`docker load` o desde un registro privado. **No clonar el repositorio en el servidor del cliente.**

**Qué cambia en modo standalone** (ya implementado): sin prueba gratuita ni restricciones por estado comercial, sin "Mi plan", sin `/admin`, sin landing ni precios (la raíz lleva al ingreso), y el registro acepta **una sola cuenta** (la primera).

**Qué necesita soporte y mantenimiento** (a presupuestar aparte, como ya dice la oferta):
- Instalación inicial: servidor, DNS, `.env.production`, verificación de email y de backups.
- Actualizaciones: entregar imágenes nuevas y correr `up -d` (las migraciones se aplican solas). Sin contrato de mantenimiento, el cliente queda en la versión instalada.
- Sistema operativo y seguridad del servidor: responsabilidad del cliente, salvo que lo contrate.
- Recuperación de acceso y restauración de backups: requieren acceso al servidor.

**Lo que todavía no existe:**
- **Verificación técnica de licencia.** El diseño con firma Ed25519 (DECISIONS D-06) no está implementado: hoy la licencia es contractual. Nada impide técnicamente reutilizar las imágenes. Decidí si alcanza con el contrato o si se implementa antes de vender la primera.
- **Envío por SMTP.** Hoy el único canal es Resend; un cliente que quiera usar su propio servidor de correo no puede.
- **Texto de la licencia de uso** (alcance, cantidad de instalaciones, actualizaciones, soporte): es un documento legal a redactar.

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
- **El registro no verifica el email.** Alguien puede crear una cuenta con un email ajeno; no accede a datos de nadie, pero ocupa ese email. Mitigación futura: verificación por email al registrarse (requiere Resend).
- **Sin segunda capa en la base (RLS)**: el aislamiento depende del código y de los tests (DECISIONS D-24).
- **Rate limiting por IP**: confía en la cabecera que pone Caddy. Es correcto mientras `web` no se exponga directamente a Internet (el compose no publica su puerto).
- **Sin doble factor** para el panel de plataforma: usar una contraseña única y larga en esa cuenta.

## 9. Recuperación de contraseña y registro

- El enlace de recuperación se envía **solo por email** (token de un uso, 1 hora, guardado como hash). En producción nunca se muestra en pantalla.
- **Registro cerrado sin email:** en producción, `/registro` solo acepta cuentas nuevas si `RESEND_API_KEY` y `EMAIL_FROM` están configurados. Si no, muestra "Todavía no abrimos el registro" con el contacto. `ALLOW_REGISTRATION_WITHOUT_EMAIL=1` lo fuerza y existe únicamente para pruebas automatizadas y staging.
- Sin email, `/olvide-contrasena` deriva a soporte en lugar de prometer un envío.
- **Respaldo de soporte:** `scripts/create-reset-link.mjs <email>` genera un enlace de un solo uso desde el servidor (queda auditado). Usarlo solo tras verificar la identidad del titular por otro medio.
- Cambiar o restablecer la contraseña cierra todas las sesiones abiertas.

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
7. **Tu cuenta:** registrarte, completar el onboarding y otorgarte el panel: `docker compose --env-file .env.production run --rm migrate node scripts/grant-admin.mjs tu@email.com`.
8. **Monitoreo:** alta de un monitor de uptime sobre `/api/health` con aviso por email.
9. **Backups:** confirmar que aparece `backups/daily/…`, correr el simulacro `./deploy/restore.sh <archivo>` y programar la copia externa.
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
