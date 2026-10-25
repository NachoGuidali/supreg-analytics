"""Registro de tipos de análisis y punto de entrada del motor.

Para agregar un tipo nuevo: crear un módulo con una subclase de Analysis
decorada con @register e importarlo en engine/__init__.py. Los tipos
existentes no se tocan.
"""

from zoneinfo import ZoneInfo

from django.utils import timezone

from tracking.models import Event

from .dates import DateRange
from .errors import ConfigError

REGISTRY = {}


def register(cls):
    if not cls.analysis_type:
        raise TypeError(f"{cls.__name__} no define analysis_type.")
    if cls.analysis_type in REGISTRY:
        raise TypeError(f"El tipo '{cls.analysis_type}' ya está registrado.")
    REGISTRY[cls.analysis_type] = cls
    return cls


def get_analysis_class(analysis_type):
    try:
        return REGISTRY[analysis_type]
    except (KeyError, TypeError):
        raise ConfigError(
            f"Tipo de análisis desconocido: {analysis_type!r}. Opciones: {', '.join(sorted(REGISTRY))}."
        ) from None


class Analysis:
    analysis_type = ""

    def __init__(self, site, config, date_range, *, now=None):
        self.site = site
        self.date_range = date_range
        self.tz = date_range.tz
        self.now = now or timezone.now()
        self.config = self.clean_config(config)

    @classmethod
    def clean_config(cls, config):
        """Valida la config cruda y devuelve una versión normalizada. No toca la base."""
        raise NotImplementedError

    def run(self):
        """Devuelve un dict serializable a JSON, listo para graficar."""
        raise NotImplementedError

    def events(self, start=None, end=None):
        return Event.objects.filter(
            site=self.site,
            timestamp__gte=start or self.date_range.start,
            timestamp__lt=end or self.date_range.end,
        )


def _require_dict(config):
    if not isinstance(config, dict):
        raise ConfigError("'config' debe ser un objeto.")


def validate_config(analysis_type, config):
    """Para validar antes de guardar un SavedAnalysis. Lanza ConfigError."""
    cls = get_analysis_class(analysis_type)
    _require_dict(config)
    cls.clean_config(config)


def run_analysis(site, analysis_type, config, date_from, date_to, *, now=None):
    cls = get_analysis_class(analysis_type)
    _require_dict(config)
    date_range = DateRange.parse(date_from, date_to, ZoneInfo(site.timezone))
    data = cls(site, config, date_range, now=now).run()
    return {
        "analysis_type": analysis_type,
        "date_from": date_range.date_from.isoformat(),
        "date_to": date_range.date_to.isoformat(),
        "timezone": site.timezone,
        "data": data,
    }
