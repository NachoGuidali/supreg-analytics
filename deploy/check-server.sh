#!/usr/bin/env bash
# Diagnóstico antes de instalar en un servidor que ya tiene otros servicios.
#   bash deploy/check-server.sh
# Muestra qué usa los puertos que necesita SupReg Analytics y qué proxy hay delante.
WEB_PORT="${WEB_PORT:-$(grep -s '^WEB_PORT=' .env | cut -d= -f2)}"
WEB_PORT="${WEB_PORT:-8090}"

echo "== Puertos =="
for port in 80 443 "$WEB_PORT"; do
  line=$(sudo ss -Htlnp "sport = :$port" 2>/dev/null | head -1)
  if [ -n "$line" ]; then
    echo "  $port: OCUPADO  -> $(echo "$line" | grep -o 'users:.*')"
  else
    echo "  $port: libre"
  fi
done

echo; echo "== Proxy en el host =="
for svc in nginx apache2 httpd caddy traefik haproxy; do
  systemctl is-active --quiet "$svc" 2>/dev/null && echo "  $svc (servicio del sistema) activo"
done
command -v docker >/dev/null && docker ps --format '  {{.Names}}  {{.Image}}  {{.Ports}}' | grep -Ei 'nginx|traefik|caddy|proxy|haproxy|:80->|:443->' || true

echo; echo "== Redes Docker (si el proxy corre en Docker, va en PROXY_NETWORK) =="
command -v docker >/dev/null && docker network ls --format '{{.Name}}' | grep -vxE 'bridge|host|none' | sed 's/^/  /' || true

echo; echo "== Sistema =="
grep -s '^PRETTY_NAME=' /etc/os-release | cut -d= -f2 | tr -d '"' | sed 's/^/  /'
if command -v getenforce >/dev/null; then
  echo "  SELinux: $(getenforce)"
  [ "$(getenforce)" = "Enforcing" ] && echo "  nginx -> puertos locales: $(getsebool httpd_can_network_connect 2>/dev/null | awk '{print $3}')"
fi
command -v certbot >/dev/null && echo "  certbot: $(certbot --version 2>&1)" || echo "  certbot: no instalado"

echo; echo "== Recursos =="
free -h | awk 'NR<=2'
df -h / | awk 'NR==2 {print "  Disco /: " $4 " libres de " $2}'
command -v docker >/dev/null && echo "  $(docker --version)" && echo "  $(docker compose version)" || echo "  Docker NO instalado"

echo; echo "== Qué hacer =="
if sudo ss -Htln "sport = :443" 2>/dev/null | grep -q .; then
  echo "  443 ocupado: usá el proxy que ya tenés (DEPLOY.md, 'Detrás del proxy del servidor')."
else
  echo "  80/443 libres: podés usar el Caddy del proyecto (COMPOSE_PROFILES=caddy en .env)."
fi
if sudo ss -Htln "sport = :$WEB_PORT" 2>/dev/null | grep -q .; then
  echo "  $WEB_PORT ocupado: elegí otro WEB_PORT en .env."
fi
