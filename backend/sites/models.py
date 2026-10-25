import secrets
import uuid
from urllib.parse import urlsplit
from zoneinfo import available_timezones

from django.core.exceptions import ValidationError
from django.db import models

from .tracking import default_tracking, normalize_tracking, validate_event_name


def generate_api_key():
    return secrets.token_hex(16)


def normalize_domain(value):
    """'https://www.MiSitio.com:443/x' -> 'misitio.com'. El puerto se ignora."""
    value = (value or "").strip().lower()
    if "://" not in value:
        value = "//" + value
    host = urlsplit(value).hostname or ""
    return host.removeprefix("www.")


def host_matches_domain(host, domain):
    """El host coincide con el dominio o es un subdominio suyo."""
    if not host or not domain:
        return False
    host = host.lower()
    return host == domain or host.endswith("." + domain)


def validate_timezone(value):
    if value not in available_timezones():
        raise ValidationError(f"Zona horaria desconocida: {value}")


class Site(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # PROTECT: borrar un cliente no puede llevarse en cascada sitios y eventos sin querer.
    client = models.ForeignKey("accounts.Client", on_delete=models.PROTECT, related_name="sites")
    name = models.CharField(max_length=100)
    domain = models.CharField(
        max_length=255,
        help_text="Dominio permitido, ej. 'misitio.com'. Incluye subdominios. "
        "Usá 'localhost' para pruebas locales.",
    )
    api_key = models.CharField(max_length=64, unique=True, default=generate_api_key, editable=False)
    timezone = models.CharField(
        max_length=64,
        default="America/Argentina/Buenos_Aires",
        validators=[validate_timezone],
        help_text="Zona horaria usada para agrupar por día/semana/mes.",
    )
    tracking = models.JSONField(default=default_tracking, blank=True, help_text="Captura automática y exclusiones (ver sites.tracking).")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.domain})"

    def save(self, *args, **kwargs):
        self.domain = normalize_domain(self.domain)
        self.tracking = normalize_tracking(self.tracking)
        super().save(*args, **kwargs)

    def allows_origin(self, origin):
        if not origin or origin == "null":
            return False
        return host_matches_domain(urlsplit(origin).hostname, self.domain)


class TrackingRule(models.Model):
    """Evento sin código: el SDK lo dispara cuando se cumple la condición en la web."""

    class Kind(models.TextChoices):
        CLICK = "click", "Click en un elemento"
        PAGEVIEW = "pageview", "Visita a una página"
        SCROLL = "scroll", "Scroll hasta un porcentaje"
        TIME = "time", "Tiempo en una página"
        FORM = "form", "Envío de un formulario"

    class UrlMatch(models.TextChoices):
        ANY = "any", "Cualquier página"
        EQUALS = "equals", "Es igual a"
        CONTAINS = "contains", "Contiene"
        STARTS_WITH = "starts_with", "Empieza con"
        REGEX = "regex", "Expresión regular"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name="tracking_rules")
    name = models.CharField(max_length=120, help_text="Nombre para mostrar, ej: 'Click en WhatsApp'.")
    event_name = models.CharField(max_length=100, validators=[validate_event_name])
    kind = models.CharField(max_length=10, choices=Kind.choices)
    selector = models.CharField(max_length=300, blank=True, default="", help_text="Selector CSS (click y formulario).")
    url_match = models.CharField(max_length=12, choices=UrlMatch.choices, default=UrlMatch.ANY)
    url_value = models.CharField(max_length=300, blank=True, default="")
    threshold = models.PositiveIntegerField(null=True, blank=True, help_text="Porcentaje (scroll) o segundos (tiempo).")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} → {self.event_name}"
