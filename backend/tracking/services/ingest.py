"""Ingesta de eventos.

Un batch del SDK normalmente trae un solo visitor y una sola sesión, así que el
costo típico es fijo (5 queries) sin importar cuántos eventos traiga:
select visitors, update visitor, select sessions, update session, bulk insert events
(+ insert y re-select de visitor/session cuando son nuevos).
"""

from dataclasses import dataclass, field
from datetime import timedelta
from operator import attrgetter

from django.db import transaction
from django.db.models import F, Value
from django.db.models.functions import Coalesce, Greatest, Least
from django.utils import timezone

from tracking.models import Event, Session, Visitor

ATTRIBUTION_FIELDS = ("referrer", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term")
FIELD_MAX_LENGTH = {"referrer": 255, "landing_page": 500}
DEFAULT_MAX_LENGTH = 100

# Relojes de cliente desfasados: más allá de esto se usa la hora del servidor.
MAX_FUTURE_SKEW = timedelta(minutes=5)
MAX_PAST_AGE = timedelta(days=3)


@dataclass
class PreparedEvent:
    visitor_id: str
    session_id: str
    event_name: str
    page: str
    timestamp: object
    properties: dict
    attribution: dict = field(default_factory=dict)
    landing_page: str | None = None


def _truncate(key, value):
    return str(value)[: FIELD_MAX_LENGTH.get(key, DEFAULT_MAX_LENGTH)]


def _clamp_timestamp(ts, now):
    if ts is None or ts > now + MAX_FUTURE_SKEW or ts < now - MAX_PAST_AGE:
        return now
    return ts


def prepare_event(data, now):
    """Separa lo que va a Session (atribución) de lo que queda en Event.properties."""
    properties = dict(data.get("properties") or {})
    attribution = {}
    for key in ATTRIBUTION_FIELDS:
        value = properties.pop(key, None)
        if value not in (None, ""):
            attribution[key] = _truncate(key, value)

    landing_page = properties.pop("landing_page", None)
    properties.pop("device_type", None)  # se deriva del User-Agent en el servidor
    property_page = properties.pop("page", None)
    page = data.get("page") or (str(property_page) if property_page else "")

    return PreparedEvent(
        visitor_id=data["visitor_id"],
        session_id=data["session_id"],
        event_name=data["event_name"],
        page=page[:500],
        timestamp=_clamp_timestamp(data.get("timestamp"), now),
        properties=properties,
        attribution=attribution,
        landing_page=_truncate("landing_page", landing_page) if landing_page else None,
    )


def _first_attribution(events):
    return next((e.attribution for e in events if e.attribution), {})


def _group_by(events, key):
    groups = {}
    for event in events:
        groups.setdefault(getattr(event, key), []).append(event)
    return groups


def _upsert_visitors(site, by_visitor, device_type, country):
    ids = list(by_visitor)
    visitors = {v.visitor_id: v for v in Visitor.objects.filter(site=site, visitor_id__in=ids)}
    existing_ids = set(visitors)

    missing = [vid for vid in ids if vid not in visitors]
    if missing:
        new_visitors = []
        for vid in missing:
            events = by_visitor[vid]
            attribution = _first_attribution(events)
            new_visitors.append(
                Visitor(
                    site=site,
                    visitor_id=vid,
                    first_seen_at=events[0].timestamp,
                    last_seen_at=events[-1].timestamp,
                    first_referrer=attribution.get("referrer"),
                    first_utm_source=attribution.get("utm_source"),
                    first_utm_campaign=attribution.get("utm_campaign"),
                    device_type=device_type,
                    country=country,
                )
            )
        # ignore_conflicts cubre dos requests concurrentes del mismo visitor nuevo;
        # como no devuelve PKs, se vuelven a leer.
        Visitor.objects.bulk_create(new_visitors, ignore_conflicts=True)
        visitors.update({v.visitor_id: v for v in Visitor.objects.filter(site=site, visitor_id__in=missing)})

    for vid in existing_ids:
        events = by_visitor[vid]
        updates = {
            "first_seen_at": Least(F("first_seen_at"), Value(events[0].timestamp)),
            "last_seen_at": Greatest(F("last_seen_at"), Value(events[-1].timestamp)),
        }
        if country:
            updates["country"] = Coalesce(F("country"), Value(country))
        Visitor.objects.filter(pk=visitors[vid].pk).update(**updates)
    return visitors


def _upsert_sessions(site, by_session, visitors):
    ids = list(by_session)
    sessions = {s.session_id: s for s in Session.objects.filter(site=site, session_id__in=ids)}

    missing = [sid for sid in ids if sid not in sessions]
    if missing:
        new_sessions = []
        for sid in missing:
            events = by_session[sid]
            first = events[0]
            attribution = _first_attribution(events)
            landing_page = next((e.landing_page for e in events if e.landing_page), None) or first.page
            new_sessions.append(
                Session(
                    site=site,
                    visitor=visitors[first.visitor_id],
                    session_id=sid,
                    started_at=first.timestamp,
                    landing_page=landing_page,
                    **{key: attribution.get(key) for key in ATTRIBUTION_FIELDS},
                )
            )
        Session.objects.bulk_create(new_sessions, ignore_conflicts=True)
        sessions.update({s.session_id: s for s in Session.objects.filter(site=site, session_id__in=missing)})

    # Contadores siempre vía F() para ser correctos con requests concurrentes.
    for sid, events in by_session.items():
        updates = {
            "event_count": F("event_count") + len(events),
            "started_at": Least(F("started_at"), Value(events[0].timestamp)),
            "ended_at": Greatest(Coalesce(F("ended_at"), Value(events[-1].timestamp)), Value(events[-1].timestamp)),
        }
        bounce = _bounce_flag(events)
        if bounce is not None:
            updates["is_bounce"] = bounce
        Session.objects.filter(pk=sessions[sid].pk).update(**updates)
    return sessions


def _bounce_flag(events):
    """El SDK manda `bounce` al salir en <10s sin interacción.

    Si después llega otro page_view en la misma sesión, deja de ser rebote.
    None = el batch no cambia el estado.
    """
    for event in reversed(events):
        if event.event_name == "bounce":
            return True
        if event.event_name == "page_view":
            return False
    return None


@transaction.atomic
def ingest_events(site, payloads, *, device_type, country, now=None):
    now = now or timezone.now()
    events = sorted((prepare_event(p, now) for p in payloads), key=attrgetter("timestamp"))
    if not events:
        return 0

    visitors = _upsert_visitors(site, _group_by(events, "visitor_id"), device_type, country)
    sessions = _upsert_sessions(site, _group_by(events, "session_id"), visitors)

    Event.objects.bulk_create(
        Event(
            site=site,
            visitor=visitors[e.visitor_id],
            session=sessions[e.session_id],
            event_name=e.event_name,
            page=e.page,
            timestamp=e.timestamp,
            properties=e.properties,
        )
        for e in events
    )
    return len(events)
