"""Helpers para validar y normalizar configs de análisis."""

from .errors import ConfigError
from .fields import resolve_field
from .filters import build_filters


def _get(config, key, default):
    value = config.get(key)
    return default if value is None else value


def event_name(config, key="event_name"):
    value = config.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"'{key}' es obligatorio.")
    return value.strip()


def choice(config, key, options, default):
    value = _get(config, key, default)
    if value not in options:
        raise ConfigError(f"'{key}' debe ser uno de: {', '.join(options)}.")
    return value


def integer(config, key, default, minimum, maximum):
    value = _get(config, key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ConfigError(f"'{key}' debe ser un entero entre {minimum} y {maximum}.")
    return value


def boolean(config, key, default):
    value = _get(config, key, default)
    if not isinstance(value, bool):
        raise ConfigError(f"'{key}' debe ser true o false.")
    return value


def filters(config, key="filters"):
    return build_filters(config.get(key))


def field(config, key):
    if config.get(key) in (None, ""):
        raise ConfigError(f"'{key}' es obligatorio.")
    return resolve_field(config[key])


def optional_field(config, key):
    return None if config.get(key) in (None, "") else resolve_field(config[key])


def object_list(config, key, minimum, maximum):
    value = config.get(key)
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise ConfigError(f"'{key}' debe ser una lista de {minimum} a {maximum} elementos.")
    if not all(isinstance(item, dict) for item in value):
        raise ConfigError(f"Cada elemento de '{key}' debe ser un objeto.")
    return value
