#!/bin/sh
# Copia de seguridad diaria de PostgreSQL con rotación.
#
# Corre dentro del servicio `backup` de docker-compose.yml. Cada día genera
# /backups/daily/agendia-AAAA-MM-DD.sql.gz y, los domingos, además una copia
# en /backups/weekly. Conserva las últimas N diarias y M semanales.
#
# Un backup que nunca se restauró no es un backup: ver deploy/restore.sh y
# el simulacro mensual descripto en docs/DEPLOYMENT.md.
set -eu

KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
mkdir -p /backups/daily /backups/weekly

run_backup() {
  stamp="$(date -u +%Y-%m-%d)"
  target="/backups/daily/agendia-${stamp}.sql.gz"
  tmp="${target}.partial"

  if pg_dump --no-owner --no-privileges | gzip -9 > "$tmp" && [ -s "$tmp" ] && gzip -t "$tmp"; then
    mv "$tmp" "$target"
    echo "[backup] ok: $target ($(du -h "$target" | cut -f1))"
    if [ "$(date -u +%u)" = "7" ]; then
      cp "$target" "/backups/weekly/agendia-${stamp}.sql.gz"
    fi
    # Rotación: se conservan las más nuevas.
    ls -1t /backups/daily/*.sql.gz 2>/dev/null | tail -n +"$((KEEP_DAILY + 1))" | xargs -r rm -f
    ls -1t /backups/weekly/*.sql.gz 2>/dev/null | tail -n +"$((KEEP_WEEKLY + 1))" | xargs -r rm -f
  else
    rm -f "$tmp"
    echo "[backup] ERROR: no se pudo generar la copia de ${stamp}" >&2
  fi
}

# Una copia al iniciar (si todavía no existe la de hoy) y luego una por día.
[ -f "/backups/daily/agendia-$(date -u +%Y-%m-%d).sql.gz" ] || run_backup
while true; do
  # Duerme hasta las 06:00 UTC (03:00 en Argentina) del día siguiente.
  now="$(date -u +%s)"
  next="$(( (now / 86400 + 1) * 86400 + 6 * 3600 ))"
  sleep "$(( next - now ))"
  run_backup
done
