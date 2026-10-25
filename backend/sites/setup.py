"""Puesta en marcha de un sitio: checklist de la guía de inicio y salud de la instalación."""

from datetime import timedelta

from django.db.models import Max
from django.utils import timezone

from tracking.models import Event


def setup_status(site):
    now = timezone.now()
    events = Event.objects.filter(site=site)
    last_event_at = events.aggregate(last=Max("timestamp"))["last"]
    events_24h = events.filter(timestamp__gte=now - timedelta(hours=24)).count() if last_event_at else 0
    team_size = site.client.memberships.count()

    steps = [
        {"key": "site", "title": "Registrar el sitio", "done": True, "link": "/instalacion"},
        {"key": "snippet", "title": "Pegar el snippet en la web", "done": last_event_at is not None, "link": "/instalacion"},
        {"key": "rule", "title": "Medir un click o una página sin código", "done": site.tracking_rules.exists(), "link": "/captura"},
        {"key": "goal", "title": "Definir un objetivo de conversión", "done": site.goals.exists(), "link": "/objetivos"},
        {"key": "analysis", "title": "Guardar un análisis", "done": site.saved_analyses.exists(), "link": "/constructor"},
        {"key": "dashboard", "title": "Armar un dashboard", "done": site.dashboards.exists(), "link": "/dashboards"},
        {"key": "team", "title": "Sumar a alguien del equipo", "done": team_size > 1, "link": "/equipo"},
    ]
    if last_event_at is None:
        health = "waiting"  # nunca llegó nada: falta instalar
    elif events_24h == 0:
        health = "stale"  # llegaba y dejó de llegar
    else:
        health = "ok"
    return {
        "health": health,
        "last_event_at": last_event_at,
        "events_24h": events_24h,
        "steps": steps,
        "done": sum(step["done"] for step in steps),
        "total": len(steps),
    }
