# Despliegue y operación — Agendia

Guía para poner Agendia en producción en un servidor propio (VPS) con Docker Compose y operarla día a día: el SaaS (Plan Profesional) y las instalaciones independientes (licencias) que se alojan en el mismo servidor.

> **Estado:** esta configuración se probó en una máquina local con Docker: stack completo con HTTPS (certificado de prueba), reinicio automático de la app, copia diaria y simulacro de restauración, una instalación independiente creada con `instance.sh` detrás del proxy compartido (registro, onboarding, reserva pública, `update` y `backup`), los scripts de operación y la copia externa hacia un destino de prueba. **No se probó todavía en un servidor público**: el certificado real de Let's Encrypt, el DNS, el envío por Resend, Mercado Pago, un destino externo real (B2/R2), `deploy.sh` sobre un servidor con datos y la restauración de una instalación independiente se validan en el primer despliegue.

> Un servidor encendido las 24 horas es un único punto de falla. Lo que garantiza esta configuración es que la app se reinicia sola, que los datos se copian todos los días dentro y fuera del servidor, y que una caída se detecta (sección 6).

## 1. Qué corre en el servidor

| Servicio | Función |
|---|---|
| `caddy` | HTTPS automático (Let's Encrypt) y proxy inverso del SaaS y de cada instalación independiente. Único servicio expuesto a Internet (80/443). |
| `web` | La aplicación (Next.js). |
| `worker` | Cada minuto dispara el trabajo periódico: enviar recordatorios, vencer pruebas, reconciliar pagos. |
| `migrate` | Aplica las migraciones pendientes y termina. Corre antes que `web` en cada despliegue. |
| `postgres` | Base de datos, con volumen persistente. No se expone fuera de la red interna. |
| `backup` | Copia diaria de la base con rotación. |
| `offsite` | Opcional (perfil `offsite`): sube las copias a un almacenamiento externo. |

Todos tienen `restart: unless-stopped`: vuelven solos tras una falla o un reinicio del servidor.

## 2. Requisitos

- VPS con Linux (Ubuntu LTS), **2 vCPU y 4 GB de RAM**: la imagen se construye en el servidor y cada instalación independiente suma unos 350–450 MB.
- Docker Engine con el plugin Compose, `git` y `openssl`.
- Un dominio con un registro A apuntando al servidor (y uno por cada instalación independiente, o un comodín `*.clientes.TU-DOMINIO`).
- Firewall con solo 22, 80 y 443 abiertos; acceso SSH por clave, sin contraseña; actualizaciones automáticas de seguridad.

## 3. Primera instalación

```sh
git clone git@github.com:AlejandroM12/agendia.git && cd agendia   # con una deploy key de solo lectura
cp deploy/.env.production.example .env.production
chmod 600 .env.production
# Completar .env.production (sección 4)
docker compose --env-file .env.production up -d --build
```

Verificación:

```sh
docker compose --env-file .env.production ps          # web y postgres: healthy
curl https://TU_DOMINIO/api/health                    # {"status":"ok"}
```

Después, en este orden:

1. **Email** (sección 4): hasta que no esté configurado, el registro permanece cerrado.
2. **Tu cuenta:** registrarte en `https://TU_DOMINIO/registro`, abrir el enlace de verificación que llega por email y completar el onboarding.
3. **Panel de plataforma** (`/admin`), desde el servidor:
   ```sh
   docker compose --env-file .env.production run --rm migrate node scripts/grant-admin.mjs tu@email.com
   ```
   Solo funciona con cuentas que ya confirmaron su email. `--revoke` al final lo quita.
4. **Monitoreo** (sección 6) y **copia externa** (sección 7).
5. **Prueba de humo:** reservar desde tu página pública con otro email, verificar que llegan la confirmación y el aviso, reprogramar y cancelar desde el enlace del email.

## 4. Variables y secretos

Todas están documentadas en `deploy/.env.production.example`. `.env.production` vive solo en el servidor, nunca en el repositorio.

| Variable | Qué es | De dónde sale |
|---|---|---|
| `DOMAIN` | Dominio público, sin `https://` | El que registraste |
| `POSTGRES_PASSWORD` | Contraseña de la base | `openssl rand -hex 24` |
| `AUTH_SECRET` | Firma de las sesiones | `openssl rand -base64 32` |
| `CRON_SECRET` | Secreto entre `web` y `worker` | `openssl rand -base64 32` |
| `CONTACT_EMAIL` | Email de contacto que muestra el sitio y que recibe los avisos de licencias vendidas | Tuyo |
| `RESEND_API_KEY`, `EMAIL_FROM` | Envío de emails | Resend (abajo) |
| `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` | Cobros | Mercado Pago (abajo) |
| `PRICE_MONTHLY`, `PRICE_TEAM_MONTHLY`, `PRICE_ONE_TIME`, `PRICE_LICENSE_TEAM`, `PRICE_LICENSE_RENEWAL` | Precios que muestra el sitio; `PRICE_ONE_TIME` es además lo que se cobra por la licencia | Decisión comercial |
| `COMPOSE_PROFILES`, `OFFSITE_REMOTE` | Copia externa de backups | Sección 7 |

**Desde la etapa 5** la landing y `/precios` leen los precios y la publicación de planes **en ejecución** (ver §11): alcanza con reiniciar `web`. El dominio y los datos de `sitemap`/`robots` se siguen fijando **al construir la imagen**: después de cambiarlos hay que desplegar de nuevo (`./deploy/deploy.sh`). El precio que efectivamente se cobra en las suscripciones se edita en `/admin` y tiene que coincidir con `PRICE_MONTHLY`.

**Rotar `AUTH_SECRET`** cierra todas las sesiones. **Rotar `CRON_SECRET`** no tiene efecto visible. En ambos casos: editar el valor y `docker compose --env-file .env.production up -d`.

### Resend (email)

1. Crear la cuenta en resend.com y **verificar el dominio de envío** (Domains → Add domain): cargar en el DNS los registros SPF y DKIM que indica. Recomendado: un subdominio (`avisos.TU-DOMINIO`) y un registro DMARC.
2. Crear una API key con permiso de **solo envío** → `RESEND_API_KEY`. Definir `EMAIL_FROM="Agendia <turnos@avisos.TU-DOMINIO>"`.
3. `docker compose --env-file .env.production up -d` y probar:
   ```sh
   docker compose --env-file .env.production run --rm migrate node scripts/send-test-email.mjs tu@email.com
   ```

Con el email configurado se abre el registro, y cada cuenta nueva tiene que confirmar su email antes de usar la aplicación.

### Mercado Pago

1. Crear una aplicación en el panel de desarrolladores.
2. Webhooks → URL `https://TU_DOMINIO/api/webhooks/mercadopago`, eventos **Pagos** y **Planes y suscripciones**. La clave secreta que genera → `MERCADOPAGO_WEBHOOK_SECRET`.
3. Access token → `MERCADOPAGO_ACCESS_TOKEN`. **Primero el de prueba**, y completar el checklist de `docs/PRODUCTION_READINESS.md` §6 (20 casos: suscripción y licencia). El token productivo se carga recién con autorización del dueño.

Sin estas credenciales la app funciona igual: "Mi plan" y `/licencia` muestran el contacto en lugar del pago, y los planes se activan a mano desde `/admin` → **Activar**.

## 5. Actualizar y volver atrás

```sh
./deploy/deploy.sh            # despliega origin/main
./deploy/deploy.sh <commit>   # vuelve a una versión anterior
./deploy/instance.sh update-all   # después, si hay instalaciones independientes
```

El script hace una copia de la base, construye, migra, reemplaza los contenedores y verifica `/api/health`. Antes de desplegar, el CI de GitHub debe estar en verde en `main`.

**Migraciones:** son solo hacia adelante. Un cambio que rompe compatibilidad (borrar una columna o tabla) se despliega en una versión posterior a la que deja de usarla, nunca en la misma. Si una migración sale mal, se restaura la copia `backups/pre-deploy-*.sql.gz` que el script generó (sección 7) y se vuelve al commit anterior.

### Versión con páginas públicas personalizables

No agrega variables de entorno ni servicios. Incluye una migración (`public_page_customization`) que **solo agrega** columnas con valores por defecto y tres tablas nuevas: los negocios existentes conservan su página, su enlace y su aspecto.

```sh
cd agendia
git fetch origin && git log --oneline HEAD..origin/main   # revisar qué entra
./deploy/deploy.sh                                        # copia previa + build + migración + reemplazo + health
./deploy/instance.sh update-all                           # solo si hay instalaciones independientes
```

Verificación después de desplegar: abrir la página pública de un negocio existente (debe verse y reservar como antes), `/dashboard/pagina` (subir un logo y guardarlo), y `https://TU_DOMINIO/<negocio>/og` (debe devolver una imagen).

**Rollback:** `./deploy/deploy.sh <commit anterior>`. Como la migración es aditiva, la versión anterior funciona con la base ya migrada y no hace falta restaurar la copia; lo personalizado queda guardado y vuelve a verse al redesplegar. La copia `backups/pre-deploy-*.sql.gz` que genera el script solo se usa si se quiere volver también el esquema (`./deploy/restore.sh <copia> --replace`, que descarta lo cargado después de esa copia).

La imagen se construye en el servidor y descarga tres tipografías más de Google Fonts durante el build: necesita salida a Internet, igual que antes.

### Versión con formularios y pantallas de cuenta mejorados

Sin migraciones, sin variables de entorno y sin dependencias nuevas: es solo código. Se despliega con `./deploy/deploy.sh` (y `./deploy/instance.sh update-all` si hay instalaciones independientes). Verificación: en `/registro` los requisitos de contraseña se ven desde el inicio; en una página pública, confirmar una reserva sin email ni WhatsApp marca los campos sin borrar el nombre ni el horario elegido. Rollback: `./deploy/deploy.sh <commit anterior>`, sin pasos sobre la base.

### Despliegue acumulado de las etapas 1 a 4 y de la nueva oferta (orden y verificaciones)

Todavía **nada de esto está en producción**. Orden recomendado, para evitar inconsistencias temporales (los precios de las páginas públicas se fijan al **construir la imagen**; el cobro sale de la base):

1. **Antes de empezar:** CI verde en `main`; `git log HEAD..origin/main` revisado; copia de seguridad (`deploy/backup.sh`) y comprobar que se puede leer.
2. **Precio del plan en `/admin`** (versión vigente, antes de desplegar): cambiar «Precio del Plan Profesional» de 14.000 a **9.900**. Durante unos minutos la página mostrará el precio viejo y se cobrará el nuevo (menor que el anunciado): la inconsistencia menos dañina. Solo afecta a las suscripciones que se inicien después; **no se modifican suscripciones existentes**.
3. **`.env.production`** (antes de `deploy.sh`, que lo lee al construir): `PRICE_MONTHLY=9900`, `PRICE_ONE_TIME=149000`, `PRICE_LICENSE_RENEWAL=` (vacía: la renovación no está definida) y `TEAM_MODE_ENABLED=` (vacía: modo equipo deshabilitado) y `TEAM_ACCOUNTS_ENABLED=` (vacía: cuentas individuales e invitaciones deshabilitadas). Nombres verificados contra `docker-compose.yml`, `Dockerfile` y `deploy/.env.production.example`.
4. **`./deploy/deploy.sh`**: copia previa → construcción (toma los precios) → `up -d` (el servicio `migrate` aplica las cinco migraciones **antes** de que arranque `web`: `team_foundation`, `professional_photos`, `professional_change_notification`, `notification_payload`, `accounts_and_invitations`) → espera a `/api/health`. No hay una ventana en la que la aplicación nueva corra sin las migraciones.
5. **Instalaciones independientes:** `./deploy/instance.sh update-all` (cada una hace su copia previa). Su `.env` lleva su propio `TEAM_MODE_ENABLED`, vacío.

**Verificaciones posteriores** (todas deben pasar; si una falla, ver rollback abajo):

- Contenedores: `docker compose --env-file .env.production ps` (web, worker, postgres, caddy y backup arriba; `migrate` terminó en 0).
- Health: `curl -fsS https://DOMINIO/api/health`.
- Migraciones: `docker compose --env-file .env.production run --rm migrate npx prisma migrate status` (sin pendientes) y `node scripts/verify-team-data.mjs` (termina en «OK», totales iguales a los de antes).
- Precio visible: la landing y `/precios` muestran **$9.900** y **$149.000**; la licencia aclara que desde el segundo año se renueva por separado.
- Precio efectivo: «Mi plan» de una cuenta en prueba muestra 9.900; `/admin` muestra 9.900 (y, en sandbox, la suscripción se crea por 9.900; sin cobros reales).
- Registro: crear una cuenta de prueba; su prueba vence **14 días** después (`trialEndsAt`).
- Reserva de un solo profesional: una reserva pública completa en un negocio existente; **sin paso de profesional**, comportamiento de siempre.
- Correos: la confirmación llega (o queda registrada en «Recordatorios»); sin la línea «Profesional».
- Gestión del turno: «Ver mi turno», reprogramar y cancelar funcionan; «Consultá tus turnos» envía el enlace.
- WhatsApp manual: desde un turno con teléfono válido, «WhatsApp» abre `wa.me` con el mensaje armado.
- Cuentas individuales: `/invitacion/<cualquier-token>` muestra «Esta invitación no es válida» y ningún negocio puede invitar (`team-mode.mjs <enlace>` muestra «cuentas individuales apagadas»). Un propietario existente entra a su negocio como siempre, sin pasos extra, y `/dashboard/perfil` («Mi cuenta») carga.
- Modo equipo deshabilitado: `/dashboard/equipo` dice que no está habilitado; ninguna página pública muestra elección de profesional; `scripts/team-mode.mjs` lista negocios sin ninguno encendido.

**Rollback acumulado.** Con el modo equipo apagado en todos los negocios y **sin** fotos de profesionales ni avisos `professional_change` (lo esperable justo después de desplegar): `./deploy/deploy.sh 81d974b` y listo; la base ya es compatible (trigger de compatibilidad de horarios, columnas nuevas opcionales). Si ya hay fotos de profesionales, avisos `professional_change` o **accesos de profesionales o administradores** (etapa 4): antes de volver atrás, `node scripts/prepare-rollback.mjs` (informa) y `--apply` (aparta sin borrar; se revierte con `--restore`). Con negocios que ya usan varios profesionales: `scripts/team-mode.mjs <negocio> off` primero. Detalle y límites en `docs/MULTI_PROFESSIONAL.md` §15.7. La restauración de `backups/pre-deploy-*.sql.gz` es el último recurso y descarta lo cargado después.

**Habilitar un negocio de prueba de forma segura** (cuando lo decidas; nada de esto se hace en el despliegue): 1) elegir un negocio piloto propio; 2) `docker compose --env-file .env.production run --rm migrate node scripts/team-mode.mjs <enlace> on` y luego `... accounts-on`; 3) verificar que Resend envía (`scripts/send-test-email.mjs`); 4) invitar a un correo propio desde Equipo → profesional → «Acceso individual», aceptar la invitación en otra ventana y comprobar el panel del profesional; 5) revocar el acceso y comprobar que la sesión abierta pierde el acceso; 6) `accounts-off` si algo no cierra (no borra cuentas ni membresías). Sin Resend configurado en producción no se puede invitar (el servidor lo rechaza).

### Precios nuevos (ARS 9.900 / 149.000) y prueba de 14 días

Hay que actualizar **tres cosas** al desplegar, o la landing y el cobro quedan distintos:

1. `PRICE_MONTHLY=9900` y `PRICE_ONE_TIME=149000` en `.env.production` (las páginas públicas los fijan al construir la imagen; los defaults ya son los nuevos). `PRICE_LICENSE_RENEWAL` se deja **vacío**: el valor de la renovación no está definido.
2. El precio del plan en la base (`plans.price` del código `mensual`, hoy 14000): se cambia **desde /admin → «Precio del Plan Profesional»**. Solo afecta a las suscripciones que se inicien después; las activas conservan su importe.
3. La prueba de 14 días es código (`trialPolicy`): rige para registros nuevos; las pruebas en curso mantienen su vencimiento.

Sin credenciales ni cobros reales de por medio: todo esto se prueba en sandbox antes de abrir.

### Versión con equipos (etapas 1 y 2): migraciones de base de datos

A diferencia de las versiones anteriores, esta **incluye una migración** (`20261115010000_team_foundation`). Es aditiva y atómica (si una comprobación falla, se revierte entera), `deploy.sh` ya hace una copia previa y la aplica sola. Después de desplegar:

```sh
docker compose --env-file .env.production run --rm migrate node scripts/verify-team-data.mjs   # debe terminar en «OK»
```

El modo equipo queda **apagado** en todos los negocios: nada cambia para los usuarios. Encender un negocio (piloto): `docker compose --env-file .env.production run --rm migrate node scripts/team-mode.mjs <enlace> on`. **Rollback** con el modo apagado: `./deploy/deploy.sh <commit anterior>` sin tocar la base (salvo que ya existan fotos de profesionales o avisos `professional_change`: ver `docs/MULTI_PROFESSIONAL.md` §14); con un negocio que ya usa varios profesionales, leer antes `docs/MULTI_PROFESSIONAL.md` §8. Variable opcional `TEAM_MODE_ENABLED=1` (enciende el modo para toda la instalación; para instalaciones independientes que lo usen).

## 6. Monitoreo, logs y alertas

- **Disponibilidad:** `GET /api/health` responde 200 solo si la app llega a la base. Crear un monitor externo (UptimeRobot, plan gratuito: revisa cada 5 minutos y avisa por email) de tipo *keyword* sobre `https://TU_DOMINIO/api/health` buscando `"status":"ok"`. Sumar un monitor por cada instalación independiente. Es la única forma de enterarse si se cae el servidor entero.
- **Logs:** `docker compose --env-file .env.production logs -f web worker`. Rotan solos (10 MB × 5 por servicio). No contienen contraseñas ni tokens.
- **Avisos fallidos, pagos sin procesar y licencias vendidas:** en `/admin`.
- **Disco:** revisar `df -h` periódicamente; las copias y las imágenes viejas son lo que más ocupa (`docker image prune`).

## 7. Copias de seguridad y restauración

- El servicio `backup` genera `backups/daily/agendia-AAAA-MM-DD.sql.gz` cada día (03:00 de Argentina) y una copia semanal los domingos. Conserva 7 diarias y 4 semanales (configurable). Cada instalación independiente hace lo mismo en `instances/<nombre>/backups`.
- **Copia externa.** Las copias anteriores viven en el mismo servidor: si se pierde, se pierden. El servicio `offsite` las sube una vez por día a un almacenamiento externo con rclone (solo los `.sql.gz`; nunca borra en el destino por reflejo de lo local y elimina las externas de más de 90 días):
  1. Crear un bucket **privado** en un servicio compatible con S3 (Backblaze B2, Cloudflare R2, etc.) y una clave de acceso limitada a ese bucket.
  2. Crear `deploy/rclone.conf` en el servidor (`chmod 600`; no se versiona). Ejemplo para Backblaze B2:
     ```ini
     [agendia-backups]
     type = b2
     account = <keyID>
     key = <applicationKey>
     ```
  3. En `.env.production`: `COMPOSE_PROFILES=offsite` y `OFFSITE_REMOTE=agendia-backups:<nombre-del-bucket>`.
  4. `docker compose --env-file .env.production up -d` y confirmar en `logs offsite` la línea `[offsite] ok`.
- **Simulacro mensual** (no toca producción): `./deploy/restore.sh backups/daily/<archivo>.sql.gz` restaura en una base temporal, muestra cuántas filas recuperó y la elimina.
- **Restauración real:** `./deploy/restore.sh <archivo> --replace`. Pide confirmación, detiene la app, guarda el estado actual y reemplaza la base.

Las copias contienen datos personales de los clientes de cada negocio: el bucket no debe ser público.

## 8. Recuperación ante fallos

| Situación | Qué hacer |
|---|---|
| Un contenedor se cae | Se reinicia solo. Ver `logs` para la causa. |
| Reinicio del servidor | Docker levanta todo solo. Los recordatorios pendientes se envían al volver (están en la base, no en memoria). |
| Despliegue defectuoso | `./deploy/deploy.sh <commit anterior>`. |
| Datos dañados o borrados por error | `./deploy/restore.sh <copia> --replace`. |
| Una usuaria perdió el acceso y no le llega el email | Verificar su identidad por otro medio y generar un enlace de un uso: `docker compose --env-file .env.production run --rm migrate node scripts/create-reset-link.mjs su@email.com`. |
| Se pierde el servidor | Servidor nuevo → sección 3 → restaurar la última copia externa → recrear las instalaciones (sección 9) y restaurar las suyas → apuntar el DNS. |

## 9. Licencias: instalaciones independientes

Cada licencia vendida (`/admin` → "Licencia independiente" → orden **Pagada**) se entrega como una instalación propia en este mismo servidor: base de datos, secretos, contenedores y copias separados, detrás del proxy HTTPS compartido. Usa las imágenes ya construidas del SaaS; no hay código fuente fuera del servidor de la plataforma.

```sh
# 1. Apuntar el DNS del dominio del cliente a este servidor y esperar a que propague.
# 2. Crear la instalación:
./deploy/instance.sh create estudio-luna turnos.estudioluna.com.ar
# 3. La dueña crea su cuenta en https://turnos.estudioluna.com.ar/registro
#    (solo se admite la primera cuenta) y confirma su email.
```

| Comando | Qué hace |
|---|---|
| `./deploy/instance.sh list` | Instalaciones, dominio y estado de sus contenedores. |
| `./deploy/instance.sh update <nombre>` / `update-all` | Copia previa + pasa a la imagen actual (aplica migraciones). Correr después de cada `deploy.sh`. |
| `./deploy/instance.sh backup <nombre>` | Copia inmediata en `instances/<nombre>/backups`. |

- **Configuración de cada una:** `instances/<nombre>/.env` (secretos propios, generados al crearla). Para que los avisos salgan con el nombre del negocio, editar `EMAIL_FROM` ahí y correr `update`.
- **Otros comandos de Compose** (logs, detener): `docker compose -p agendia-<nombre> logs --tail 100 app`.
- **Restaurar una copia:** `gunzip -c <copia> | docker compose -p agendia-<nombre> exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'` sobre una base vacía (detener antes `app` y `worker`).
- **Dar de baja una instalación** destruye datos de un cliente y no tiene comando: hacer una copia (`backup`), entregársela si corresponde, y recién entonces `docker compose -p agendia-<nombre> down -v`, borrar `deploy/sites/<nombre>.caddy`, recargar el proxy (`docker compose --env-file .env.production exec caddy caddy reload --config /etc/caddy/Caddyfile`) y archivar `instances/<nombre>`.
- **Capacidad:** un servidor de 4 GB aloja el SaaS y unas 6 instalaciones. `docker stats` muestra el consumo real.
- **Servidor aparte:** si un cliente necesita su propio servidor, `deploy/docker-compose.standalone.yml` funciona solo con el perfil `proxy` y las imágenes exportadas con `docker save` (el repositorio no se clona ahí).

## 10. Desarrollo local

Ver `README.md`. El worker se prueba con `CRON_SECRET=... npm run worker` contra `npm run dev`.


## 11. Etapa 5: despliegue controlado por fases (documentado, NO ejecutado)

> **Nada de esto se ejecutó.** No hay despliegue, no se accedió a producción, no se tocó Hetzner, Cloudflare ni DNS, y los planes con equipo **no están publicados**. Este apartado **reemplaza** lo que el «Despliegue acumulado» de §5 dice sobre precios fijados al construir y sobre cambiar el precio en `/admin`: ahora el precio de lista se lee **en ejecución** y la migración corrige el precio del Profesional (14.000 → 9.900, solo si todavía tiene ese valor); `/admin` ya no tiene un campo libre de precio.
> Etiquetas: **Implementado** · **Probado localmente** · **Pendiente de activación** · **Pendiente de prueba real**. Descripción funcional: `docs/COMMERCIAL.md`.

### 11.1 Migraciones nuevas (todas aditivas, probadas sobre el esquema anterior)
1. `20261119000000_commercial_plans`: columnas comerciales de organización (`intendedPlan`, `workMode`, período de adaptación), `professionals.keepBookable`, columnas de cambio de plan en `subscriptions`, `license_orders.tier`, valor de enum `NotificationType.account_notice`; **crea el Plan Equipo (19.900)** y pasa el Plan Profesional de 14.000 a 9.900 **solo si conserva ese valor**. Idempotente.
2. `20261119000100_subscription_contract`: `contractedAmount`, `contractedCurrency` y `retiredProviderSubscriptionId` en `subscriptions`.
3. `20261119000200_user_sessions`: tabla `user_sessions`.
Ninguna borra ni reescribe datos de clientes, turnos, profesionales ni suscripciones. Verificación local: `test/commercial-migration.test.ts`.

### 11.2 Variables de entorno nuevas (`.env.example`, `docker-compose.yml`)
- `PUBLISH_TEAM_PLANS` — **vacía** (apagada). Publica ambos planes y activa equipo y cuentas para todos según plan. Se lee en ejecución.
- `TEAM_FEATURES_PAUSED` — vacía. Interruptor de emergencia.
- `CAPACITY_GRACE_DAYS` — `7`. Días de adaptación al bajar de plan.
- `PRICE_TEAM_MONTHLY` (19900), `PRICE_LICENSE_TEAM` (249000), junto con `PRICE_MONTHLY` (9900) y `PRICE_ONE_TIME` (149000): precio de lista. **Deben coincidir** con la tabla `plans`; si no, el plan no se vende (y `/admin` lo muestra).
- `LICENSE_TIER` — solo instalaciones independientes (`profesional`|`equipo`).
- `TEAM_MODE_ENABLED`, `TEAM_ACCOUNTS_ENABLED` — siguen **vacías** en producción.
- **Solo pruebas, nunca en producción:** `ALLOW_REGISTRATION_WITHOUT_EMAIL`, `ALLOW_INVITATIONS_WITHOUT_EMAIL` (esta última se ignora fuera de `localhost` y en licencias).

### 11.3 Fase A — actualización técnica (sin publicar nada)
Objetivo: código nuevo en producción con **todo lo de equipo apagado**.
1. Antes: CI verde en `main`, `git log HEAD..origin/main` revisado, copia de seguridad (`deploy/backup.sh`) **y** simulacro de restauración (`deploy/restore.sh <copia>` sin `--replace`).
2. `.env.production`: `PUBLISH_TEAM_PLANS=`, `TEAM_FEATURES_PAUSED=`, `TEAM_MODE_ENABLED=`, `TEAM_ACCOUNTS_ENABLED=` vacías; `PRICE_*` con los valores acordados.
3. `./deploy/deploy.sh` (copia previa → build → migraciones antes de `web` → comprobación de salud). `./deploy/instance.sh update-all` para las licencias.
4. Verificar: contenedores, `/api/health`, `prisma migrate status` sin pendientes, `node scripts/verify-team-data.mjs` en «OK», precios en la landing ($9.900 / $149.000) y **ausencia de «Plan Equipo»**, una reserva de un profesional como siempre, WhatsApp manual, una cuenta de prueba con prueba de 14 días, `/admin` sin discrepancias de precio (`plans.mensual = 9900`, `equipo = 19900`), `/dashboard/equipo` dice «no habilitado».
5. Con Mercado Pago **sin credenciales** el pago online no se ofrece (se mantiene el contacto).

### 11.4 Fase B — piloto controlado
1. Elegir **un negocio propio de prueba**; habilitarlo desde `/admin/negocios/<id>` (modo equipo y cuentas) o con `scripts/team-mode.mjs <enlace> on` y `accounts-on`.
2. Probar: varios profesionales, reservas simultáneas, **correos reales**, invitación real aceptada desde otra cuenta, permisos, revocar acceso, cambio de negocio, **dispositivos físicos** (celular), y revisar consumo de correo y métricas en `/admin`.
3. Verificar los avisos: fin de prueba (forzando fechas en el piloto), exceso de cupo, sesiones desde dos dispositivos.
4. **Criterio de salida:** sin errores en logs, sin turnos superpuestos (`verify-team-data.mjs`), correos correctos y aceptación del piloto.

### 11.5 Fase C — integración comercial (Mercado Pago en sandbox)
Solo con credenciales de **prueba**. Seguir **paso a paso** `docs/MERCADOPAGO.md` §6 (contratación de ambos planes, cambios en las dos direcciones, rechazos, cancelación, reembolsos, licencias con Checkout Pro, eventos duplicados y perdidos). Verificar precios efectivos y notificaciones. **Criterio de salida:** los puntos 1–11 del §6 sin cobros duplicados ni lugares sin cobro. **Mientras no se cumpla, no se cobra.**
Además: textos legales aprobados y publicados (`docs/LEGAL_REVIEW.md`) y decisión sobre el reintegro de «Hoy» y sobre la renovación de licencias.

### 11.6 Fase D — lanzamiento público
1. Decisiones comerciales y legales cerradas; credenciales **de producción** de Mercado Pago cargadas **por vos**, y una compra real de prueba de importe mínimo supervisada.
2. Poner `PUBLISH_TEAM_PLANS=1` y reiniciar `web` y `worker` (**no hace falta reconstruir la imagen**). Verificar landing con ambos planes, registro con `?plan=equipo`, onboarding «¿Cómo trabajás?», «Mi plan» y que un negocio pueda pasar a Equipo.
3. Monitoreo: salud, correos fallidos, eventos de pago sin procesar, espacio de disco y copias.
4. **Interruptor de emergencia:** `TEAM_FEATURES_PAUSED=1` y reiniciar detiene la activación automática y la venta del Plan Equipo sin borrar nada.
5. El material de campañas se publica **después**, con la aprobación correspondiente.

### 11.7 Rollback de la etapa 5
- **Preferible: avanzar (roll-forward)** con una corrección, porque las migraciones son aditivas y la versión nueva es compatible hacia atrás con los datos.
- **Primer paso, siempre:** `PUBLISH_TEAM_PLANS=` vacío y reiniciar (la oferta vuelve a verse como antes) y/o `TEAM_FEATURES_PAUSED=1`.
- **Si hay que volver a una versión anterior de la aplicación:** copia de seguridad → `node scripts/prepare-rollback.mjs` (inspeccionar) → `--apply` (aparta fotos de profesionales, avisos `professional_change` y `account_notice`, y membresías que no son del propietario; **cierra las sesiones de quien tenga alguna revocada**) → desplegar la imagen anterior. `--restore` al volver a la nueva. Nada se borra.
- **No sube permisos:** el script quita los accesos de administradores y profesionales antes de que una versión sin roles los trate como propietarios. Una versión anterior que ya conocía el Plan Equipo da sus 5 lugares a quien lo tenga; las anteriores no limitan cupos.
- **Suscripciones en curso:** un cambio de plan pendiente queda como está (columnas ignoradas por la versión anterior); no cancelar nada en Mercado Pago a mano sin revisar `/admin/negocios/<id>`.

### 11.8 Verificación local previa (hecha)
`npm run lint`, `npm run typecheck`, `npm run build`, `npm test` (base aislada por ejecución), `npx playwright test` (incluye los proyectos `published-*`, con la oferta publicada en otro puerto), `node scripts/check-standalone-install.mjs` y `npm run loadtest:local`. Resultados reales en el informe de la etapa y en `docs/PRODUCTION_READINESS.md` §14.
