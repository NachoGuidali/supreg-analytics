"""Reportes fijos tipo Google Analytics: adquisición, comportamiento y audiencia.

El constructor resuelve cualquier pregunta sobre un evento; estos reportes cruzan
sesiones, páginas y eventos de comportamiento de una forma que el motor genérico
no expresa (canales, alcance de scroll, mapa de horarios), siempre en pocas queries
agregadas en Postgres.
"""

from collections import defaultdict
from datetime import timedelta

from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Q, Sum
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import ExtractHour, ExtractIsoWeekDay, TruncDate

from tracking.models import Event, Session, Visitor

from sites.tracking import RESERVED_EVENTS

from .engine.aggregation import percent
from .engine.dates import DateRange
from .engine.fields import resolve_field

# --- canales -----------------------------------------------------------------------

SEARCH = ("google.", "bing.", "duckduckgo.", "yahoo.", "ecosia.", "yandex.", "baidu.")
SOCIAL = ("facebook.", "instagram.", "t.co", "twitter.", "x.com", "linkedin.", "lnkd.in", "tiktok.",
          "youtube.", "pinterest.", "reddit.", "whatsapp.", "wa.me", "threads.")
PAID_MEDIUMS = ("cpc", "ppc", "paid", "ads", "paid_social", "paidsocial", "display", "cpm")
# ad_click que sólo existe en clicks de anuncios. fbclid (meta) no: Facebook e Instagram
# lo agregan también a los links de publicaciones orgánicas.
PAID_CLICKS = {"google": "Google Ads", "microsoft": "Microsoft Ads", "tiktok": "TikTok Ads"}

CHANNELS = {
    "direct": "Directo",
    "organic_search": "Buscadores",
    "social": "Redes sociales",
    "paid": "Publicidad",
    "email": "Email",
    "campaign": "Otras campañas",
    "referral": "Otros sitios",
}


def _matches(host, needles):
    host = (host or "").lower()
    return any(needle in host for needle in needles)


def channel_of(referrer, utm_source, utm_medium, ad_click=None):
    """Clasificación simple y explicable, al estilo de los canales por defecto de GA."""
    medium = (utm_medium or "").lower()
    source = (utm_source or "").lower()
    if medium in PAID_MEDIUMS or ad_click in PAID_CLICKS:
        return "paid"
    if medium in ("email", "e-mail", "newsletter") or source in ("newsletter", "email", "mailchimp"):
        return "email"
    if source:
        if _matches(source, SOCIAL) or source in ("ig", "fb", "facebook", "instagram", "tiktok", "linkedin", "twitter"):
            return "social"
        if _matches(source, SEARCH) or source in ("google", "bing"):
            return "organic_search"
        return "campaign"
    if ad_click == "meta":
        return "social"
    if not referrer:
        return "direct"
    if _matches(referrer, SEARCH):
        return "organic_search"
    if _matches(referrer, SOCIAL):
        return "social"
    return "referral"


def source_of(referrer, utm_source, ad_click=None):
    """Nombre de la fuente: utm_source, la plataforma de anuncios o el sitio de origen."""
    return utm_source or PAID_CLICKS.get(ad_click) or referrer or ("Facebook / Instagram" if ad_click == "meta" else "(directo)")


ORIGIN_FIELDS = ("referrer", "utm_source", "utm_medium", "ad_click")


def channel_of_row(row, prefix=""):
    return channel_of(*(row[prefix + f] for f in ORIGIN_FIELDS))


def goal_events(goal):
    """Eventos que cumplen el objetivo, sin filtro de fechas."""
    queryset = Event.objects.filter(site_id=goal.site_id, event_name=goal.event_name)
    if goal.page_contains:
        queryset = queryset.filter(page__icontains=goal.page_contains)
    return queryset


def _sessions(site, date_range):
    return Session.objects.filter(site=site, started_at__gte=date_range.start, started_at__lt=date_range.end)


_DURATION = ExpressionWrapper(F("ended_at") - F("started_at"), output_field=DurationField())


def _session_stats(rows):
    """rows con sessions, bounces y duration (timedelta sumado) -> métricas legibles."""
    sessions = rows["sessions"]
    duration = rows.get("duration")
    stats = {
        "sessions": sessions,
        "bounce_rate": percent(rows["bounces"], sessions),
        "avg_duration_seconds": round(duration.total_seconds() / sessions, 1) if duration and sessions else 0.0,
    }
    if "conversions" in rows:
        stats["conversions"] = rows["conversions"]
        stats["conversion_rate"] = percent(rows["conversions"], sessions)
    return stats


SESSION_AGGREGATES = {
    "sessions": Count("id"),
    "bounces": Count("id", filter=Q(is_bounce=True)),
    "duration": Sum(_DURATION),
}


def session_aggregates(goal=None):
    """Con objetivo, también cuenta las sesiones que lo cumplieron (conversiones)."""
    if goal is None:
        return SESSION_AGGREGATES
    converted = goal_events(goal).values("session_id")
    return {**SESSION_AGGREGATES, "conversions": Count("id", filter=Q(id__in=converted))}


def _empty_bucket():
    return {"sessions": 0, "bounces": 0, "duration": timedelta(0), "conversions": 0}


def _add(bucket, row):
    bucket["sessions"] += row["sessions"]
    bucket["bounces"] += row["bounces"]
    bucket["duration"] += row["duration"] or timedelta(0)
    bucket["conversions"] += row.get("conversions", 0)


def _stats(bucket, goal):
    if goal is None:
        bucket = {k: v for k, v in bucket.items() if k != "conversions"}
    return _session_stats(bucket)


def acquisition(site, date_range: DateRange, goal=None):
    """Con `goal`, cada fila suma conversiones: sesiones en las que se cumplió el objetivo."""
    sessions = _sessions(site, date_range)
    aggregates = session_aggregates(goal)

    by_origin = sessions.values(*ORIGIN_FIELDS).annotate(**aggregates)
    channels = defaultdict(_empty_bucket)
    sources = defaultdict(lambda: {**_empty_bucket(), "channel": None})
    for row in by_origin:
        channel = channel_of_row(row)
        source = source_of(row["referrer"], row["utm_source"], row["ad_click"])
        _add(channels[channel], row)
        _add(sources[source], row)
        sources[source]["channel"] = channel

    total = sum(c["sessions"] for c in channels.values())
    channel_rows = sorted(
        ({"key": key, "label": CHANNELS[key], **_stats(value, goal), "percent": percent(value["sessions"], total)}
         for key, value in channels.items()),
        key=lambda r: -r["sessions"],
    )
    source_rows = sorted(
        ({"source": key, "channel": CHANNELS[value.pop("channel")], **_stats(value, goal)} for key, value in sources.items()),
        key=lambda r: -r["sessions"],
    )[:12]

    # Sesiones por día y canal: para el gráfico de evolución.
    daily = defaultdict(lambda: defaultdict(int))
    for row in (
        sessions.annotate(day=TruncDate("started_at", tzinfo=date_range.tz))
        .values("day", *ORIGIN_FIELDS)
        .annotate(n=Count("id"))
    ):
        daily[channel_of_row(row)][row["day"]] += row["n"]
    days = [date_range.date_from.fromordinal(date_range.date_from.toordinal() + i) for i in range(date_range.days)]
    ordered = [r["key"] for r in channel_rows]
    trend = {
        "group_by": "day",
        "labels": [d.isoformat() for d in days],
        "series": [{"key": key, "label": CHANNELS[key], "data": [daily[key].get(d, 0) for d in days]} for key in ordered],
    }

    campaigns = [
        {"campaign": row["utm_campaign"], "source": row["utm_source"] or "", "medium": row["utm_medium"] or "",
         **_session_stats(row)}
        for row in sessions.exclude(utm_campaign__isnull=True).exclude(utm_campaign="")
        .values("utm_campaign", "utm_source", "utm_medium").annotate(**aggregates).order_by("-sessions")[:20]
    ]
    landing = [
        {"page": row["landing_page"] or "/", **_session_stats(row)}
        for row in sessions.values("landing_page").annotate(**aggregates).order_by("-sessions")[:12]
    ]
    return {"total_sessions": total, "channels": channel_rows, "trend": trend, "sources": source_rows,
            "campaigns": campaigns, "landing_pages": landing}


def campaign_detail(site, date_range: DateRange, campaign, source=None, medium=None, goal=None):
    """Una campaña abierta por anuncio (utm_content), palabra clave (utm_term) y página de entrada."""
    sessions = _sessions(site, date_range).filter(utm_campaign=campaign)
    if source is not None:
        sessions = sessions.filter(utm_source=source or None)
    if medium is not None:
        sessions = sessions.filter(utm_medium=medium or None)
    aggregates = session_aggregates(goal)

    def breakdown(field, empty):
        return [
            {"value": row[field] or empty, **_session_stats(row)}
            for row in sessions.values(field).annotate(**aggregates).order_by("-sessions")[:15]
        ]

    totals = sessions.aggregate(**aggregates)
    days = [date_range.date_from.fromordinal(date_range.date_from.toordinal() + i) for i in range(date_range.days)]
    daily = dict(
        sessions.annotate(day=TruncDate("started_at", tzinfo=date_range.tz)).values("day")
        .annotate(n=Count("id")).values_list("day", "n")
    )
    return {
        "campaign": campaign,
        "totals": _session_stats(totals),
        "trend": {"group_by": "day", "labels": [d.isoformat() for d in days],
                  "series": [{"key": "sessions", "label": "Sesiones", "data": [daily.get(d, 0) for d in days]}]},
        "contents": breakdown("utm_content", "(sin utm_content)"),
        "terms": breakdown("utm_term", "(sin utm_term)"),
        "landing_pages": breakdown("landing_page", "/"),
    }


# --- comportamiento --------------------------------------------------------------------


def _number(key):
    """Property numérica; NULL si no lo es. CASE: Postgres no garantiza el orden de los AND."""
    return resolve_field(f"properties.{key}").numeric_expression()


def _events(site, date_range, page=None):
    queryset = Event.objects.filter(site=site, timestamp__gte=date_range.start, timestamp__lt=date_range.end)
    return queryset.filter(page=page) if page else queryset


def _prop(key):
    return KeyTextTransform(key, "properties")


TIME_BUCKETS = [(0, 10, "Menos de 10 s"), (10, 30, "10 a 30 s"), (30, 60, "30 s a 1 min"),
                (60, 180, "1 a 3 min"), (180, 600, "3 a 10 min"), (600, None, "Más de 10 min")]


def behavior(site, date_range: DateRange, page=None):
    events = _events(site, date_range, page)

    views = events.filter(event_name="page_view")
    page_rows = list(
        views.values("page").annotate(views=Count("id"), visitors=Count("visitor_id", distinct=True)).order_by("-views")[:20]
    )
    top_pages = [row["page"] for row in page_rows]
    times = dict(
        events.filter(event_name="time_on_page", page__in=top_pages)
        .values("page").annotate(avg=Avg(_number("seconds"))).values_list("page", "avg")
    )
    # Alcance: vistas (sesión + página) que llegaron al 50% de la página.
    reached_half = dict(
        events.filter(event_name="scroll_depth", page__in=top_pages)
        .annotate(depth=_number("depth_percent")).filter(depth__gte=50)
        .values("page").annotate(n=Count("session_id", distinct=True)).values_list("page", "n")
    )
    view_sessions = dict(
        views.filter(page__in=top_pages).values("page").annotate(n=Count("session_id", distinct=True)).values_list("page", "n")
    )
    pages = [
        {
            "page": row["page"] or "/",
            "views": row["views"],
            "visitors": row["visitors"],
            "avg_time_seconds": round(times[row["page"]], 1) if times.get(row["page"]) is not None else None,
            "scroll_50_rate": percent(reached_half.get(row["page"], 0), view_sessions.get(row["page"], 0)),
        }
        for row in page_rows
    ]

    # Alcance de scroll por corte configurado, sobre vistas únicas (sesión + página).
    viewed = views.values("session_id", "page").distinct().count()
    depth_events = events.filter(event_name="scroll_depth").annotate(depth=_number("depth_percent"))
    scroll = []
    for mark in site.tracking["scroll_marks"]:
        reached = depth_events.filter(depth__gte=mark).values("session_id", "page").distinct().count()
        scroll.append({"mark": mark, "views": reached, "percent": min(100.0, percent(reached, viewed))})

    time_rows = events.filter(event_name="time_on_page").annotate(s=_number("seconds")).filter(s__isnull=False)
    buckets = time_rows.aggregate(**{
        f"b{i}": Count("id", filter=Q(s__gte=low) & (Q(s__lt=high) if high is not None else Q()))
        for i, (low, high, _) in enumerate(TIME_BUCKETS)
    })
    time_total = sum(buckets.values())
    time_distribution = [
        {"label": label, "views": buckets[f"b{i}"], "percent": percent(buckets[f"b{i}"], time_total)}
        for i, (_, _, label) in enumerate(TIME_BUCKETS)
    ]

    def top(event_name, *keys, limit=12):
        rows = (
            events.filter(event_name=event_name)
            .annotate(**{k: _prop(k) for k in keys})
            .values(*keys)
            .annotate(count=Count("id"), visitors=Count("visitor_id", distinct=True))
            .order_by("-count")[:limit]
        )
        return [{**{k: row[k] or "" for k in keys}, "count": row["count"], "visitors": row["visitors"]} for row in rows]

    clicks = top("click", "text", "element", "href")
    rage = [
        {"page": row["page"] or "/", "element": row["element"] or "", "count": row["count"], "visitors": row["visitors"]}
        for row in events.filter(event_name="rage_click").annotate(element=_prop("element"))
        .values("page", "element").annotate(count=Count("id"), visitors=Count("visitor_id", distinct=True)).order_by("-count")[:10]
    ]
    custom = [
        {"event_name": row["event_name"], "count": row["count"], "visitors": row["visitors"]}
        for row in events.exclude(event_name__in=RESERVED_EVENTS)
        .values("event_name").annotate(count=Count("id"), visitors=Count("visitor_id", distinct=True)).order_by("-count")[:15]
    ]
    return {
        "page": page,
        "pages": pages,
        "page_views": viewed,
        "scroll": scroll,
        "time_distribution": time_distribution,
        "clicks": clicks,
        "outbound": top("outbound_click", "target_url"),
        "downloads": top("file_download", "file_url"),
        "forms": top("form_submit", "form_id"),
        "rage_clicks": rage,
        "custom_events": custom,
    }


# --- audiencia --------------------------------------------------------------------------


def audience(site, date_range: DateRange):
    sessions = _sessions(site, date_range)
    total = sessions.count()

    def share(rows, key):
        return [{"value": row[key] or "(sin dato)", "sessions": row["n"], "percent": percent(row["n"], total)} for row in rows]

    devices = share(sessions.values("visitor__device_type").annotate(n=Count("id")).order_by("-n"), "visitor__device_type")
    countries = share(sessions.values("visitor__country").annotate(n=Count("id")).order_by("-n")[:12], "visitor__country")

    visitor_ids = sessions.values("visitor_id").distinct()
    visitors = Visitor.objects.filter(pk__in=visitor_ids)
    new = visitors.filter(first_seen_at__gte=date_range.start).count()
    returning = visitors.filter(first_seen_at__lt=date_range.start).count()

    heat = [[0] * 24 for _ in range(7)]
    for row in (
        sessions.annotate(dow=ExtractIsoWeekDay("started_at", tzinfo=date_range.tz), hour=ExtractHour("started_at", tzinfo=date_range.tz))
        .values("dow", "hour").annotate(n=Count("id"))
    ):
        heat[row["dow"] - 1][row["hour"]] = row["n"]

    engagement = sessions.aggregate(events=Avg("event_count"))
    pageviews = _events(site, date_range).filter(event_name="page_view").count()
    return {
        "total_sessions": total,
        "devices": devices,
        "countries": countries,
        "new_visitors": new,
        "returning_visitors": returning,
        "heatmap": heat,  # [lunes..domingo][0..23]
        "pages_per_session": round(pageviews / total, 2) if total else 0.0,
        "events_per_session": round(engagement["events"] or 0, 1),
    }
