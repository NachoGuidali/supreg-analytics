# SupReg Analytics

Plataforma de analítica web multi-cliente, tipo Google Analytics + Amplitude simplificado. Se instala
con un `<script>` y registra solo visitas, clicks, scroll, tiempo, descargas, formularios y videos.
Todo lo que se captura se configura desde el dashboard, sin tocar el código de la web.

Qué ofrece:

- **Resumen** con visitantes, sesiones, rebote, duración, objetivos y las mejoras más importantes.
- **Reportes** de Adquisición (canales, fuentes, campañas, páginas de entrada), Comportamiento (páginas,
  alcance de scroll, tiempo, clicks, descargas, formularios, clicks de frustración) y Audiencia
  (dispositivos, países, nuevos y recurrentes, mapa de días y horarios).
- **Mejoras**: hallazgos automáticos con una recomendación cada uno (picos, caídas, fuentes que crecen,
  páginas con mucho rebote, clicks de frustración, rebote en celular, objetivos que cambian, datos que
  dejaron de llegar).
- **Captura de datos**: prender o apagar cada captura automática, elegir los cortes de scroll, excluir
  rutas y crear **eventos sin código** (click en un selector, visita a una página, scroll, tiempo, formulario).
- **Objetivos** de conversión con tasa, evolución y conversiones por canal.
- **Catálogo de eventos** con volumen, tendencia, nombres legibles y descripciones.
- **Constructor de análisis** (tendencia, embudo, retención, ranking, número) y **dashboards** armados
  con análisis guardados.
- **Ayuda**: guía de inicio por sitio, ayudas contextuales en cada métrica, glosario, recetas,
  generador de links con UTM y preguntas frecuentes.
- **Multi-cliente** con roles (ver más abajo).

| Parte | Tecnología | Carpeta |
|---|---|---|
| API, ingesta y motor de análisis | Django 5 + DRF + PostgreSQL | `backend/` |
| Dashboard | React + Vite + Tailwind + Recharts | `frontend/` |
| SDK de tracking | JavaScript sin dependencias (9 kB) | `sdk/` → `backend/tracking/static/analytics.js` |

La especificación original está en `prompt-claude-code-analytics.md`.

---

## 1. Levantarlo

Requisito: Docker con Docker Compose.

```bash
cp .env.example .env
docker compose up -d
docker compose exec backend python manage.py createsuperuser
```

- Dashboard: <http://localhost:5173> (entrá con el superusuario: es el administrador de la plataforma)
- Admin de Django: <http://localhost:8000/admin/>

La primera vez el contenedor del frontend instala dependencias y tarda un minuto en responder.

### Datos de demo

Para ver el dashboard con datos sin instalar nada en un sitio:

```bash
docker compose exec backend python manage.py seed_demo_data
```

Crea el sitio **Demo** (dominio `localhost`) con 30 días de tráfico: varias fuentes (Google,
Instagram, Facebook Ads, newsletter, directo), visitantes que vuelven, rebotes, scroll, clicks,
descargas, videos y un embudo producto → scroll 50% → click a WhatsApp con caída natural. Si el sitio
no tiene configuración propia, también crea análisis guardados, un dashboard, tres objetivos, dos
eventos sin código y descripciones de eventos.

Opciones: `--days 60`, `--visitors 3000`, `--reset` (borra antes los datos de tracking del sitio),
`--site-id <uuid>` (usar otro sitio).

### Marca del dashboard

La marca es **SupReg Analytics** para todos los clientes: tinta violeta en la barra lateral, señal
ámbar como acento (ocre en modo claro, para que el texto sea legible sobre blanco), Bricolage
Grotesque en títulos y cifras e Instrument Sans en el resto. Se puede cambiar desde `.env`:

```bash
BRAND_NAME=SupReg Analytics
BRAND_COLOR=                 # vacío = ámbar de SupReg; un #RRGGBB lo reemplaza
BRAND_LOGO_URL=              # vacío = marca dibujada (señal + nombre)
BRAND_DEFAULT_THEME=system   # system, light o dark
```

Cada usuario puede cambiar el tema desde la barra lateral.

### Producción

nginx + gunicorn + Postgres con backup diario, detrás del proxy con HTTPS que ya tenga el servidor
(o del Caddy incluido). Convive con otros servicios: sólo publica `127.0.0.1:8090`. La guía completa
para `analytics.supregsolutions.com` está en **[DEPLOY.md](DEPLOY.md)**. En corto, en el servidor:

```bash
git clone https://github.com/NachoGuidali/supreg-analytics.git /opt/supreg-analytics
# copiar .env.production como /opt/supreg-analytics/.env
bash deploy/check-server.sh                              # puertos y proxy existentes
docker compose -f docker-compose.prod.yml up -d --build
bash deploy/update.sh                                    # para cada actualización
```

---

## Clientes, usuarios y roles (multi-tenant)

La plataforma atiende a varios **clientes**. Cada cliente tiene sus sitios y su equipo, y nunca ve
los datos de otro.

| Quién | Qué puede hacer |
|---|---|
| **Superusuario** (plataforma) | Da de alta, suspende y borra clientes; ve y gestiona todo |
| **Dueño** de un cliente | Crea y edita los sitios del cliente; gestiona su equipo (incluida una contraseña nueva para quien la olvidó); todo lo del editor |
| **Editor** | Análisis guardados, dashboards, objetivos, catálogo de eventos y captura de datos |
| **Lector** | Ve todos los reportes, dashboards y eventos en vivo; puede explorar en el constructor sin guardar |

- Un usuario puede pertenecer a varios clientes, con un rol distinto en cada uno (por ejemplo, una agencia).
- Los usuarios de clientes entran con su email.
- Un cliente **suspendido** no puede entrar y sus sitios dejan de recibir eventos. Sus datos se conservan.
- Cada cliente puede tener un **plan** (límite de webs) y un **vencimiento**. La plataforma registra los
  pagos; los dueños ven un aviso para renovar. Opcionalmente, bloqueo automático al vencer (ver DEPLOY.md).
- Un cliente siempre tiene al menos un dueño. No se puede borrar un cliente con sitios: primero hay que borrarlos desde el admin.
- Las notas internas del cliente sólo las ve la plataforma.

En el dashboard:

- **Clientes** (sólo superusuarios): lista con búsqueda, estado y sesiones de los últimos 14 días.
  *Nuevo cliente* crea el cliente y su dueño, y arma el mensaje con los datos de acceso para mandárselo.
  En cada cliente: sus sitios (con acceso directo a su analítica y su snippet), su equipo, sus datos,
  y suspender o reactivar.
- **Selector de sitio** (barra lateral): agrupa los sitios por cliente cuando hay más de uno.
- **Equipo**: el equipo del cliente del sitio elegido. Los dueños suman personas (si el email ya tiene
  usuario, se suma con su contraseña de siempre) y cambian roles.
- **Mi cuenta**: accesos por cliente y cambio de contraseña.
- Las acciones que el rol no permite no se muestran: un lector puede explorar en el constructor
  pero no guardar.
- Se puede entrar con el email o con el usuario.

---

## 2. Crear un sitio y obtener la api_key

Cada web que querés medir es un **sitio**. Podés crearlo de dos formas:

- **Desde el dashboard:** sección **Instalación** → *Agregar otro sitio* (si no hay ninguno, el
  formulario aparece solo). Completá nombre, dominio (`mitienda.com`, sin `https://`) y zona horaria.
- **Desde el admin:** <http://localhost:8000/admin/sites/site/add/>.

La `api_key` se genera sola. La ves en **Instalación**, ya insertada en el snippet.

El dominio define desde dónde se aceptan eventos: `mitienda.com` acepta también `www.mitienda.com`
y cualquier subdominio. La zona horaria define dónde empieza cada día en los reportes.

---

## 3. Instalar el snippet en una web

Pegá esto en todas las páginas, antes de `</head>`:

```html
<script src="https://TU-BACKEND/static/analytics.js" data-api-key="TU_API_KEY" defer></script>
```

Sin configurar nada más, registra:

| Evento | Cuándo |
|---|---|
| `page_view` | Cada página, incluidos los cambios de ruta en apps de una sola página (`history.pushState`) |
| `session_start` | Primer evento de cada sesión (30 min de inactividad, o un link de campaña nuevo) |
| `scroll_depth` | Al 25, 50, 75 y 100% (`depth_percent`) |
| `time_on_page` | Al salir: segundos con la pestaña visible |
| `bounce` | Salida en menos de 10 s sin interactuar, en la primera página de la sesión |
| `rage_click` | 3 clicks o más en el mismo elemento en menos de 1 s |
| `click` | Click en botones y links (`text`, `element`, `href`) |
| `outbound_click` | Click en un link a otro dominio (`target_url`) |
| `file_download` | Click en un link a un archivo: PDF, planillas, ZIP… (`file_url`, `extension`) |
| `form_submit` | Envío de un formulario (`form_id`, nunca los valores) |
| `video_play`, `video_progress`, `video_complete` | Elementos `<video>`, incluso los agregados después |

La atribución (`referrer` y `utm_*`) se toma al empezar la sesión y se asocia a todos sus eventos.

### Configurar la captura sin tocar código

En **Captura de datos** (rol editor o dueño):

- Prendé o apagá cada captura automática (todas menos visitas y sesiones).
- Elegí los cortes de scroll (por defecto 25, 50, 75 y 100%).
- Excluí rutas: `/admin*` deja de medir `/admin` y todo lo que cuelga.
- Creá **eventos sin código**:

| Tipo | Se dispara cuando… | Ejemplo |
|---|---|---|
| Click | se clickea un elemento que coincide con un selector CSS | `a[href*='wa.me']` → `click_whatsapp` |
| Visita a una página | la ruta es igual, empieza con, contiene o cumple una expresión regular | `/gracias` → `compra_completa` |
| Scroll | se llega a un porcentaje de la página | 75% en `/blog/` → `leyo_articulo` |
| Tiempo | pasan N segundos con la página visible | 60 s → `visita_comprometida` |
| Formulario | se envía un formulario (opcionalmente uno puntual) | `#contacto` → `envio_contacto` |

El script baja esta configuración de `GET /api/track/config/?key=API_KEY` y la guarda 5 minutos en el
navegador, así que los cambios llegan a la web en unos minutos.

### Eventos propios

Con atributos HTML, sin JavaScript. Cada `data-track-*` se guarda como propiedad
(`data-track-button-color` → `button_color`):

```html
<a href="https://wa.me/549..." data-track="whatsapp_click" data-track-location="header">WhatsApp</a>
```

Desde JavaScript:

```js
analytics.track("video_played", { video_id: "demo", duration: 120 });
```

Si tu código puede llamar a `analytics.track` antes de que cargue el script, agregá antes del snippet:

```html
<script>
  window.analytics = window.analytics || { track: function () { (analytics.q = analytics.q || []).push(arguments); } };
</script>
```

Otros detalles del SDK:

- Envía en lotes cada 5 s o cada 10 eventos. Al salir de la página usa `navigator.sendBeacon`.
- Si un envío falla por red o error 5xx, lo reintenta con backoff y lo guarda en `localStorage` para
  la próxima visita.
- Respeta *Do Not Track*.
- Atributos opcionales del `<script>`: `data-endpoint="https://otro-host"` y `data-debug`
  (loguea cada evento en la consola).

### Verificar la instalación

Abrí tu sitio y mirá **Eventos en vivo** en el dashboard (se actualiza cada 10 s). Para probar sin un
sitio real, usá el sitio Demo (dominio `localhost`) y abrí
`http://localhost:5173/static/demo.html?api_key=API_KEY_DEL_SITIO` (el link está en **Instalación**).

> Los navegadores headless y los bots conocidos se descartan a propósito: si probás con Playwright
> o Puppeteer, configurá un User-Agent normal.

---

## 4. Crear el primer análisis

1. Entrá a **Constructor**.
2. Elegí el tipo:
   - **Tendencia:** un evento a lo largo del tiempo, opcionalmente separado por una propiedad.
   - **Embudo:** pasos en orden, dentro de una ventana de conversión.
   - **Retención:** qué porcentaje de cada cohorte vuelve en los días o semanas siguientes.
   - **Ranking:** los valores más frecuentes de una propiedad.
   - **Número:** un total, comparado con el período anterior.
3. Elegí el evento. Los selectores muestran los eventos y propiedades que realmente llegaron.
4. Agregá filtros. Los operadores cambian según el tipo de dato (texto, número, booleano) y el campo
   de valor sugiere valores frecuentes.
5. El resultado se actualiza solo medio segundo después de cada cambio. Arriba del gráfico, la
   configuración se lee como una frase. Por ejemplo: *"Visitantes únicos de whatsapp_click donde
   utm_source es instagram, por día"*.
6. **Guardar análisis** → nombre. Queda en **Análisis guardados**, desde donde podés editarlo,
   duplicarlo, borrarlo o fijarlo en el **Resumen**.

El selector de rango de fechas (arriba) aplica a todas las vistas.

---

## Desarrollo

### Tests

```bash
# Motor, aislamiento entre clientes y roles, captura configurable, objetivos, dashboards,
# reportes y mejoras: 132 tests
docker compose exec backend python manage.py test

# SDK con jsdom: 29 tests sobre la fuente y la versión minificada (incluye el control de tamaño < 10 kB)
docker run --rm -v "$PWD/sdk":/sdk -v "$PWD/backend":/backend -w /sdk node:22-alpine \
  sh -c "npm install && npm test && npm run build && npm run test:min"
```

Después de modificar `sdk/src/analytics.js` hay que correr `npm run build` para regenerar
`backend/tracking/static/analytics.js`.

### Estructura del backend

```
backend/
  accounts/     Client (tenant), Membership (usuario + rol), access.py: alcance por cliente de toda la API
  sites/        Site (dominio, api_key, zona horaria, captura), TrackingRule (eventos sin código),
                configuración pública para el SDK, guía de inicio, CORS dinámico por dominio
  tracking/     Visitor, Session, Event, ingesta (/api/track/), seed_demo_data, analytics.js
  analytics/    SavedAnalysis, Dashboard, Goal, EventDefinition, API de consulta
    reports.py  adquisición (canales), comportamiento y audiencia
    insights.py mejoras automáticas
    engine/     motor: config JSON -> queries
      filters.py      filtros -> Q (campos del evento, sesión, visitante y properties.*)
      trend.py  funnel.py  retention.py  breakdown.py  metric.py
      base.py         registro de tipos: un tipo nuevo es un módulo con @register
```

### API

Ingesta (autenticada con `api_key` en el body, validando el `Origin` contra el dominio del sitio):
`POST /api/track/` y `POST /api/track/batch/`. Configuración para el SDK: `GET /api/track/config/?key=`.

Consulta (sesión de un superusuario o de un miembro de un cliente activo). Un sitio, análisis o
cliente ajeno responde 404. Uno propio sin el rol necesario responde 403.

| Endpoint | |
|---|---|
| `GET /api/auth/me/`, `POST /api/auth/login/`, `POST /api/auth/logout/` | Sesión (`me` incluye `is_platform_admin` y `memberships`) |
| `POST /api/auth/password/` | Cambiar la contraseña propia |
| `GET/POST /api/clients/`, `GET/PATCH/DELETE /api/clients/{id}/` | Clientes. Alta con `owner: {email, password}` |
| `GET /api/clients/activity/?days=14` | Sesiones por día de cada cliente visible (días en UTC) |
| `GET/POST /api/clients/{id}/members/`, `PATCH/DELETE .../members/{id}/` | Equipo del cliente |
| `GET/POST /api/sites/?client_id=`, `GET/PATCH /api/sites/{id}/` | Sitios (incluyen `client_id` y el `role` del usuario) |
| `POST /api/analysis/run/` | Ejecutar una config sin guardarla |
| `GET/POST /api/analyses/?site_id=&is_pinned=true`, `GET/PATCH/DELETE /api/analyses/{id}/` | Análisis guardados |
| `GET /api/analyses/{id}/run/?date_from=&date_to=` | Ejecutar un análisis guardado |
| `GET /api/events/names/?site_id=` | Eventos de los últimos 90 días |
| `GET /api/events/properties/?site_id=&event_name=` | Campos filtrables con tipo y valores frecuentes |
| `GET /api/events/recent/?site_id=&after_id=` | Explorador en vivo |
| `GET /api/overview/?site_id=&date_from=&date_to=` | Métricas resumen vs período anterior |
| `GET /api/reports/acquisition/`, `.../behavior/?page=`, `.../audience/` | Reportes fijos (con `site_id` y fechas) |
| `GET /api/insights/?site_id=` | Mejoras del período |
| `GET/POST /api/goals/?site_id=`, `GET /api/goals/stats/?site_id=` | Objetivos y sus conversiones |
| `GET/POST /api/dashboards/?site_id=`, `GET/PATCH/DELETE /api/dashboards/{id}/` | Dashboards (`layout`: `[{analysis_id, width}]`, ancho 4, 6, 8 o 12) |
| `GET/POST /api/tracking-rules/?site_id=` | Eventos sin código |
| `GET/PATCH /api/sites/{id}/tracking/` | Captura automática, cortes de scroll, rutas excluidas |
| `GET /api/sites/{id}/setup/` | Pasos de la guía de inicio y estado de la instalación |
| `GET /api/events/catalog/?site_id=`, `POST /api/event-definitions/` | Catálogo de eventos y su nombre/descripción |
| `POST /api/clients/{id}/members/{id}/reset-password/` | Contraseña nueva para un miembro |
| `GET/POST /api/plans/`, `GET/PATCH/DELETE /api/plans/{id}/` | Planes (sólo plataforma) |
| `GET/POST /api/clients/{id}/payments/`, `DELETE .../payments/{id}/` | Pagos de un cliente; registrar uno corre el vencimiento (`extend_periods`) |

Las fechas son `YYYY-MM-DD` en la zona horaria del sitio. Sin fechas se usan los últimos 30 días.

### País de los visitantes

Por defecto queda vacío. Para completarlo:

- **Detrás de Cloudflare:** activá `TRACKING_TRUST_PROXY_HEADERS=1` (usa `CF-IPCountry`).
- **Con una base GeoLite2:** montá `GeoLite2-Country.mmdb` en el contenedor y apuntá `GEOIP_PATH` a
  ese archivo.

La IP nunca se guarda.
# supreg-analytics
