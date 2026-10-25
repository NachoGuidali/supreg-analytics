#!/bin/sh
# Backup diario de Postgres: una copia al arrancar y después cada 24 h.
# Restaurar: ver DEPLOY.md ("Restaurar un backup").
set -eu
while true; do
  file="/backups/analytics-$(date +%Y%m%d-%H%M).sql.gz"
  # Sin pipe: si pg_dump falla no queda un .gz vacío que parezca un backup válido.
  if pg_dump --no-owner --no-privileges -f /tmp/dump.sql && gzip -c /tmp/dump.sql > "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "backup ok: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.tmp"
    echo "backup FALLÓ: se reintenta en 10 minutos" >&2
    rm -f /tmp/dump.sql
    sleep 600
    continue
  fi
  rm -f /tmp/dump.sql
  find /backups -name 'analytics-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
  sleep 86400
done
