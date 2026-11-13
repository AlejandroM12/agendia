#!/bin/sh
# Copia externa de las copias de seguridad, una vez por día.
#
# Corre dentro del servicio `offsite` de docker-compose.yml (imagen de
# rclone). Sube a OFFSITE_REMOTE todos los .sql.gz del SaaS (/data/saas) y
# de las instalaciones independientes (/data/instances/<nombre>/backups).
#
# Nunca borra en el destino por reflejo de lo local: si el servidor pierde
# sus copias, las externas quedan. Lo único que elimina son copias externas
# con más de OFFSITE_KEEP_DAYS días (90 por defecto).
set -eu

REMOTE="${OFFSITE_REMOTE:-}"
KEEP_DAYS="${OFFSITE_KEEP_DAYS:-90}"

if [ -z "$REMOTE" ]; then
  echo "[offsite] ERROR: falta OFFSITE_REMOTE en .env.production" >&2
  sleep 3600
  exit 1
fi

run_copy() {
  if rclone copy /data "$REMOTE" --include "*.sql.gz" --transfers 2 --retries 3; then
    rclone delete "$REMOTE" --include "*.sql.gz" --min-age "${KEEP_DAYS}d" || true
    echo "[offsite] ok: $(rclone size "$REMOTE" --include "*.sql.gz" 2>/dev/null | tr '\n' ' ')"
  else
    echo "[offsite] ERROR: no se pudo subir la copia a $REMOTE" >&2
  fi
}

# Una copia al iniciar y luego una por día, una hora después del backup local.
run_copy
while true; do
  now="$(date -u +%s)"
  next="$(( (now / 86400 + 1) * 86400 + 7 * 3600 ))"
  sleep "$(( next - now ))"
  run_copy
done
