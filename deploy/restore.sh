#!/bin/sh
# Restaura una copia de seguridad en la base de datos de Agendia.
#
#   ./deploy/restore.sh backups/daily/agendia-2026-11-12.sql.gz            # simulacro
#   ./deploy/restore.sh backups/daily/agendia-2026-11-12.sql.gz --replace  # reemplaza producción
#
# Sin --replace restaura en una base temporal (agendia_restore_test), verifica
# que tenga datos y la elimina: es el simulacro mensual, y no toca producción.
# Con --replace REEMPLAZA la base real: detiene web y worker, pide
# confirmación explícita y guarda antes una copia del estado actual.
set -eu

FILE="${1:?Uso: restore.sh <archivo.sql.gz> [--replace]}"
MODE="${2:-}"
COMPOSE="docker compose --env-file .env.production"

[ -f "$FILE" ] || { echo "No existe $FILE" >&2; exit 1; }
gzip -t "$FILE" || { echo "El archivo está dañado" >&2; exit 1; }

psql_in() { $COMPOSE exec -T postgres sh -c "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"$1\""; }
admin() { $COMPOSE exec -T postgres sh -c "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d postgres -c \"$1\""; }

if [ "$MODE" != "--replace" ]; then
  echo "Simulacro: restaurando en la base temporal agendia_restore_test…"
  admin "DROP DATABASE IF EXISTS agendia_restore_test"
  admin "CREATE DATABASE agendia_restore_test"
  gunzip -c "$FILE" | psql_in agendia_restore_test > /dev/null
  echo "Filas restauradas:"
  echo "SELECT 'organizations' AS tabla, count(*) FROM organizations UNION ALL SELECT 'users', count(*) FROM users UNION ALL SELECT 'appointments', count(*) FROM appointments;" | psql_in agendia_restore_test
  admin "DROP DATABASE agendia_restore_test"
  echo "Simulacro OK: la copia se puede restaurar. Producción no fue modificada."
  exit 0
fi

printf "Esto REEMPLAZA la base de datos de producción con %s.\nEscribí RESTAURAR para continuar: " "$FILE"
read -r answer
[ "$answer" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }

DB="$($COMPOSE exec -T postgres sh -c 'printf %s "$POSTGRES_DB"')"
SAFETY="backups/pre-restore-$(date -u +%Y%m%d-%H%M%S).sql.gz"
mkdir -p backups

$COMPOSE stop web worker
echo "Guardando el estado actual en $SAFETY…"
$COMPOSE exec -T postgres sh -c 'pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$SAFETY"

admin "DROP DATABASE \\\"$DB\\\" WITH (FORCE)"
admin "CREATE DATABASE \\\"$DB\\\""
gunzip -c "$FILE" | psql_in "$DB" > /dev/null

$COMPOSE up -d
echo "Restauración completa. El estado anterior quedó en $SAFETY."
