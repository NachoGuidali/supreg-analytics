# Despliegue en analytics.supregsolutions.com

Producción corre con Docker Compose en un servidor propio:

```
internet ──► Caddy (HTTPS automático, 80/443) ──► nginx (dashboard) ──► gunicorn (API) ──► Postgres
                                                                         backup diario ──┘
```

Todo vive en un solo origen: `https://analytics.supregsolutions.com` sirve el dashboard, la API
(`/api/`), el admin (`/admin/`) y el script que se pega en las webs (`/static/analytics.js`).

## Lo que necesitás

- **Un servidor** Ubuntu 22.04/24.04 (o Debian 12) con IP pública. Para empezar alcanza con
  2 GB de RAM y 1-2 vCPU (DigitalOcean, Hetzner, Vultr, Contabo…). Si el servidor ya corre otros
  sitios con un nginx o Traefik en los puertos 80/443, mirá [Si el servidor ya tiene otro proxy](#si-el-servidor-ya-tiene-otro-proxy).
- **Acceso SSH** con un usuario con `sudo`.
- **Acceso al DNS** de `supregsolutions.com`.

## 1. DNS

En el panel donde administrás `supregsolutions.com`, creá un registro:

| Tipo | Nombre | Valor | TTL |
|---|---|---|---|
| A | `analytics` | IP del servidor | automático |

Si el dominio está en **Cloudflare**, dejá la nube en gris (*DNS only*) al menos hasta que Caddy
saque el certificado. Ver [Cloudflare](#cloudflare) si después querés el proxy naranja.

Verificá desde tu máquina que ya apunta (puede tardar unos minutos):

```bash
dig +short analytics.supregsolutions.com   # tiene que devolver la IP del servidor
```

## 2. Preparar el servidor (una sola vez)

Desde tu máquina, en la carpeta del proyecto:

```bash
ssh usuario@IP_DEL_SERVIDOR 'bash -s' < deploy/server-setup.sh   # Docker, rsync, firewall (22, 80, 443) y swap
```

## 3. Levantar

Desde tu máquina, en la carpeta del proyecto:

```bash
./deploy/sync.sh usuario@IP_DEL_SERVIDOR
```

La primera vez sube `.env.production` como `.env` (ya trae la contraseña de la base y la clave de
Django generadas, y el dominio configurado). Construye las imágenes (2-4 minutos) y levanta todo.
Caddy pide el certificado a Let's Encrypt en los primeros segundos.

Creá tu usuario de administrador de la plataforma:

```bash
ssh usuario@IP_DEL_SERVIDOR
cd /opt/supreg-analytics
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

```bash
./deploy/sync.sh usuario@IP_DEL_SERVIDOR
```

Reconstruye, aplica las migraciones al arrancar y reinicia sin tocar la base, el `.env` del
servidor ni los certificados. El corte dura unos segundos; el script de las webs reintenta lo que no
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

### Si el servidor ya tiene otro proxy

Si ya hay un nginx, Traefik o Caddy usando los puertos 80/443 para otros sitios, no levantes el
Caddy de este proyecto:

1. En `docker-compose.prod.yml`, borrá el servicio `caddy` y en `web` cambiá `expose: ["80"]` por
   `ports: ["127.0.0.1:8080:80"]`.
2. En tu proxy, apuntá `analytics.supregsolutions.com` a `http://127.0.0.1:8080` pasando los headers
   `Host`, `X-Forwarded-For` (con la IP real del visitante) y `X-Forwarded-Proto: https`. Ejemplo
   para nginx:

   ```nginx
   location / {
       proxy_pass http://127.0.0.1:8080;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $remote_addr;
       proxy_set_header X-Forwarded-Proto https;
   }
   ```

### Más tráfico

La ingesta es síncrona y aguanta bien decenas de eventos por segundo con 3 workers. Si crece:
subí `GUNICORN_WORKERS` en `.env` (2 por vCPU es un buen punto de partida) y el tamaño del servidor.
