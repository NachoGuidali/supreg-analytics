"""Medidas y agrupaciones compartidas por trend, breakdown y metric."""

from django.db.models import Count, Q

MEASURES = {
    "count": lambda **kwargs: Count("id", **kwargs),
    "unique_visitors": lambda **kwargs: Count("visitor_id", distinct=True, **kwargs),
    "unique_sessions": lambda **kwargs: Count("session_id", distinct=True, **kwargs),
}

NONE_LABEL = "(none)"


def top_values(queryset, field, measure, limit):
    """[(valor_crudo, medida), ...] ordenado de mayor a menor."""
    rows = (
        queryset.annotate(breakdown=field.group_expression())
        .values("breakdown")
        .annotate(value=measure())
        .order_by("-value", "breakdown")[:limit]
    )
    return [(row["breakdown"], row["value"]) for row in rows]


def breakdown_in(values):
    """Q sobre la anotación 'breakdown' que también contempla el valor NULL."""
    present = [value for value in values if value is not None]
    q = Q(breakdown__in=present)
    if len(present) != len(values):
        q |= Q(breakdown__isnull=True)
    return q


def format_value(value):
    if value is None:
        return NONE_LABEL
    if isinstance(value, bool):
        return str(value).lower()
    return str(value)


def percent(part, whole):
    return round(part * 100 / whole, 2) if whole else 0.0
