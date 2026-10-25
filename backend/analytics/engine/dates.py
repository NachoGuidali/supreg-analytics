"""Rangos de fechas y períodos, siempre en la zona horaria del Site."""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from django.db.models import DateField
from django.db.models.functions import TruncDate, TruncMonth, TruncWeek

from .errors import ConfigError

MAX_RANGE_DAYS = 3 * 366
PERIODS = ("day", "week", "month")


@dataclass(frozen=True)
class DateRange:
    """Rango de fechas locales inclusivo: [date_from 00:00, date_to+1 00:00)."""

    date_from: date
    date_to: date
    tz: object

    @classmethod
    def parse(cls, date_from, date_to, tz):
        start = _parse_date(date_from, "date_from")
        end = _parse_date(date_to, "date_to")
        if end < start:
            raise ConfigError("'date_to' no puede ser anterior a 'date_from'.")
        if (end - start).days >= MAX_RANGE_DAYS:
            raise ConfigError(f"El rango máximo es de {MAX_RANGE_DAYS} días.")
        return cls(start, end, tz)

    @property
    def start(self):
        return datetime.combine(self.date_from, time.min, tzinfo=self.tz)

    @property
    def end(self):
        return datetime.combine(self.date_to + timedelta(days=1), time.min, tzinfo=self.tz)

    @property
    def days(self):
        return (self.date_to - self.date_from).days + 1

    def previous(self):
        """Período inmediatamente anterior de la misma cantidad de días."""
        return DateRange(self.date_from - timedelta(days=self.days), self.date_from - timedelta(days=1), self.tz)


def _parse_date(value, name):
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    raise ConfigError(f"'{name}' debe ser una fecha YYYY-MM-DD.")


def truncate_date(value, period):
    if period == "day":
        return value
    if period == "week":
        return value - timedelta(days=value.weekday())  # lunes, igual que date_trunc('week')
    if period == "month":
        return value.replace(day=1)
    raise ValueError(period)


def add_periods(value, period, count):
    if period == "day":
        return value + timedelta(days=count)
    if period == "week":
        return value + timedelta(weeks=count)
    if period == "month":
        month_index = value.year * 12 + value.month - 1 + count
        return value.replace(year=month_index // 12, month=month_index % 12 + 1, day=1)
    raise ValueError(period)


def period_starts(date_from, date_to, period):
    """Inicio de cada período que toca el rango (el primero puede empezar antes)."""
    current = truncate_date(date_from, period)
    starts = []
    while current <= date_to:
        starts.append(current)
        current = add_periods(current, period, 1)
    return starts


def trunc_expression(period, tz, field="timestamp"):
    """Expresión que devuelve la fecha local de inicio del período."""
    if period == "day":
        return TruncDate(field, tzinfo=tz)
    if period == "week":
        return TruncWeek(field, tzinfo=tz, output_field=DateField())
    if period == "month":
        return TruncMonth(field, tzinfo=tz, output_field=DateField())
    raise ValueError(period)
