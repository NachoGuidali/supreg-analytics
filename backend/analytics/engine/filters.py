"""Traduce el array de filtros de la config a un Q object sobre Event.

Todas las condiciones se combinan con AND. Semántica de nulos:
- not_equals / not_contains incluyen las filas donde el campo no existe o es NULL
  (ej. "utm_source distinto de instagram" incluye tráfico sin utm).
- is_set es falso para clave ausente, JSON null y string vacío.

Sobre properties los valores se comparan con tolerancia de tipo: "50" matchea 50
y "true" matchea true. Sin esto, un valor tipeado en el constructor contra un
número enviado por el SDK daría 0 resultados sin ningún error visible.
"""

import math
import re

from django.db.models import F, Q
from django.db.models.lookups import (
    Exact,
    GreaterThan,
    GreaterThanOrEqual,
    IContains,
    In,
    IsNull,
    LessThan,
    LessThanOrEqual,
)

from .errors import ConfigError
from .fields import NUMERIC_TEXT_RE, resolve_field

MAX_IN_VALUES = 100
_NUMERIC_RE = re.compile(NUMERIC_TEXT_RE)

# Qué operadores tienen sentido por tipo de dato (lo usa el constructor del frontend).
OPERATORS_BY_TYPE = {
    "string": ["equals", "not_equals", "contains", "not_contains", "in", "is_set", "is_not_set"],
    "number": ["equals", "not_equals", "gt", "gte", "lt", "lte", "in", "is_set", "is_not_set"],
    "boolean": ["equals", "not_equals", "is_set", "is_not_set"],
}


def build_filters(filters):
    if filters in (None, []):
        return Q()
    if not isinstance(filters, list):
        raise ConfigError("'filters' debe ser una lista.")
    q = Q()
    for index, condition in enumerate(filters, start=1):
        try:
            q &= build_condition(condition)
        except ConfigError as exc:
            raise ConfigError(f"Filtro {index}: {exc}") from exc
    return q


def build_condition(condition):
    if not isinstance(condition, dict):
        raise ConfigError("cada filtro debe ser un objeto {property, operator, value}.")
    field = resolve_field(condition.get("property"))
    operator = condition.get("operator")
    handler = OPERATORS.get(operator)
    if handler is None:
        raise ConfigError(f"operador desconocido: {operator!r}. Opciones: {', '.join(OPERATORS)}.")
    return handler(field, condition.get("value"))


# --- helpers -----------------------------------------------------------------


def _scalar(value):
    if value is None or isinstance(value, (dict, list)):
        raise ConfigError("el valor debe ser un texto, número o booleano.")
    return value


def _parse_number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else None
    if isinstance(value, str) and _NUMERIC_RE.match(value):
        number = float(value)
        return int(number) if number.is_integer() and "." not in value else number
    return None


def _json_variants(value):
    """Representaciones equivalentes de un valor para comparar contra JSON."""
    variants = [value]
    if isinstance(value, bool):
        variants.append(str(value).lower())
    elif isinstance(value, (int, float)):
        variants.append(str(int(value)) if float(value).is_integer() else str(value))
    elif isinstance(value, str):
        text = value.strip().lower()
        if text in {"true", "false"}:
            variants.append(text == "true")
        elif (number := _parse_number(value)) is not None:
            variants.append(number)
    return variants


def _require_column_type(field, *types):
    if not field.is_property and field.data_type not in types:
        raise ConfigError(f"el operador no aplica a '{field.name}' ({field.data_type}).")


def _is_null(field):
    return Q(IsNull(field.text_expression(), True))


def _negate(q, field):
    return ~q | _is_null(field)


# --- operadores --------------------------------------------------------------


def _equals(field, value):
    value = _scalar(value)
    if field.is_property:
        q = Q()
        for variant in _json_variants(value):
            q |= Q(properties__contains=field.containment(variant))
        return q
    return Q(Exact(F(field.orm_path), field.to_python(value)))


def _not_equals(field, value):
    return _negate(_equals(field, value), field)


def _contains(field, value):
    _require_column_type(field, "string")
    return Q(IContains(field.text_expression(), str(_scalar(value))))


def _not_contains(field, value):
    return _negate(_contains(field, value), field)


def _comparison(lookup):
    def build(field, value):
        if not field.is_property:
            raise ConfigError(f"'{field.name}' no es numérico.")
        number = _parse_number(_scalar(value))
        if number is None:
            raise ConfigError(f"se esperaba un número, llegó {value!r}.")
        return Q(lookup(field.numeric_expression(), float(number)))

    return build


def _is_set(field, value=None):
    q = Q(IsNull(field.text_expression(), False))
    if field.is_property or field.data_type == "string":
        q &= ~Q(Exact(field.text_expression(), ""))
    return q


def _is_not_set(field, value=None):
    return ~_is_set(field)


def _in(field, value):
    if not isinstance(value, list) or not value:
        raise ConfigError("'in' requiere una lista no vacía de valores.")
    if len(value) > MAX_IN_VALUES:
        raise ConfigError(f"'in' admite hasta {MAX_IN_VALUES} valores.")
    if field.is_property:
        q = Q()
        for item in value:
            q |= _equals(field, item)
        return q
    return Q(In(F(field.orm_path), [field.to_python(_scalar(item)) for item in value]))


OPERATORS = {
    "equals": _equals,
    "not_equals": _not_equals,
    "contains": _contains,
    "not_contains": _not_contains,
    "gt": _comparison(GreaterThan),
    "gte": _comparison(GreaterThanOrEqual),
    "lt": _comparison(LessThan),
    "lte": _comparison(LessThanOrEqual),
    "is_set": _is_set,
    "is_not_set": _is_not_set,
    "in": _in,
}
