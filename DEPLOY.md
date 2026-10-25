# Despliegue en analytics.supregsolutions.com

Producción corre con Docker Compose en un servidor propio, al lado de tus otros servicios:

```
internet ──► proxy con HTTPS (el que ya tenés, o el Caddy del proyecto)
               ──► 127.0.0.1:8090 nginx (dashboard) ──► gunicorn (API) ──► Postgres
                                                        backup diario ──┘
```

Todo vive en un solo origen: `https://analytics.supregsolutions.com` sirve el dashboard, la API
(`/api/`), el admin (`/admin/`) y el script que se pega en las webs (`/static/analytics.js`).

## Lo que necesitás

- El servidor con **Docker** y **Docker Compose** (`docker compose version`).
- El DNS de `analytics.supregsolutions.com` apuntando al servidor (`dig +short analytics.supregsolutions.com`).
- El repo en GitHub: `https://github.com/NachoGuidali/supreg-analytics`.
- El archivo `.env.production` de tu máquina (tiene los secretos; **no está en GitHub**).

El proyecto está pensado para convivir con otros servicios en el mismo servidor:

| Servicio | Puerto en el host |
|---|---|
| Dashboard (nginx) | `127.0.0.1:8090` (sólo local; `WEB_PORT` en `.env`) |
| API, Postgres, backups | ninguno: sólo en la red interna del proyecto |
| Caddy (opcional) | 80 y 443, **sólo si los activás** y están libres |

Los contenedores se llaman `supreg-analytics-*`, así no chocan con los de tus otros proyectos.

## 1. Bajar el código y la configuración

En el servidor:

```bash
sudo mkdir -p /opt/supreg-analytics && sudo chown $USER: /opt/supreg-analytics
git clone https://github.com/NachoGuidali/supreg-analytics.git /opt/supreg-analytics
```

(Si el repo es privado, `git clone` te pide usuario y un *personal access token* de GitHub, o usá
una deploy key SSH.)

Desde tu máquina, subí la configuración de producción:

```bash
scp .env.production usuario@servidor:/opt/supreg-analytics/.env
```

## 2. Revisar puertos

En el servidor:

```bash
cd /opt/supreg-analytics && bash deploy/check-server.sh
```

Te dice si 80, 443 y 8090 están ocupados, qué proxy atiende tus otros sitios (nginx, Caddy,
Traefik, Nginx Proxy Manager…) y qué conviene hacer. Si 8090 está ocupado, cambiá `WEB_PORT` en
`.env` (y en la configuración del proxy).

## 3. Levantar

```bash
cd /opt/supreg-analytics
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps        # todos "Up"; db "healthy"
curl -sI http://127.0.0.1:8090/ | head -1           # HTTP/1.1 200 OK
```

Después, conectá el dominio según el proxy que tengas.

### Detrás del proxy del servidor (lo más común si ya hay otros sitios)

**nginx del sistema:**

```bash
sudo cp deploy/host-nginx.conf /etc/nginx/conf.d/analytics.supregsolutions.com.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d analytics.supregsolutions.com
```

En RHEL, AlmaLinux o Rocky con SELinux en *Enforcing* (lo muestra `check-server.sh`), nginx
necesita permiso para conectarse a puertos locales: `sudo setsebool -P httpd_can_network_connect 1`.
Si falta, el sitio da *502 Bad Gateway* y en `/var/log/audit/audit.log` aparece un `denied`.
Si `certbot` no está: `sudo dnf install certbot python3-certbot-nginx` (o `apt install` en Debian/Ubuntu).

**Caddy del sistema:** agregá el bloque de `deploy/host-caddy.txt` a tu Caddyfile y recargá Caddy.

**Proxy en Docker (Nginx Proxy Manager, Traefik, Caddy en contenedor):** desde adentro de un
contenedor, `127.0.0.1:8090` no es el host. Sumá el dashboard a la red del proxy:

```bash
docker network ls                                   # buscá la red de tu proxy
echo "PROXY_NETWORK=nombre_de_la_red" >> .env
docker compose -f docker-compose.prod.yml -f docker-compose.proxy-net.yml up -d
```

y en el proxy apuntá `analytics.supregsolutions.com` a `http://supreg-analytics-web-1:80`, con
HTTPS (en Nginx Proxy Manager: *Proxy Host* + pestaña *SSL* con Let's Encrypt). El proxy tiene que
mandar `X-Forwarded-Proto: https` y `X-Forwarded-For` con la IP del visitante (NPM y Traefik lo
hacen solos).

### Con el Caddy del proyecto (sólo si 80 y 443 están libres)

En `.env`, descomentá `COMPOSE_PROFILES=caddy` y volvé a correr el `up -d`. Caddy saca el
certificado de Let's Encrypt solo.

### Crear tu usuario

```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
```

Entrá a <https://analytics.supregsolutions.com> con ese usuario.

## 4. Primer cliente y primera web

1. **Clientes → Nuevo cliente**: nombre del cliente y email y contraseña de su dueño. Copiá el
   mensaje con los datos de acceso y mandáselo.
2. En el cliente, **Sitios → Agregar sitio**: nombre, dominio (`tienda.com`, sin `https://`; acepta
   también `www.` y subdominios) y zona horaria.
3. **Snippet**: copialo y pegalo antes de `</head>` en todas las páginas de esa web:

   ```html
   <script src="https://analytics.supregsolutions.com/static/analytics.js" data-api-key="…" defer></script>
   ```

   En WordPress sirve un plugin tipo *Insert Headers and Footers* o el tema (Apariencia → Editor);
   en Tiendanube y Shopify, la sección de código personalizado del `<head>`; en Wix, Configuración →
   Código personalizado.
4. Abrí la web y mirá **Eventos en vivo**: en segundos aparecen las visitas. La guía de inicio del
   Resumen te lleva por el resto (eventos sin código, objetivos, equipo).

## Cuando alguien contrata

Mientras no haya pago online, el circuito es manual y lleva un par de minutos:

1. Una sola vez: en **Plataforma → Planes** cargá tus planes (precio, mensual o anual, cuántas webs
   incluye y una referencia de eventos por mes).
2. El interesado toca **Contratar** (en la página del producto o en el login del panel) y te escribe
   por WhatsApp con un mensaje ya armado. Acordás el plan y el pago.
3. **Clientes → Nuevo cliente**: nombre, plan (el vencimiento se completa solo a un período desde hoy),
   notas internas y el **email del dueño**. La contraseña inicial se genera sola.
4. Copiás el mensaje con los datos de acceso y se lo mandás por WhatsApp.
5. El cliente entra en <https://analytics.supregsolutions.com> con su email y esa contraseña,
   la cambia desde **Mi cuenta**, agrega su web y pega el snippet. Desde **Equipo** suma a su gente.

### Vencimientos y pagos

- En **Clientes** ves el plan y el estado de cada uno (al día, vence en N días, vencido) y podés
  filtrar **Por vencer** y **Vencidos**. El menú muestra cuántos necesitan atención.
- Cuando te pagan: ficha del cliente → **Plan y pagos → Registrar pago**. El vencimiento se corre un
  período del plan (desde la fecha actual si todavía no venció, si no desde hoy). Ahí también ves el
  historial y el uso del mes contra lo que incluye el plan.
- Los **dueños** del cliente ven un aviso con el botón **Renovar** (a tu WhatsApp, con el nombre del
  cliente en el mensaje) desde `BILLING_WARN_DAYS` días antes del vencimiento.
- Si no renueva: con `BILLING_AUTO_BLOCK=1` el cliente queda bloqueado solo cuando pasan
  `BILLING_GRACE_DAYS` días del vencimiento, y se desbloquea al registrar el pago. Con `0` (por
  defecto) sólo se avisa y lo suspendés vos a mano (**Suspender cliente**). En los dos casos los datos
  se conservan.
- Un cliente sin vencimiento (por ejemplo, de cortesía o interno) nunca vence. Sin plan no tiene límites.
- El límite de webs del plan aplica a los dueños; vos podés pasarte (por ejemplo, mientras cambiás de plan).

El botón **Contratar** se configura en `.env`:

```bash
SALES_WHATSAPP=5491163589975                     # número al que llega el mensaje
SALES_MESSAGE=Hola, quiero contratar SupReg Analytics
SALES_URL=                                       # link de pago (Mercado Pago): si está, reemplaza a WhatsApp
PRODUCT_URL=https://supregsolutions.com/analytics # "Conocé todo lo que mide" en el login
```

Después de cambiarlo: `docker compose -f docker-compose.prod.yml up -d backend`.

## Operación

### Actualizar a una versión nueva

Subí los cambios a GitHub y en el servidor:

```bash
cd /opt/supreg-analytics && bash deploy/update.sh
```

Hace `git pull`, reconstruye, aplica las migraciones al arrancar y reinicia sin tocar la base, el
`.env` ni los certificados. El corte dura unos segundos; el script de las webs reintenta lo que no
pudo enviar.

### Ver logs y estado

```bash
cd /opt/supreg-analytics
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=100 backend   # o caddy, web, db, backup
```

### Backups

El servicio `backup` guarda una copia comprimida de la base al arrancar y después cada 24 horas en
`/opt/supreg-analytics/backups/`, y borra las de más de 14 días (`BACKUP_KEEP_DAYS` en `.env`).

Esas copias están en el mismo servidor: **bajalas a otro lado** de vez en cuando (o configurá los
snapshots del proveedor):

```bash
rsync -az usuario@IP_DEL_SERVIDOR:/opt/supreg-analytics/backups/ ./backups-analytics/
```

### Restaurar un backup

```bash
cd /opt/supreg-analytics
docker compose -f docker-compose.prod.yml stop backend backup
gunzip -c backups/analytics-AAAAMMDD-HHMM.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db sh -c \
  'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS $POSTGRES_DB" -c "CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER" && psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose -f docker-compose.prod.yml start backend backup
```

### País de los visitantes (opcional)

1. Creá una cuenta gratis en MaxMind y bajá **GeoLite2 Country** (`GeoLite2-Country.mmdb`).
2. Subilo a `/opt/supreg-analytics/deploy/geoip/GeoLite2-Country.mmdb`.
3. `docker compose -f docker-compose.prod.yml restart backend`

La IP se usa sólo para buscar el país y nunca se guarda. MaxMind actualiza la base cada semana;
renovarla una vez por mes alcanza.

### Contraseñas olvidadas

Desde **Clientes → (cliente) → Equipo → Nueva contraseña**. Para tu propio usuario de plataforma:

```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py changepassword TU_USUARIO
```

## Casos especiales

### Cloudflare

Con la nube naranja (proxy) activada:

- En Cloudflare → SSL/TLS, modo **Full (strict)**.
- En `deploy/Caddyfile`, borrá la línea `header_up -CF-IPCountry`: así el país sale de Cloudflare
  sin necesitar GeoLite2.
- Caddy renueva el certificado igual (desafío HTTP a través de Cloudflare). Si alguna vez falla,
  pasá la nube a gris unos minutos.

### Más tráfico

La ingesta es síncrona y aguanta bien decenas de eventos por segundo con 3 workers. Si crece:
subí `GUNICORN_WORKERS` en `.env` (2 por vCPU es un buen punto de partida) y el tamaño del servidor.
