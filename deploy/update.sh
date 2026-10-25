#!/usr/bin/env bash
# Actualiza a la última versión de GitHub. Se corre en el servidor, en la carpeta del proyecto:
#   bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
files=(-f docker-compose.prod.yml)
grep -qs '^PROXY_NETWORK=.\+' .env && files+=(-f docker-compose.proxy-net.yml)
docker compose "${files[@]}" up -d --build --remove-orphans
docker image prune -f >/dev/null
docker compose "${files[@]}" ps
