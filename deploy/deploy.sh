#!/bin/sh
# Despliega la versión actual de la rama main en este servidor.
#
#   ./deploy/deploy.sh            # actualiza a origin/main
#   ./deploy/deploy.sh <commit>   # vuelve a una versión anterior (rollback)
#
# Pasos: copia de seguridad → construir imágenes → migraciones → reemplazar
# contenedores → verificar /api/health. Si la verificación falla, avisa y
# deja el comando de rollback a la versión que estaba corriendo.
set -eu

COMPOSE="docker compose --env-file .env.production"
PREVIOUS="$(git rev-parse HEAD)"
TARGET="${1:-origin/main}"

[ -f .env.production ] || { echo "Falta .env.production (ver deploy/.env.production.example)" >&2; exit 1; }

git fetch --quiet origin
git checkout --quiet --detach "$TARGET"
echo "Desplegando $(git rev-parse --short HEAD) (antes: $(git rev-parse --short "$PREVIOUS"))"

# Copia de seguridad previa: una migración no se puede deshacer sola.
if $COMPOSE ps --status running postgres 2>/dev/null | grep -q postgres; then
  mkdir -p backups
  $COMPOSE exec -T postgres sh -c 'pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
    | gzip > "backups/pre-deploy-$(date -u +%Y%m%d-%H%M%S).sql.gz"
fi

$COMPOSE build
$COMPOSE up -d --remove-orphans

echo "Esperando a que la aplicación responda…"
i=0
until $COMPOSE exec -T web wget -qO- http://127.0.0.1:3000/api/health > /dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "ERROR: la aplicación no respondió. Revisá: $COMPOSE logs --tail 100 web migrate" >&2
    echo "Para volver a la versión anterior: ./deploy/deploy.sh $PREVIOUS" >&2
    exit 1
  fi
  sleep 4
done

docker image prune -f > /dev/null
echo "Listo: $(git rev-parse --short HEAD) en producción."

# Las instalaciones independientes siguen con la imagen anterior hasta que
# se actualizan (cada una hace antes su propia copia de seguridad).
if ls instances/*/.env > /dev/null 2>&1; then
  echo "Hay instalaciones independientes: actualizalas con ./deploy/instance.sh update-all"
fi
