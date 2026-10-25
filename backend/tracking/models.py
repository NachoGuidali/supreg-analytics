import uuid

from django.contrib.postgres.indexes import GinIndex
from django.db import models


class DeviceType(models.TextChoices):
    MOBILE = "mobile", "Mobile"
    TABLET = "tablet", "Tablet"
    DESKTOP = "desktop", "Desktop"


class Visitor(models.Model):
    """Usuario anónimo, identificado por el UUID que el SDK guarda en localStorage."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey("sites.Site", on_delete=models.CASCADE, related_name="visitors")
    visitor_id = models.CharField(max_length=64)
    first_seen_at = models.DateTimeField()
    last_seen_at = models.DateTimeField()
    first_referrer = models.CharField(max_length=255, null=True, blank=True)
    first_utm_source = models.CharField(max_length=100, null=True, blank=True)
    first_utm_campaign = models.CharField(max_length=100, null=True, blank=True)
    device_type = models.CharField(max_length=20, choices=DeviceType.choices, default=DeviceType.DESKTOP)
    country = models.CharField(max_length=2, null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["site", "visitor_id"], name="visitor_site_visitor_id_uniq"),
        ]

    def __str__(self):
        return self.visitor_id


class Session(models.Model):
    """Sesión del SDK (30 min de inactividad). La atribución vive acá, no en Event."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey("sites.Site", on_delete=models.CASCADE, related_name="sessions")
    visitor = models.ForeignKey(Visitor, on_delete=models.CASCADE, related_name="sessions")
    session_id = models.CharField(max_length=64)
    started_at = models.DateTimeField()
    # Timestamp del último evento recibido; duración = ended_at - started_at.
    ended_at = models.DateTimeField(null=True, blank=True)
    referrer = models.CharField(max_length=255, null=True, blank=True)
    utm_source = models.CharField(max_length=100, null=True, blank=True)
    utm_medium = models.CharField(max_length=100, null=True, blank=True)
    utm_campaign = models.CharField(max_length=100, null=True, blank=True)
    utm_content = models.CharField(max_length=100, null=True, blank=True)
    utm_term = models.CharField(max_length=100, null=True, blank=True)
    landing_page = models.CharField(max_length=500, blank=True, default="")
    event_count = models.IntegerField(default=0)
    is_bounce = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["site", "session_id"], name="session_site_session_id_uniq"),
        ]
        indexes = [
            models.Index(fields=["site", "started_at"], name="session_site_started_idx"),
        ]

    def __str__(self):
        return self.session_id


class Event(models.Model):
    id = models.BigAutoField(primary_key=True)
    # site y visitor sin índice propio: ya los cubren los índices compuestos de abajo.
    site = models.ForeignKey("sites.Site", on_delete=models.CASCADE, related_name="events", db_index=False)
    visitor = models.ForeignKey(Visitor, on_delete=models.CASCADE, related_name="events", db_index=False)
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name="events")
    event_name = models.CharField(max_length=100)
    page = models.CharField(max_length=500, blank=True, default="")
    timestamp = models.DateTimeField(help_text="Timestamp del cliente (acotado a un rango razonable).")
    received_at = models.DateTimeField(auto_now_add=True)
    properties = models.JSONField(default=dict, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["site", "event_name", "timestamp"], name="event_site_name_ts_idx"),
            models.Index(fields=["site", "timestamp"], name="event_site_ts_idx"),
            models.Index(fields=["visitor", "timestamp"], name="event_visitor_ts_idx"),
            # jsonb_path_ops: más chico y rápido; sirve para containment (@>),
            # que es como el motor va a traducir los filtros "equals" sobre properties.
            GinIndex(fields=["properties"], name="event_properties_gin", opclasses=["jsonb_path_ops"]),
        ]

    def __str__(self):
        return f"{self.event_name} @ {self.timestamp:%Y-%m-%d %H:%M:%S}"
