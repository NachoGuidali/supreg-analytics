"""Parámetros comunes de los endpoints de consulta: rango de fechas.

El sitio se resuelve con accounts.access.get_site, que aplica el acceso por cliente.
"""

from datetime import timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone
from .engine.dates import DateRange
from .engine.errors import ConfigError

DEFAULT_RANGE_DAYS = 30


def resolve_date_range(site, date_from, date_to):
    """Sin fechas: últimos 30 días (incluyendo hoy) en la zona horaria del sitio."""
    tz = ZoneInfo(site.timezone)
    if not date_from and not date_to:
        today = timezone.now().astimezone(tz).date()
        return DateRange(today - timedelta(days=DEFAULT_RANGE_DAYS - 1), today, tz)
    if not date_from or not date_to:
        raise ConfigError("Indicá 'date_from' y 'date_to' juntos, o ninguno de los dos.")
    return DateRange.parse(date_from, date_to, tz)


def change_percent(current, previous):
    if not previous:
        return None
    return round((current - previous) * 100 / previous, 2)
