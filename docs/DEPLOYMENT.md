# Despliegue y operación — Agendia

Guía para poner Agendia en producción en un servidor propio (VPS) con Docker Compose, y para operarla día a día. Sirve igual para el SaaS (`DEPLOYMENT_MODE=saas`) y para una instalación independiente (`DEPLOYMENT_MODE=standalone`).

> Un servidor encendido las 24 horas no es una garantía de disponibilidad: es un único punto de falla. Lo que sí garantiza esta configuración es que la app se reinicia sola, que los datos se copian todos los días y que una caída se detecta (si se configura el monitoreo externo de la sección 6).

## 1. Qué corre en el servidor

| Servicio | Función |
|---|---|
| `caddy` | HTTPS automático (Let's Encrypt) y proxy inverso. Único servicio expuesto a Internet (80/443). |
| `web` | La aplicación (Next.js). |
| `worker` | Cada minuto dispara el trabajo periódico: enviar recordatorios, vencer pruebas, reconciliar pagos. |
| `migrate` | Aplica las migraciones pendientes y termina. Corre antes que `web` en cada despliegue. |
| `postgres` | Base de datos, con volumen persistente. No se expone fuera de la red interna. |
| `backup` | Copia diaria de la base con rotación. |

Todos tienen `restart: unless-stopped`: vuelven solos tras una falla o un reinicio del servidor.

## 2. Requisitos

- VPS con Linux, 2 vCPU y 2–4 GB de RAM alcanzan para empezar.
- Docker Engine con el plugin Compose.
- Un dominio con un registro A/AAAA apuntando al servidor. Puertos 80 y 443 abiertos; el resto, cerrado (firewall).

## 3. Primera instalación

```sh
git clone https://github.com/AlejandroM12/agendia.git && cd agendia
cp deploy/.env.production.example .env.production
chmod 600 .env.production
# Completar .env.production (dominio, contraseñas y secretos)
docker compose --env-file .env.production up -d --build
```

Verificación: `docker compose --env-file .env.production ps` debe mostrar `web` y `postgres` como *healthy*, y `https://TU_DOMINIO/api/health` debe responder `{"status":"ok"}`.

Para acceder al panel de plataforma (`/admin`), registrar una cuenta normal y agregar su email a `PLATFORM_ADMIN_EMAILS`.

## 4. Variables y secretos

Todas están documentadas en `deploy/.env.production.example`. Reglas:

- `.env.production` vive solo en el servidor, nunca en el repositorio.
- `AUTH_SECRET`, `CRON_SECRET` y `POSTGRES_PASSWORD` se generan con `openssl rand`; no se reutilizan entre entornos.
- **Rotar `AUTH_SECRET`** cierra todas las sesiones (los usuarios vuelven a ingresar). Editar el valor y `docker compose --env-file .env.production up -d`.
- **Rotar `CRON_SECRET`**: igual; `web` y `worker` lo toman del mismo archivo.
- Sin `RESEND_API_KEY`/`EMAIL_FROM` no se envían emails (quedan como "No enviado"). Sin las credenciales de Mercado Pago no se ofrece el pago online. La app funciona igual en ambos casos.

## 5. Actualizar y volver atrás

```sh
./deploy/deploy.sh            # despliega origin/main
./deploy/deploy.sh <commit>   # vuelve a una versión anterior
```

El script hace una copia de la base, construye, migra, reemplaza los contenedores y verifica `/api/health`. Antes de desplegar, el CI de GitHub (`.github/workflows/ci.yml`) debe estar en verde en `main`.

**Migraciones:** son solo hacia adelante. Un cambio que rompe compatibilidad (borrar una columna o tabla) se despliega en una versión posterior a la que deja de usarla, nunca en la misma. Si una migración sale mal, se restaura la copia `backups/pre-deploy-*.sql.gz` que el script generó (sección 7) y se vuelve al commit anterior.

## 6. Monitoreo, logs y alertas

- **Salud:** `GET /api/health` responde 200 solo si la app llega a la base. Configurar un monitor externo de uptime (cualquier servicio gratuito alcanza) contra `https://TU_DOMINIO/api/health` con aviso por email: es la única forma de enterarse si se cae el servidor entero.
- **Logs:** `docker compose --env-file .env.production logs -f web worker`. Rotan solos (10 MB × 5 por servicio). No contienen contraseñas ni tokens.
- **Avisos fallidos y pagos sin procesar:** se ven en `/admin` ("Estado de las integraciones").
- **Disco:** revisar `df -h` periódicamente; las copias y las imágenes viejas son lo que más ocupa (`docker image prune`).

## 7. Copias de seguridad y restauración

- El servicio `backup` genera `backups/daily/agendia-AAAA-MM-DD.sql.gz` cada día (03:00 de Argentina) y una copia semanal los domingos. Conserva 7 diarias y 4 semanales (configurable).
- **Las copias están en el mismo servidor.** Copiarlas además fuera de él (otro servidor u object storage), por ejemplo con un `rsync`/`rclone` diario de la carpeta `backups/`. Sin eso, perder el servidor es perder las copias.
- **Simulacro mensual** (no toca producción): `./deploy/restore.sh backups/daily/<archivo>.sql.gz` restaura en una base temporal, muestra cuántas filas recuperó y la elimina.
- **Restauración real:** `./deploy/restore.sh <archivo> --replace`. Pide confirmación, detiene la app, guarda el estado actual y reemplaza la base.

## 8. Recuperación ante fallos

| Situación | Qué hacer |
|---|---|
| Un contenedor se cae | Se reinicia solo. Ver `logs` para la causa. |
| Reinicio del servidor | Docker levanta todo solo. Los recordatorios pendientes se envían al volver (están en la base, no en memoria). |
| Despliegue defectuoso | `./deploy/deploy.sh <commit anterior>`. |
| Datos dañados o borrados por error | `./deploy/restore.sh <copia> --replace`. |
| Se pierde el servidor | Servidor nuevo → sección 3 → restaurar la última copia externa → apuntar el DNS. |

## 9. Desarrollo local

Ver `README.md`. El worker se prueba con `CRON_SECRET=... npm run worker` contra `npm run dev`.
