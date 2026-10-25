#!/usr/bin/env bash
# Prepara un servidor Ubuntu/Debian recién creado: Docker, rsync, firewall y swap. Se corre UNA
# vez, desde tu máquina, con un usuario del servidor que tenga sudo:
#
#   ssh usuario@servidor 'bash -s' < deploy/server-setup.sh
set -euo pipefail

if ! command -v rsync >/dev/null; then
  sudo apt-get update -qq && sudo apt-get install -y -qq rsync
fi

if ! command -v docker >/dev/null; then
  echo "Instalando Docker…"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" # toma efecto en la próxima conexión SSH
fi

if command -v ufw >/dev/null; then
  echo "Firewall: SSH, HTTP y HTTPS (también UDP 443 para HTTP/3)."
  sudo ufw allow OpenSSH
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw allow 443/udp
  sudo ufw --force enable
fi

# Con 1-2 GB de RAM el build del frontend puede quedarse sin memoria: 2 GB de swap lo evitan.
if [ "$(swapon --noheadings | wc -l)" -eq 0 ]; then
  echo "Creando 2 GB de swap…"
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "Servidor listo."
