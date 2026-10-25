"""Datos sintéticos para los tests del motor.

Crea filas directo en la base (sin pasar por la ingesta) para controlar
timestamps exactos, incluso fuera de la ventana que acepta la ingesta.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from accounts.models import Client
from sites.models import Site
from tracking.models import Event, Session, Visitor

TZ = ZoneInfo("America/Argentina/Buenos_Aires")  # UTC-3, sin horario de verano
UTC = ZoneInfo("UTC")


def at(day, hour=12, minute=0, month=9, year=2026):
    """Fecha/hora local de Buenos Aires. 2026-09-01 es martes."""
    return datetime(year, month, day, hour, minute, tzinfo=TZ)


def make_site(**kwargs):
    kwargs.setdefault("name", "Test")
    kwargs.setdefault("domain", "test.com")
    if "client" not in kwargs:
        kwargs["client"] = Client.objects.create(name=f"Cliente de {kwargs['name']}")
    return Site.objects.create(**kwargs)


class Tracker:
    def __init__(self, site):
        self.site = site
        self._visitors = {}
        self._sessions = {}

    def event(self, visitor, name, timestamp, *, session=None, page="/", properties=None,
              device_type="desktop", country=None, **session_fields):
        """Registra un evento. Visitor y Session se crean la primera vez que aparecen;
        device_type/country y los campos de sesión sólo aplican en esa creación."""
        session = session or f"{visitor}-session"
        if visitor not in self._visitors:
            self._visitors[visitor] = Visitor.objects.create(
                site=self.site, visitor_id=visitor, first_seen_at=timestamp, last_seen_at=timestamp,
                device_type=device_type, country=country,
            )
        if session not in self._sessions:
            self._sessions[session] = Session.objects.create(
                site=self.site, visitor=self._visitors[visitor], session_id=session,
                started_at=timestamp, **session_fields,
            )
        return Event.objects.create(
            site=self.site, visitor=self._visitors[visitor], session=self._sessions[session],
            event_name=name, page=page, timestamp=timestamp, properties=properties or {},
        )
