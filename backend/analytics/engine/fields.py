"""Resolución de nombres de campo de la config a expresiones del ORM sobre Event.

- "event_name", "page"                    -> columnas de Event
- "referrer", "utm_*", "landing_page", ... -> columnas de la Session relacionada
- "device_type", "country"                -> columnas del Visitor relacionado
- "properties.a" / "properties.a.b"       -> claves dentro del JSONField properties

Las claves JSON se arman como expresiones (KeyTransform) y no como kwargs
"properties__xxx": así una propiedad llamada "contains" o "gt" no se confunde
con un lookup de Django.
"""

import re
from dataclasses import dataclass

from django.core.exceptions import ValidationError
from django.db.models import Case, F, FloatField, Value, When
from django.db.models.fields.json import KeyTextTransform, KeyTransform
from django.db.models.functions import Cast
from django.db.models.lookups import Regex

from tracking.models import Event, Session, Visitor

from .errors import ConfigError

PROPERTY_PREFIX = "properties."
_PROPERTY_KEY_RE = re.compile(r"^[A-Za-z0-9_\-]{1,100}$")
# Sólo textos que Postgres puede castear a double precision sin error ni overflow.
NUMERIC_TEXT_RE = r"^\s*-?[0-9]{1,15}(\.[0-9]{1,15})?\s*$"

# nombre en la config -> (ruta ORM desde Event, modelo dueño, tipo de dato)
COLUMN_FIELDS = {
    "event_name": ("event_name", Event, "string"),
    "page": ("page", Event, "string"),
    "referrer": ("session__referrer", Session, "string"),
    "utm_source": ("session__utm_source", Session, "string"),
    "utm_medium": ("session__utm_medium", Session, "string"),
    "utm_campaign": ("session__utm_campaign", Session, "string"),
    "utm_content": ("session__utm_content", Session, "string"),
    "utm_term": ("session__utm_term", Session, "string"),
    "landing_page": ("session__landing_page", Session, "string"),
    "is_bounce": ("session__is_bounce", Session, "boolean"),
    "device_type": ("visitor__device_type", Visitor, "string"),
    "country": ("visitor__country", Visitor, "string"),
}


@dataclass(frozen=True, eq=False)
class Field:
    name: str
    orm_path: str | None = None
    json_keys: tuple[str, ...] = ()
    data_type: str = "unknown"  # properties: el tipo real depende de cada fila
    model_field: object = None

    @property
    def is_property(self):
        return bool(self.json_keys)

    def text_expression(self):
        """Valor como texto (properties: ->> ; JSON null y clave ausente dan NULL)."""
        if not self.is_property:
            return F(self.orm_path)
        lhs = "properties"
        for key in self.json_keys[:-1]:
            lhs = KeyTransform(key, lhs)
        return KeyTextTransform(self.json_keys[-1], lhs)

    def numeric_expression(self):
        """Property como número; NULL si no es numérica (nunca rompe la query)."""
        return Case(
            When(Regex(self.text_expression(), NUMERIC_TEXT_RE), then=Cast(self.text_expression(), FloatField())),
            default=Value(None),
            output_field=FloatField(),
        )

    def group_expression(self):
        return self.text_expression()

    def containment(self, value):
        """{"a": {"b": value}} para properties @> ... (usa el índice GIN)."""
        for key in reversed(self.json_keys):
            value = {key: value}
        return value

    def to_python(self, value):
        if self.data_type == "boolean" and isinstance(value, str):
            # Django acepta "True"/"t"/"1" pero no "true", que es lo que manda un JSON.
            value = {"true": True, "false": False}.get(value.strip().lower(), value)
        try:
            return self.model_field.to_python(value)
        except ValidationError as exc:
            raise ConfigError(f"Valor inválido para '{self.name}': {value!r}.") from exc


def resolve_field(name):
    if not isinstance(name, str) or not name:
        raise ConfigError("Falta el nombre del campo ('property').")

    if name.startswith(PROPERTY_PREFIX):
        keys = tuple(name[len(PROPERTY_PREFIX):].split("."))
        if not all(_PROPERTY_KEY_RE.match(key) for key in keys):
            raise ConfigError(f"Nombre de propiedad inválido: '{name}'.")
        return Field(name=name, json_keys=keys)

    if name in COLUMN_FIELDS:
        orm_path, model, data_type = COLUMN_FIELDS[name]
        model_field = model._meta.get_field(orm_path.rsplit("__", 1)[-1])
        return Field(name=name, orm_path=orm_path, data_type=data_type, model_field=model_field)

    raise ConfigError(
        f"Campo desconocido: '{name}'. Usá uno de {', '.join(COLUMN_FIELDS)} "
        f"o 'properties.<clave>' para propiedades del evento."
    )
