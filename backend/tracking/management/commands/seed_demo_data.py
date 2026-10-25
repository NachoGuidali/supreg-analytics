"""Genera tráfico sintético realista para probar el dashboard sin un sitio real.

    python manage.py seed_demo_data                  # sitio "Demo" (localhost), 30 días
    python manage.py seed_demo_data --days 60 --visitors 3000 --reset

Incluye: varias fuentes de tráfico con distinta calidad, estacionalidad por hora y
día de la semana, crecimiento, visitantes que vuelven (para retención), rebotes,
scroll, un embudo producto -> scroll 50% -> whatsapp_click con caída natural,
formularios, videos, clicks en botones, descargas, rage clicks y links externos.
Si el sitio no tiene configuración propia, crea análisis guardados, un dashboard,
objetivos, eventos sin código y descripciones de eventos de ejemplo.
"""

import random
import uuid
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from analytics.models import Dashboard, EventDefinition, Goal, SavedAnalysis
from accounts.models import Client
from sites.models import Site, TrackingRule
from tracking.models import Event, Session, Visitor


@dataclass(frozen=True)
class Source:
    name: str
    weight: float
    attribution: dict
    landings: tuple
    bounce: float
    whatsapp: float  # probabilidad de click a WhatsApp en una página de producto bien scrolleada
    returns: float


SOURCES = [
    Source("google", 0.30, {"referrer": "google.com"}, ("/", "/blog/como-elegir-zapatillas", "/productos"), 0.38, 0.12, 0.30),
    Source("instagram", 0.25, {"referrer": "instagram.com", "utm_source": "instagram", "utm_medium": "social",
                               "utm_campaign": "primavera"}, ("/productos/zapatillas-urbanas", "/productos"), 0.30, 0.30, 0.35),
    Source("facebook", 0.15, {"referrer": "facebook.com", "utm_source": "facebook", "utm_medium": "cpc",
                              "utm_campaign": "promo-octubre", "utm_content": "carrusel"}, ("/productos/mochila-trekking", "/precios"), 0.52, 0.16, 0.18),
    Source("newsletter", 0.10, {"utm_source": "newsletter", "utm_medium": "email", "utm_campaign": "novedades"},
           ("/blog/como-elegir-zapatillas", "/productos/zapatillas-urbanas", "/demo"), 0.22, 0.22, 0.45),
    Source("direct", 0.20, {}, ("/", "/precios", "/contacto"), 0.33, 0.15, 0.40),
]
PAGES = {
    "/": "Inicio",
    "/productos": "Productos",
    "/productos/zapatillas-urbanas": "Zapatillas urbanas",
    "/productos/mochila-trekking": "Mochila trekking",
    "/precios": "Precios",
    "/contacto": "Contacto",
    "/blog/como-elegir-zapatillas": "Cómo elegir zapatillas",
    "/demo": "Video demo",
}
NEXT_PAGES = {
    "/": ["/productos", "/precios", "/blog/como-elegir-zapatillas", "/contacto"],
    "/productos": ["/productos/zapatillas-urbanas", "/productos/mochila-trekking", "/precios"],
    "/productos/zapatillas-urbanas": ["/productos/mochila-trekking", "/precios", "/contacto"],
    "/productos/mochila-trekking": ["/productos/zapatillas-urbanas", "/precios", "/contacto"],
    "/precios": ["/contacto", "/productos", "/demo"],
    "/contacto": ["/", "/productos"],
    "/blog/como-elegir-zapatillas": ["/productos/zapatillas-urbanas", "/productos", "/demo"],
    "/demo": ["/precios", "/productos"],
}
# Click en el menú o en un link interno que lleva a cada página.
NAV_CLICK = {
    path: {"text": title, "element": "a.nav-link" if path in ("/", "/productos", "/precios", "/contacto") else "a.card-link",
           "href": path}
    for path, title in PAGES.items()
}
DEVICES = [("mobile", 0.62), ("desktop", 0.33), ("tablet", 0.05)]
COUNTRIES = [("AR", 0.80), ("UY", 0.08), ("CL", 0.05), ("ES", 0.04), ("MX", 0.03)]
SCREEN = {"mobile": 390, "tablet": 820, "desktop": 1440}
HOUR_WEIGHTS = [1, 1, 1, 1, 1, 1, 2, 3, 5, 6, 7, 8, 9, 9, 7, 6, 6, 7, 8, 9, 10, 9, 6, 3]
WEEKDAY_WEIGHTS = [1.0, 1.05, 1.05, 1.0, 0.95, 0.75, 0.7]  # lunes..domingo

DEMO_ANALYSES = [
    ("Conversión a WhatsApp", "Visitantes que ven un producto, scrollean y escriben por WhatsApp.", "funnel", True, {
        "steps": [
            {"event_name": "page_view", "filters": [{"property": "page", "operator": "contains", "value": "/productos"}]},
            {"event_name": "scroll_depth", "filters": [{"property": "properties.depth_percent", "operator": "gte", "value": 50}]},
            {"event_name": "whatsapp_click", "filters": []},
        ],
        "conversion_window_hours": 24,
        "filters": [],
    }),
    ("Clicks a WhatsApp desde Instagram", "", "metric", True, {
        "event_name": "whatsapp_click", "measure": "unique_visitors", "compare_to_previous_period": True,
        "filters": [{"property": "utm_source", "operator": "equals", "value": "instagram"}],
    }),
    ("Clicks a WhatsApp por ubicación del botón", "", "breakdown", False, {
        "event_name": "whatsapp_click", "breakdown_by": "properties.location", "measure": "count", "limit": 10, "filters": [],
    }),
    ("Visitantes por fuente", "", "trend", False, {
        "event_name": "session_start", "measure": "unique_visitors", "group_by": "day",
        "breakdown_by": "utm_source", "breakdown_limit": 5, "filters": [],
    }),
    ("Retención semanal", "", "retention", False, {
        "start_event": "page_view", "return_event": "page_view", "period": "week", "periods_count": 4, "filters": [],
    }),
]


def weighted(rng, pairs):
    return rng.choices([p[0] for p in pairs], [p[1] for p in pairs])[0]


class Command(BaseCommand):
    help = "Genera eventos sintéticos realistas para un sitio de demo."

    def add_arguments(self, parser):
        parser.add_argument("--site-id", help="Sitio existente. Por defecto usa/crea 'Demo' con dominio localhost.")
        parser.add_argument("--days", type=int, default=30)
        parser.add_argument("--visitors", type=int, default=1500, help="Visitantes nuevos en todo el período.")
        parser.add_argument("--seed", type=int, default=42)
        parser.add_argument("--reset", action="store_true", help="Borra los datos de tracking del sitio antes de generar.")

    def handle(self, *args, **options):
        if options["days"] < 1 or options["visitors"] < 1:
            raise CommandError("--days y --visitors tienen que ser mayores a 0.")
        site = self.get_site(options["site_id"])
        rng = random.Random(options["seed"])

        with transaction.atomic():
            if options["reset"]:
                deleted, _ = Visitor.objects.filter(site=site).delete()
                self.stdout.write(f"Borrados {deleted} registros de tracking de {site.name}.")
            counts = self.generate(site, rng, options["days"], options["visitors"])
            created = self.create_demo_analyses(site)
            self.create_demo_setup(site)

        self.stdout.write(self.style.SUCCESS(
            f"{site.name} ({site.domain}): {counts['visitors']} visitantes, {counts['sessions']} sesiones, "
            f"{counts['events']} eventos en {options['days']} días. Análisis de ejemplo creados: {created}."
        ))
        self.stdout.write(f"api_key: {site.api_key}")

    def get_site(self, site_id):
        if site_id:
            site = Site.objects.filter(pk=site_id).first()
            if site is None:
                raise CommandError(f"No existe el sitio {site_id}.")
            return site
        site = Site.objects.filter(domain="localhost").first()
        if site is None:
            client, _ = Client.objects.get_or_create(name="Demo")
            site = Site.objects.create(domain="localhost", name="Demo", client=client)
        return site

    # --- generación ----------------------------------------------------------------

    def generate(self, site, rng, days, visitor_count):
        tz = ZoneInfo(site.timezone)
        now = timezone.now()
        today = now.astimezone(tz).date()
        first_day = today - timedelta(days=days - 1)
        # Crecimiento suave: los últimos días reciben más visitantes nuevos que los primeros.
        day_weights = [(1 + 0.8 * i / max(days - 1, 1)) * WEEKDAY_WEIGHTS[(first_day + timedelta(days=i)).weekday()] for i in range(days)]

        visitors, sessions, events = [], [], []
        for _ in range(visitor_count):
            source = rng.choices(SOURCES, [s.weight for s in SOURCES])[0]
            device = weighted(rng, DEVICES)
            day = first_day + timedelta(days=rng.choices(range(days), day_weights)[0])
            start = self.random_moment(rng, day, tz)
            if start >= now:
                continue

            visitor = Visitor(
                site=site, visitor_id=f"demo-{uuid.uuid4().hex}"  # único por corrida: se puede sumar tráfico sin --reset
                , first_seen_at=start, last_seen_at=start,
                first_referrer=source.attribution.get("referrer"), first_utm_source=source.attribution.get("utm_source"),
                first_utm_campaign=source.attribution.get("utm_campaign"), device_type=device, country=weighted(rng, COUNTRIES),
            )
            visitors.append(visitor)

            session_source, moment, return_chance = source, start, source.returns
            for number in range(8):
                session, session_events = self.build_session(rng, site, visitor, session_source, moment, number)
                sessions.append(session)
                events.extend(session_events)
                visitor.last_seen_at = session.ended_at
                if rng.random() > return_chance:
                    break
                return_chance *= 0.65
                moment = moment + timedelta(days=rng.choice([1, 1, 2, 3, 5, 7, 10, 14]), hours=rng.uniform(-6, 6))
                if moment >= now:
                    break
                # Las visitas que vuelven suelen ser directas o por newsletter.
                session_source = rng.choices([source, SOURCES[4], SOURCES[3]], [0.5, 0.35, 0.15])[0]

        Visitor.objects.bulk_create(visitors, batch_size=2000)
        Session.objects.bulk_create(sessions, batch_size=2000)
        Event.objects.bulk_create(events, batch_size=5000)
        return {"visitors": len(visitors), "sessions": len(sessions), "events": len(events)}

    def random_moment(self, rng, day, tz):
        hour = rng.choices(range(24), HOUR_WEIGHTS)[0]
        return datetime.combine(day, time(hour, rng.randrange(60), rng.randrange(60)), tzinfo=tz)

    def build_session(self, rng, site, visitor, source, start, number):
        session = Session(
            site=site, visitor=visitor, session_id=f"{visitor.visitor_id}-s{number}", started_at=start,
            landing_page=rng.choice(source.landings), **{key: source.attribution.get(key) for key in
                                                          ("referrer", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term")},
        )
        clock = [start]
        events = []

        def emit(name, page, after=0.0, **properties):
            """Agrega un evento `after` segundos después del anterior."""
            clock[0] += timedelta(seconds=after)
            events.append(Event(site=site, visitor=visitor, session=session, event_name=name, page=page,
                                timestamp=clock[0], properties=properties))

        page = session.landing_page
        emit("session_start", page, landing_page=page)
        emit("page_view", page, 0.3, title=PAGES[page], screen_width=SCREEN[visitor.device_type])
        if page == "/contacto":
            emit("visita_contacto", page, 0.1)

        # Rebote: se va rápido de la primera página. Los que vuelven rebotan menos.
        if rng.random() < source.bounce * (0.6 if number else 1):
            seconds = rng.randint(2, 9)
            emit("time_on_page", page, seconds, seconds=seconds)
            emit("bounce", page, 0, seconds=seconds)
            session.is_bounce = True
        else:
            for _ in range(rng.choices([1, 2, 3, 4, 5], [25, 30, 22, 13, 10])[0]):
                self.browse_page(rng, emit, page, source)
                next_page = rng.choice(NEXT_PAGES[page])
                seconds = rng.randint(15, 240)
                emit("time_on_page", page, seconds, seconds=seconds)
                emit("click", page, 0.2, **NAV_CLICK[next_page])
                page = next_page
                emit("page_view", page, 0.5, title=PAGES[page], screen_width=SCREEN[visitor.device_type])
                if page == "/contacto":
                    emit("visita_contacto", page, 0.1)
            self.browse_page(rng, emit, page, source)
            seconds = rng.randint(10, 180)
            emit("time_on_page", page, seconds, seconds=seconds)

        session.event_count = len(events)
        session.ended_at = clock[0]
        return session, events

    def browse_page(self, rng, emit, page, source):
        depth = 0
        for mark, probability in ((25, 0.85), (50, 0.65), (75, 0.45), (100, 0.28)):
            if rng.random() > probability:
                break
            depth = mark
            emit("scroll_depth", page, rng.uniform(3, 20), depth_percent=mark)

        if page.startswith("/productos") and depth >= 50 and rng.random() < source.whatsapp * 2.2:
            location = rng.choices(["boton_flotante", "ficha_producto", "header"], [0.5, 0.35, 0.15])[0]
            emit("click", page, rng.uniform(2, 30), text="Escribinos por WhatsApp", element="a.btn-whatsapp",
                 href="https://wa.me/5491100000000")
            emit("whatsapp_click", page, 0.05, location=location)
            emit("outbound_click", page, 0.1, target_url="https://wa.me/5491100000000")
        if page.startswith("/productos/") and rng.random() < 0.25:
            emit("click", page, rng.uniform(3, 25), text="Ver talles", element="button.talles")
        if page == "/precios" and rng.random() < 0.18:
            emit("click", page, rng.uniform(5, 30), text="Descargar lista de precios", element="a.descarga",
                 href="/archivos/lista-de-precios.pdf")
            emit("file_download", page, 0.1, file_url="/archivos/lista-de-precios.pdf", extension="pdf")
        if page == "/contacto" and rng.random() < 0.3:
            emit("form_submit", page, rng.uniform(20, 90), form_id="contacto")
        if page == "/precios" and rng.random() < 0.06:
            emit("click", page, rng.uniform(1, 10), text="Calcular cuotas", element="button#calcular-cuotas")
            emit("rage_click", page, 0.4, element="button#calcular-cuotas")
        if page == "/demo" and rng.random() < 0.65:
            emit("video_play", page, rng.uniform(2, 8), video_id="demo-producto", position_seconds=0)
            for percent, probability in ((25, 0.8), (50, 0.6), (75, 0.45)):
                if rng.random() > probability:
                    break
                emit("video_progress", page, 22, video_id="demo-producto", position_seconds=percent * 90 // 100, percent=percent)
            else:
                if rng.random() < 0.7:
                    emit("video_complete", page, 22, video_id="demo-producto", position_seconds=90)
        if rng.random() < 0.02:
            emit("outbound_click", page, rng.uniform(1, 20), target_url="https://instagram.com/demo")

    def create_demo_analyses(self, site):
        if site.saved_analyses.exists():
            return 0
        SavedAnalysis.objects.bulk_create(
            SavedAnalysis(site=site, name=name, description=description, analysis_type=kind, is_pinned=pinned, config=config)
            for name, description, kind, pinned, config in DEMO_ANALYSES
        )
        return len(DEMO_ANALYSES)

    def create_demo_setup(self, site):
        """Dashboard, objetivos, eventos sin código y catálogo de ejemplo (sólo si el sitio no tiene)."""
        if not site.goals.exists():
            Goal.objects.bulk_create([
                Goal(site=site, name="Contacto por WhatsApp", event_name="whatsapp_click"),
                Goal(site=site, name="Formulario de contacto", event_name="form_submit", page_contains="/contacto"),
                Goal(site=site, name="Descarga de la lista de precios", event_name="file_download"),
            ])
        if not site.tracking_rules.exists():
            TrackingRule.objects.bulk_create([
                TrackingRule(site=site, name="Click en WhatsApp", event_name="whatsapp_click", kind="click",
                             selector="a[href*='wa.me']"),
                TrackingRule(site=site, name="Llegó a contacto", event_name="visita_contacto", kind="pageview",
                             url_match="starts_with", url_value="/contacto"),
            ])
        if not site.event_definitions.exists():
            EventDefinition.objects.bulk_create([
                EventDefinition(site=site, event_name="whatsapp_click", label="Click en WhatsApp",
                                description="Botón de WhatsApp en fichas de producto, header o botón flotante."),
                EventDefinition(site=site, event_name="visita_contacto", label="Llegó a contacto",
                                description="Vista de la página /contacto (regla sin código)."),
            ])
        if not site.dashboards.exists():
            by_name = {a.name: a for a in site.saved_analyses.all()}
            widths = [("Clicks a WhatsApp desde Instagram", 4), ("Conversión a WhatsApp", 8),
                      ("Visitantes por fuente", 12), ("Clicks a WhatsApp por ubicación del botón", 6), ("Retención semanal", 6)]
            Dashboard.objects.create(
                site=site, name="Ventas por WhatsApp", description="Cómo llegan y cuántos terminan escribiendo.",
                layout=[{"analysis_id": str(by_name[n].id), "width": w} for n, w in widths if n in by_name],
            )
