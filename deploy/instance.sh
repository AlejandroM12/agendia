#!/bin/sh
# Instalaciones independientes (licencias) alojadas en este servidor.
#
#   ./deploy/instance.sh create <nombre> <dominio>   # crea y levanta una instalación
#   ./deploy/instance.sh update <nombre>             # la pasa a la imagen actual (migraciones incluidas)
#   ./deploy/instance.sh update-all                  # ídem, todas
#   ./deploy/instance.sh list
#   ./deploy/instance.sh backup <nombre>             # copia de seguridad inmediata
#
# Se ejecuta desde la raíz del proyecto, en el servidor donde ya corre el
# SaaS (docker-compose.yml): reutiliza sus imágenes y su proxy HTTPS. Cada
# instalación tiene base de datos, secretos, contenedores y copias propios,
# en instances/<nombre>/. Antes de crearla, el DNS del dominio tiene que
# apuntar a este servidor (si no, Caddy no puede emitir el certificado).
#
# No hay comando para borrar: eliminar una instalación destruye datos de un
# cliente y se hace a mano, con una copia previa (ver docs/DEPLOYMENT.md).
set -eu

MAIN="docker compose --env-file .env.production"

fail() { echo "ERROR: $*" >&2; exit 1; }

[ -f docker-compose.yml ] && [ -f deploy/docker-compose.standalone.yml ] || fail "ejecutar desde la raíz del proyecto"

compose() {
  name="$1"; shift
  docker compose -p "agendia-$name" \
    -f deploy/docker-compose.standalone.yml -f deploy/docker-compose.shared-proxy.yml \
    --env-file "instances/$name/.env" "$@"
}

valid_name() {
  echo "$1" | grep -Eq '^[a-z0-9][a-z0-9-]{1,30}$' || fail "nombre inválido: usar minúsculas, números y guiones (ej.: estudio-luna)"
}

existing() {
  valid_name "$1"
  [ -f "instances/$1/.env" ] || fail "no existe la instalación $1"
}

secret() { openssl rand -hex "$1"; }

# Lee una variable de .env.production sin ejecutar el archivo.
main_env() { grep -E "^$1=" .env.production | head -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

wait_healthy() {
  i=0
  until compose "$1" exec -T app wget -qO- http://127.0.0.1:3000/api/health > /dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -lt 40 ] || fail "la instalación $1 no respondió. Revisar: docker compose -p agendia-$1 logs --tail 100"
    sleep 3
  done
}

reload_proxy() {
  $MAIN exec -T caddy caddy reload --config /etc/caddy/Caddyfile > /dev/null 2>&1 \
    || fail "no se pudo recargar el proxy. Revisar: $MAIN logs --tail 50 caddy"
}

case "${1:-}" in
  create)
    name="${2:?Uso: instance.sh create <nombre> <dominio>}"
    domain="${3:?Uso: instance.sh create <nombre> <dominio>}"
    valid_name "$name"
    echo "$domain" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' || fail "dominio inválido (sin https:// ni barras)"
    [ -f .env.production ] || fail "falta .env.production"
    [ ! -e "instances/$name" ] || fail "ya existe instances/$name"
    ! grep -rqsF "$domain {" deploy/sites/ || fail "el dominio $domain ya está en uso por otra instalación"
    [ "$domain" != "$(main_env DOMAIN)" ] || fail "ese es el dominio del SaaS"
    docker image inspect agendia-web:latest > /dev/null 2>&1 || fail "falta la imagen agendia-web:latest (correr ./deploy/deploy.sh primero)"

    mkdir -p "instances/$name/backups" deploy/sites
    umask 077
    cat > "instances/$name/.env" <<EOF
# Instalación independiente "$name" — creada el $(date -u +%Y-%m-%d). No subir a ningún repositorio.
INSTANCE=$name
DOMAIN=$domain
POSTGRES_USER=agendia
POSTGRES_DB=agendia
POSTGRES_PASSWORD=$(secret 24)
AUTH_SECRET=$(secret 32)
CRON_SECRET=$(secret 32)
CONTACT_EMAIL=$(main_env CONTACT_EMAIL)
# Email: usa la cuenta de Resend de la plataforma. Cambiar EMAIL_FROM si el
# cliente quiere que los avisos salgan con el nombre de su negocio.
RESEND_API_KEY=$(main_env RESEND_API_KEY)
EMAIL_FROM="$(main_env EMAIL_FROM)"
BACKUP_DIR=$(pwd)/instances/$name/backups
EOF
    umask 022

    compose "$name" up -d
    wait_healthy "$name"

    printf '%s {\n\timport agendia %s-app:3000\n}\n' "$domain" "$name" > "deploy/sites/$name.caddy"
    reload_proxy

    echo "Listo: https://$domain"
    echo "El dueño de la licencia crea su cuenta en https://$domain/registro (solo se admite la primera)."
    ;;

  update)
    existing "${2:?Uso: instance.sh update <nombre>}"
    compose "$2" exec -T postgres sh -c 'pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
      | gzip > "instances/$2/backups/pre-update-$(date -u +%Y%m%d-%H%M%S).sql.gz"
    compose "$2" up -d
    wait_healthy "$2"
    echo "Instalación $2 actualizada."
    ;;

  update-all)
    for env in instances/*/.env; do
      [ -f "$env" ] || continue
      "$0" update "$(basename "$(dirname "$env")")"
    done
    ;;

  backup)
    existing "${2:?Uso: instance.sh backup <nombre>}"
    target="instances/$2/backups/manual-$(date -u +%Y%m%d-%H%M%S).sql.gz"
    compose "$2" exec -T postgres sh -c 'pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$target"
    gzip -t "$target" && echo "Copia guardada en $target"
    ;;

  list)
    for env in instances/*/.env; do
      [ -f "$env" ] || continue
      name="$(basename "$(dirname "$env")")"
      domain="$(grep -E '^DOMAIN=' "$env" | cut -d= -f2-)"
      state="$(compose "$name" ps --format '{{.Service}}={{.State}}' 2> /dev/null | tr '\n' ' ')"
      echo "$name  https://$domain  $state"
    done
    ;;

  *)
    echo "Uso: instance.sh create <nombre> <dominio> | update <nombre> | update-all | backup <nombre> | list" >&2
    exit 1
    ;;
esac
