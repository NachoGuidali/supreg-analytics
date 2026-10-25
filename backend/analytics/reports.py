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


def channel_of(referrer, utm_source, utm_medium):
    """Clasificación simple y explicable, al estilo de los canales por defecto de GA."""
    medium = (utm_medium or "").lower()
    source = (utm_source or "").lower()
    if medium in PAID_MEDIUMS:
        return "paid"
    if medium in ("email", "e-mail", "newsletter") or source in ("newsletter", "email", "mailchimp"):
        return "email"
    if source:
        if _matches(source, SOCIAL) or source in ("ig", "fb", "facebook", "instagram", "tiktok", "linkedin", "twitter"):
            return "social"
        if _matches(source, SEARCH) or source in ("google", "bing"):
            return "organic_search"
        return "campaign"
    if not referrer:
        return "direct"
    if _matches(referrer, SEARCH):
        return "organic_search"
    if _matches(referrer, SOCIAL):
        return "social"
    return "referral"


def _sessions(site, date_range):
    return Session.objects.filter(site=site, started_at__gte=date_range.start, started_at__lt=date_range.end)


_DURATION = ExpressionWrapper(F("ended_at") - F("started_at"), output_field=DurationField())


def _session_stats(rows):
    """rows con sessions, bounces y duration (timedelta sumado) -> métricas legibles."""
    sessions = rows["sessions"]
    duration = rows.get("duration")
    return {
        "sessions": sessions,
        "bounce_rate": percent(rows["bounces"], sessions),
        "avg_duration_seconds": round(duration.total_seconds() / sessions, 1) if duration and sessions else 0.0,
    }


SESSION_AGGREGATES = {
    "sessions": Count("id"),
    "bounces": Count("id", filter=Q(is_bounce=True)),
    "duration": Sum(_DURATION),
}


def acquisition(site, date_range: DateRange):
    sessions = _sessions(site, date_range)

    by_origin = sessions.values("referrer", "utm_source", "utm_medium").annotate(**SESSION_AGGREGATES)
    channels = defaultdict(lambda: {"sessions": 0, "bounces": 0, "duration": timedelta(0)})
    sources = defaultdict(lambda: {"sessions": 0, "bounces": 0, "duration": timedelta(0), "channel": None})
    for row in by_origin:
        channel = channel_of(row["referrer"], row["utm_source"], row["utm_medium"])
        source = row["utm_source"] or row["referrer"] or "(directo)"
        for bucket in (channels[channel], sources[source]):
            bucket["sessions"] += row["sessions"]
            bucket["bounces"] += row["bounces"]
            bucket["duration"] += row["duration"] or timedelta(0)
        sources[source]["channel"] = channel

    total = sum(c["sessions"] for c in channels.values())
    channel_rows = sorted(
        ({"key": key, "label": CHANNELS[key], **_session_stats(value), "percent": percent(value["sessions"], total)}
         for key, value in channels.items()),
        key=lambda r: -r["sessions"],
    )
    source_rows = sorted(
        ({"source": key, "channel": CHANNELS[value["channel"]], **_session_stats(value)} for key, value in sources.items()),
        key=lambda r: -r["sessions"],
    )[:12]

    # Sesiones por día y canal: para el gráfico de evolución.
    daily = defaultdict(lambda: defaultdict(int))
    for row in (
        sessions.annotate(day=TruncDate("started_at", tzinfo=date_range.tz))
        .values("day", "referrer", "utm_source", "utm_medium")
        .annotate(n=Count("id"))
    ):
        daily[channel_of(row["referrer"], row["utm_source"], row["utm_medium"])][row["day"]] += row["n"]
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
        .values("utm_campaign", "utm_source", "utm_medium").annotate(**SESSION_AGGREGATES).order_by("-sessions")[:12]
    ]
    landing = [
        {"page": row["landing_page"] or "/", **_session_stats(row)}
        for row in sessions.values("landing_page").annotate(**SESSION_AGGREGATES).order_by("-sessions")[:12]
    ]
    return {"total_sessions": total, "channels": channel_rows, "trend": trend, "sources": source_rows,
            "campaigns": campaigns, "landing_pages": landing}


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
