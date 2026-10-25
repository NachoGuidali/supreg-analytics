#!/usr/bin/env bash
# Sube el proyecto al servidor y (re)levanta producción. Se corre desde tu máquina.
#
#   ./deploy/sync.sh usuario@IP_DEL_SERVIDOR            # primera vez y cada actualización
#
# Copia el código (sin node_modules, builds ni datos locales) a /opt/supreg-analytics y, la
# primera vez, también .env.production como .env. Después reconstruye y reinicia los contenedores.
set -euo pipefail

TARGET="${1:?Uso: ./deploy/sync.sh usuario@servidor}"
REMOTE_DIR="${REMOTE_DIR:-/opt/supreg-analytics}"
cd "$(dirname "$0")/.."

if ! ssh "$TARGET" "command -v docker >/dev/null && command -v rsync >/dev/null"; then
  echo "El servidor no tiene Docker o rsync. Corré primero: ssh $TARGET 'bash -s' < deploy/server-setup.sh" >&2
  exit 1
fi
ssh "$TARGET" "sudo mkdir -p $REMOTE_DIR && sudo chown \$(id -u):\$(id -g) $REMOTE_DIR"

rsync -az --delete \
  --exclude '.git/' --exclude 'node_modules/' --exclude 'frontend/dist/' --exclude 'backend/staticfiles/' \
  --exclude '__pycache__/' --exclude '.env' --exclude '.env.production' --exclude 'backups/' \
  --exclude 'deploy/geoip/*.mmdb' \
  ./ "$TARGET:$REMOTE_DIR/"

# La configuración de producción se sube sólo si el servidor todavía no tiene una:
# así nunca se pisan secretos o cambios hechos allá.
if ! ssh "$TARGET" "test -f $REMOTE_DIR/.env"; then
  scp .env.production "$TARGET:$REMOTE_DIR/.env"
  ssh "$TARGET" "chmod 600 $REMOTE_DIR/.env"
  echo "Subí .env.production como .env"
fi

ssh "$TARGET" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml up -d --build --remove-orphans && docker image prune -f >/dev/null"
echo "Listo: https://$(grep '^DOMAIN=' .env.production | cut -d= -f2)"
