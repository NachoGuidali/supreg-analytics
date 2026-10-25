import uuid

from django.db import models


class SavedAnalysis(models.Model):
    """Configuración de un reporte del constructor.

    `analysis_type` no usa choices a propósito: los tipos válidos los define el
    registro del motor (analytics/engine), así agregar un tipo nuevo no requiere
    una migración. La validación se hace en la API.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey("sites.Site", on_delete=models.CASCADE, related_name="saved_analyses")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    analysis_type = models.CharField(max_length=20, help_text="trend / funnel / retention / breakdown / metric")
    config = models.JSONField(default=dict)
    is_pinned = models.BooleanField(default=False, help_text="Aparece en el dashboard principal.")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "saved analysis"
        verbose_name_plural = "saved analyses"
        ordering = ["-is_pinned", "-updated_at"]
        indexes = [
            models.Index(fields=["site", "-updated_at"], name="analysis_site_updated_idx"),
        ]

    def __str__(self):
        return f"{self.name} [{self.analysis_type}]"


class Dashboard(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey("sites.Site", on_delete=models.CASCADE, related_name="dashboards")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    # Widgets en orden: [{"analysis_id": "<uuid>", "width": 6}, ...]; width en columnas de 12.
    layout = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Goal(models.Model):
    """Objetivo: un evento que cuenta como conversión (ej: whatsapp_click, compra)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey("sites.Site", on_delete=models.CASCADE, related_name="goals")
    name = models.CharField(max_length=120)
    event_name = models.CharField(max_length=100)
    # Opcional: sólo cuenta si el evento ocurrió en una página que contiene este texto.
    page_contains = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class EventDefinition(models.Model):
    """Nombre legible y descripción de un evento, para el catálogo y los selectores."""

    site = models.ForeignKey("sites.Site", on_delete=models.CASCADE, related_name="event_definitions")
    event_name = models.CharField(max_length=100)
    label = models.CharField(max_length=120, blank=True, default="")
    description = models.TextField(blank=True, default="")
    is_hidden = models.BooleanField(default=False, help_text="Ocultarlo de los selectores (sigue registrándose).")

    class Meta:
        ordering = ["event_name"]
        constraints = [models.UniqueConstraint(fields=["site", "event_name"], name="eventdef_site_name_uniq")]

    def __str__(self):
        return self.label or self.event_name
