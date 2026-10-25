# Plataforma de Analítica Web — Spec + Prompt para Claude Code

---

# PARTE 1: ESPECIFICACIÓN

## Objetivo

Plataforma de analítica web self-hosted, tipo Amplitude simplificado, para instalar en sitios propios mediante un snippet de JS. Sin necesidad de login de usuarios finales (tracking anónimo).

Dos capacidades centrales:
1. **Captura automática + manual de eventos** de comportamiento en el sitio.
2. **Dashboard con constructor de análisis personalizables** (el usuario arma sus propios reportes, no dashboards fijos).

---

## Eventos a capturar

### Automáticos (sin configurar nada, el SDK los dispara solo)

| Evento | Cuándo se dispara | Propiedades |
|---|---|---|
| `page_view` | Al cargar la página | `page`, `title`, `referrer`, `utm_*`, `device_type`, `screen_width` |
| `scroll_depth` | Al alcanzar 25/50/75/100% de la página | `depth_percent`, `page` |
| `time_on_page` | Al salir de la página (beforeunload) | `seconds`, `page` |
| `bounce` | Salida en <10s sin ninguna interacción | `seconds`, `page` |
| `rage_click` | 3+ clicks en el mismo elemento en <1s | `element`, `page` |
| `outbound_click` | Click en cualquier link externo | `target_url`, `page` |
| `form_submit` | Submit de cualquier `<form>` | `form_id`, `page` |
| `session_start` | Primer evento de una sesión nueva | `referrer`, `utm_*`, `landing_page` |

### Manuales (se agregan con un atributo HTML o llamando la función)

Opción A — atributo declarativo, sin escribir JS:
```html
<a href="https://wa.me/549..." data-track="whatsapp_click" data-track-location="header">
  WhatsApp
</a>
```

Opción B — llamada programática:
```js
analytics.track('video_played', { video_id: 'demo', duration: 120 });
```

### Video tracking
Auto-detectar elementos `<video>` y disparar: `video_play`, `video_progress` (25/50/75%), `video_complete`, con propiedad `video_id` y `position_seconds`.

---

## Atribución (de dónde viene la gente)

Se captura al inicio de sesión y se adjunta a **todos** los eventos de esa sesión:
- `referrer` — dominio de origen (automático del navegador).
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` — de los parámetros de URL.
- Se guarda en `sessionStorage` en el primer pageview para no perderlo al navegar internamente.

---

## Esquema de base de datos

### `Site`
Permite trackear varios sitios con la misma instalación.

| Campo | Tipo | Descripción |
|---|---|---|
| id | UUID (PK) | |
| name | CharField(100) | Nombre del sitio |
| domain | CharField(255) | Dominio permitido (para validar CORS) |
| api_key | CharField(64) unique | Clave pública que va en el snippet |
| created_at | DateTimeField | |

### `Visitor`
Usuario anónimo identificado por UUID en localStorage.

| Campo | Tipo | Descripción |
|---|---|---|
| id | UUID (PK) | |
| site | FK → Site | |
| visitor_id | CharField(64) | UUID generado en el cliente |
| first_seen_at | DateTimeField | |
| last_seen_at | DateTimeField | |
| first_referrer | CharField(255) null | |
| first_utm_source | CharField(100) null | |
| first_utm_campaign | CharField(100) null | |
| device_type | CharField(20) | mobile / tablet / desktop |
| country | CharField(2) null | derivado de IP |

Índice: `(site, visitor_id)` unique.

### `Session`

| Campo | Tipo | Descripción |
|---|---|---|
| id | UUID (PK) | |
| site | FK → Site | |
| visitor | FK → Visitor | |
| session_id | CharField(64) | |
| started_at | DateTimeField | |
| ended_at | DateTimeField null | |
| referrer | CharField(255) null | |
| utm_source / utm_medium / utm_campaign / utm_content / utm_term | CharField(100) null | |
| landing_page | CharField(500) | |
| event_count | IntegerField default=0 | |
| is_bounce | BooleanField default=False | |

### `Event`

| Campo | Tipo | Descripción |
|---|---|---|
| id | BigAutoField (PK) | |
| site | FK → Site | |
| visitor | FK → Visitor | |
| session | FK → Session | |
| event_name | CharField(100) | snake_case |
| page | CharField(500) | pathname donde ocurrió |
| timestamp | DateTimeField | del cliente |
| received_at | DateTimeField auto_now_add | del servidor |
| properties | JSONField default=dict | propiedades libres del evento |

Índices: `(site, event_name, timestamp)`, `(site, timestamp)`, `(visitor, timestamp)`, índice GIN sobre `properties`.

### `SavedAnalysis`
**Esta es la tabla clave del constructor de análisis.** Guarda la configuración de un reporte personalizado.

| Campo | Tipo | Descripción |
|---|---|---|
| id | UUID (PK) | |
| site | FK → Site | |
| name | CharField(200) | Ej: "Conversión a WhatsApp desde Instagram" |
| description | TextField blank | |
| analysis_type | CharField(20) | `trend` / `funnel` / `retention` / `breakdown` / `metric` |
| config | JSONField | Ver estructura abajo |
| created_at / updated_at | DateTimeField | |
| is_pinned | BooleanField default=False | Aparece en el dashboard principal |

Estructura de `config` según `analysis_type`:

```json
// trend — evolución de un evento en el tiempo
{
  "event_name": "whatsapp_click",
  "filters": [
    { "property": "utm_source", "operator": "equals", "value": "instagram" },
    { "property": "page", "operator": "contains", "value": "/productos" }
  ],
  "group_by": "day",
  "breakdown_by": "properties.location",
  "measure": "count"
}

// funnel — pasos de conversión
{
  "steps": [
    { "event_name": "page_view", "filters": [] },
    { "event_name": "scroll_depth", "filters": [{"property":"properties.depth_percent","operator":"gte","value":50}] },
    { "event_name": "whatsapp_click", "filters": [] }
  ],
  "conversion_window_hours": 24,
  "filters": []
}

// retention — quiénes vuelven
{
  "start_event": "page_view",
  "return_event": "page_view",
  "period": "day",
  "periods_count": 30
}

// breakdown — ranking agrupado
{
  "event_name": "whatsapp_click",
  "breakdown_by": "properties.location",
  "measure": "count",
  "limit": 10,
  "filters": []
}

// metric — un solo número grande
{
  "event_name": "whatsapp_click",
  "measure": "unique_visitors",
  "filters": [],
  "compare_to_previous_period": true
}
```

Operadores de filtro soportados: `equals`, `not_equals`, `contains`, `not_contains`, `gt`, `gte`, `lt`, `lte`, `is_set`, `is_not_set`, `in`.

Campos filtrables: cualquier campo de `Event` (`event_name`, `page`), cualquier propiedad dentro de `properties` (con notación `properties.xxx`), y campos de la sesión (`utm_source`, `utm_campaign`, `referrer`, `device_type`).

### `Dashboard` (opcional pero recomendado)

| Campo | Tipo | Descripción |
|---|---|---|
| id | UUID (PK) | |
| site | FK → Site | |
| name | CharField(200) | |
| layout | JSONField | array de `{analysis_id, position, width}` |

---

## Endpoints de la API

### Ingesta (públicos, autenticados con api_key)
- `POST /api/track/` — un evento. Body incluye `api_key`, `event_name`, `visitor_id`, `session_id`, `timestamp`, `page`, `properties`.
- `POST /api/track/batch/` — array de eventos (el SDK envía en lotes para reducir requests).

### Consulta (autenticados con login de admin)
- `POST /api/analysis/run/` — ejecuta una config de análisis **sin guardarla** (para la vista previa en vivo del constructor). Body: `{analysis_type, config, date_from, date_to}`.
- `GET|POST /api/analyses/` — listar / crear análisis guardados.
- `GET|PUT|DELETE /api/analyses/{id}/` — detalle, editar, borrar.
- `GET /api/analyses/{id}/run/?date_from=&date_to=` — ejecutar un análisis guardado.
- `GET /api/events/names/` — lista de nombres de eventos existentes (para poblar los selectores del constructor).
- `GET /api/events/properties/?event_name=X` — propiedades disponibles para ese evento (para poblar los filtros dinámicamente).
- `GET /api/overview/?date_from=&date_to=` — métricas resumen: visitantes únicos, sesiones, pageviews, tasa de rebote, duración media de sesión.

---

## Dashboard (frontend)

### Vista 1 — Overview
Tarjetas con métricas clave + gráfico de visitas en el tiempo + tabla de páginas más vistas + tabla de fuentes de tráfico (referrer / utm_source).

### Vista 2 — Constructor de análisis (la vista central)
Interfaz de 3 paneles:
- **Izquierda (configuración):** selector de tipo de análisis → selector de evento (poblado desde `/api/events/names/`) → constructor de filtros (agregar/quitar condiciones con selector de propiedad + operador + valor) → selector de agrupación y breakdown → selector de rango de fechas.
- **Centro (preview en vivo):** el gráfico se actualiza automáticamente (con debounce) cada vez que cambia la config, llamando a `/api/analysis/run/`.
- **Arriba:** campo de nombre + botón "Guardar análisis".

### Vista 3 — Análisis guardados
Grilla de los análisis guardados, cada uno renderizado como tarjeta con su gráfico. Acciones: abrir en el constructor para editar, duplicar, fijar al dashboard, borrar.

### Vista 4 — Explorador de eventos en vivo
Tabla en tiempo real (polling cada 10s) de los últimos eventos recibidos, para verificar que el tracking está funcionando al instalarlo. Es clave para debug.

Tipos de gráfico: línea (trend), embudo (funnel), heatmap de cohortes (retention), barras horizontales (breakdown), número grande con delta (metric).

---

## Stack

- **Backend:** Django 5 + Django REST Framework + PostgreSQL
- **Frontend:** React + Vite + Recharts + TailwindCSS
- **SDK:** JavaScript vanilla, sin dependencias, servido como archivo estático minificado
- **Infra:** Docker Compose (web, db, frontend)
- **Async:** empezar síncrono; dejar preparado para Celery + Redis si el volumen lo requiere

---

# PARTE 2: PROMPT PARA CLAUDE CODE

Copiá todo lo que sigue y pasáselo a Claude Code junto con este archivo.

---

```
Quiero que construyas una plataforma de analítica web self-hosted, tipo Amplitude
simplificado, que voy a instalar en mis propios sitios mediante un snippet de JS.

Usá como especificación completa el archivo prompt-claude-code-analytics.md que te
adjunto — contiene el esquema de base de datos, los endpoints y el detalle de
funcionalidades. Seguilo como fuente de verdad.

## Stack
- Backend: Django 5 + Django REST Framework + PostgreSQL
- Frontend: React + Vite + Recharts + TailwindCSS
- SDK de tracking: JavaScript vanilla sin dependencias
- Todo levantable con Docker Compose

## Lo más importante del proyecto
La funcionalidad central NO son dashboards fijos, es un CONSTRUCTOR DE ANÁLISIS:
el usuario elige un tipo de análisis, un evento, aplica filtros por propiedades,
elige agrupación/breakdown, ve el resultado en vivo, y lo guarda con un nombre.
Los análisis guardados se persisten como configuración JSON en la tabla
SavedAnalysis y se pueden re-ejecutar sobre cualquier rango de fechas.

Todo el diseño del backend debe girar en torno a poder traducir esa configuración
JSON a una query eficiente sobre la tabla Event.

## Orden de trabajo

### Fase 1 — Backend base
1. Proyecto Django con apps: `sites`, `tracking`, `analytics`.
2. Modelos según el esquema del doc: Site, Visitor, Session, Event, SavedAnalysis,
   Dashboard. Con todos los índices indicados (incluido el GIN sobre properties).
3. Migrations.
4. Django Admin configurado para los modelos, para poder inspeccionar datos.
5. Endpoint POST /api/track/ y /api/track/batch/:
   - Validar api_key contra el modelo Site.
   - Validar que el Origin de la request coincida con el domain del Site.
   - Crear/actualizar Visitor y Session automáticamente (get_or_create).
   - Derivar device_type del User-Agent y country de la IP.
   - Guardar el Event.
   - Responder 204 rápido, sin bloquear.
6. Configurar django-cors-headers permitiendo los dominios registrados en Site.

### Fase 2 — Motor de análisis (la parte crítica)
Creá un módulo `analytics/engine/` con un query builder que reciba una config
JSON y devuelva datos listos para graficar.

- `filters.py`: traduce el array de filtros a un Q object de Django. Debe soportar
  filtrar por campos del Event, por claves dentro del JSONField properties
  (notación "properties.xxx" → properties__xxx), y por campos de la Session
  relacionada. Operadores: equals, not_equals, contains, not_contains, gt, gte,
  lt, lte, is_set, is_not_set, in.
- `trend.py`: agrupa por día/semana/mes con TruncDate/TruncWeek/TruncMonth,
  soporta measure = count | unique_visitors | unique_sessions, y breakdown_by
  opcional (devuelve una serie por cada valor del breakdown).
- `funnel.py`: dados N pasos, calcula cuántos visitantes únicos hicieron el paso 1,
  y de esos cuántos hicieron el paso 2 DESPUÉS en el tiempo y dentro de la ventana
  de conversión, y así sucesivamente. Devolvé conteo absoluto y % de conversión
  entre pasos y total.
- `retention.py`: cohortes por día/semana. Para cada cohorte (visitantes cuyo
  primer start_event cae en ese período), calcular qué % volvió a hacer el
  return_event en cada período posterior. Devolver matriz para heatmap.
- `breakdown.py`: agrupa por una propiedad y devuelve ranking ordenado.
- `metric.py`: un solo número, con comparación opcional contra el período
  anterior equivalente.

IMPORTANTE: escribí tests unitarios para el motor de análisis con datos
sintéticos. Es la parte con más riesgo de bugs sutiles (sobre todo funnel
y retention) y donde los errores son silenciosos.

### Fase 3 — API de consulta
7. POST /api/analysis/run/ — ejecuta una config sin guardarla (para el preview
   en vivo del constructor).
8. CRUD completo de SavedAnalysis (/api/analyses/).
9. GET /api/analyses/{id}/run/ — ejecuta un análisis guardado.
10. GET /api/events/names/ — nombres de eventos distintos registrados.
11. GET /api/events/properties/?event_name=X — claves disponibles dentro de
    properties para ese evento, con una muestra de valores posibles. Esto
    alimenta los selectores del constructor de filtros, así que debe ser
    razonablemente rápido (limitá el sampling).
12. GET /api/overview/ — visitantes únicos, sesiones, pageviews, tasa de rebote,
    duración media de sesión, para un rango de fechas.
13. Autenticación de admin (session auth de Django alcanza) para todos los
    endpoints de consulta. Los de ingesta van con api_key.

### Fase 4 — SDK de tracking
Un archivo `analytics.js` standalone, sin dependencias, que se instale así:

  <script src="https://mi-backend.com/static/analytics.js" data-api-key="abc123"></script>

Debe hacer, todo automáticamente:
- Generar y persistir un visitor_id (UUID) en localStorage.
- Manejar session_id con expiración de 30 minutos de inactividad.
- Capturar atribución (referrer + todos los utm_*) en el primer pageview de la
  sesión, guardarla en sessionStorage, y adjuntarla a todos los eventos de esa
  sesión.
- Disparar automáticamente: page_view, session_start, scroll_depth (25/50/75/100),
  time_on_page, bounce (<10s sin interacción), rage_click (3+ clicks mismo
  elemento en <1s), outbound_click, form_submit.
- Auto-detectar elementos <video> y trackear video_play, video_progress
  (25/50/75%), video_complete.
- Soportar tracking declarativo por atributos HTML:
    <a data-track="whatsapp_click" data-track-location="header">
  Todo atributo data-track-* se convierte en una propiedad del evento.
- Exponer API programática: analytics.track(name, props).
- Batching: acumular eventos en memoria y enviarlos cada 5 segundos o cada 10
  eventos, lo que ocurra primero.
- Usar navigator.sendBeacon() para eventos de salida (outbound_click,
  time_on_page, beforeunload) para que no se pierdan cuando el usuario navega
  fuera. fetch() para el resto.
- Cola de reintentos si falla el envío.
- Soportar SPAs: detectar cambios de ruta vía history.pushState y disparar
  page_view.
- Respetar navigator.doNotTrack.
- Que el script entero pese menos de 10kb minificado.

### Fase 5 — Frontend
14. App React + Vite + Tailwind, con las 4 vistas descriptas en el doc:
    Overview, Constructor de análisis, Análisis guardados, Explorador en vivo.
15. El Constructor es la vista más importante. Requisitos:
    - Panel de config a la izquierda, preview del gráfico a la derecha.
    - Los selectores de evento y de propiedades se pueblan dinámicamente desde
      la API, nunca hardcodeados.
    - El constructor de filtros permite agregar/quitar condiciones, y el selector
      de operadores se adapta al tipo de dato de la propiedad.
    - El preview se actualiza solo, con debounce de ~500ms, llamando a
      /api/analysis/run/.
    - Botón de guardar que pide nombre y persiste en SavedAnalysis.
    - Si abrís un análisis guardado para editar, el constructor se pre-puebla
      con su config.
16. Selector de rango de fechas global, con presets (hoy, últimos 7 días,
    últimos 30 días, este mes, personalizado).
17. Gráficos con Recharts: línea, embudo, heatmap de cohortes, barras
    horizontales, número grande con delta vs período anterior.
18. Página de instalación que le muestre al usuario el snippet <script> listo
    para copiar, con su api_key ya insertada, más ejemplos de uso del atributo
    data-track.

### Fase 6 — Infra y cierre
19. Docker Compose: postgres, django, frontend. Variables de entorno en .env.example.
20. Management command `seed_demo_data` que genere eventos sintéticos realistas
    (varios días, varias fuentes de tráfico, un funnel con caída natural entre
    pasos) para poder probar el dashboard sin tener tráfico real.
21. README con: cómo levantarlo, cómo crear un Site y obtener la api_key, cómo
    instalar el snippet en una web, y cómo crear el primer análisis.

## Criterios
- Priorizá que funcione end-to-end antes que optimizar performance.
- El motor de análisis tiene que ser extensible: agregar un nuevo tipo de
  análisis no debería requerir tocar los tipos existentes.
- Nada de queries N+1 en los endpoints de consulta; usá select_related /
  prefetch_related y agregaciones en la base, no en Python.
- Escribí tests para el motor de análisis. El resto puede ir sin tests por ahora.
- Si algo del spec te parece mal diseñado o hay una forma más simple de
  resolverlo, decímelo antes de implementarlo en vez de seguir el doc a ciegas.

Arrancá por la Fase 1 y pará cuando la termines para que yo revise antes de
seguir con la Fase 2.
```
