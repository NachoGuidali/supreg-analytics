"""Configuración de captura de cada sitio: qué registra el SDK solo y qué reglas sin código aplica.

El SDK la baja de GET /api/track/config/ al cargar (ver tracking.views.TrackingConfigView), así
los cambios del dashboard llegan a la web sin tocar el snippet.
"""

import re

from django.core.exceptions import ValidationError

# Captura automática. page_view y session_start no se pueden apagar: sin ellos no hay visitas.
AUTO_EVENTS = {
    "scroll_depth": "Profundidad de scroll",
    "time_on_page": "Tiempo en la página",
    "bounce": "Rebotes",
    "click": "Clicks en botones y links",
    "rage_click": "Clicks de frustración",
    "outbound_click": "Clicks a otros sitios",
    "file_download": "Descargas de archivos",
    "form_submit": "Envío de formularios",
    "video": "Reproducción de videos",
}

DEFAULT_SCROLL_MARKS = [25, 50, 75, 100]
MAX_EXCLUDED_PATHS = 50


def default_tracking():
    return {"auto": {key: True for key in AUTO_EVENTS}, "scroll_marks": list(DEFAULT_SCROLL_MARKS), "excluded_paths": []}


def normalize_tracking(value):
    """Completa con los valores por defecto y valida. Lanza ValidationError con un mensaje legible."""
    if value in (None, ""):
        value = {}
    if not isinstance(value, dict):
        raise ValidationError("La configuración de captura tiene que ser un objeto.")
    result = default_tracking()

    auto = value.get("auto", {})
    if not isinstance(auto, dict):
        raise ValidationError("'auto' tiene que ser un objeto.")
    for key, enabled in auto.items():
        if key not in AUTO_EVENTS:
            raise ValidationError(f"Captura automática desconocida: '{key}'.")
        if not isinstance(enabled, bool):
            raise ValidationError(f"'{key}' tiene que ser verdadero o falso.")
        result["auto"][key] = enabled

    marks = value.get("scroll_marks", DEFAULT_SCROLL_MARKS)
    if (not isinstance(marks, list) or not marks or len(marks) > 10
            or not all(isinstance(m, int) and not isinstance(m, bool) and 1 <= m <= 100 for m in marks)):
        raise ValidationError("Los cortes de scroll tienen que ser entre 1 y 10 porcentajes del 1 al 100.")
    result["scroll_marks"] = sorted(set(marks))

    paths = value.get("excluded_paths", [])
    if not isinstance(paths, list) or len(paths) > MAX_EXCLUDED_PATHS:
        raise ValidationError(f"Hasta {MAX_EXCLUDED_PATHS} rutas excluidas.")
    clean = []
    for path in paths:
        if not isinstance(path, str) or not path.strip().startswith("/") or len(path) > 200:
            raise ValidationError("Cada ruta excluida tiene que empezar con / (podés terminarla con * para incluir subrutas).")
        clean.append(path.strip())
    result["excluded_paths"] = clean
    return result


EVENT_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,99}$")
# Nombres que ya genera el SDK: una regla no puede pisarlos y mezclar datos.
RESERVED_EVENTS = {"page_view", "session_start", "video_play", "video_progress", "video_complete", *AUTO_EVENTS}


def validate_event_name(value):
    if not EVENT_NAME_RE.match(value or ""):
        raise ValidationError("Usá minúsculas, números y guiones bajos, empezando con una letra (ej: click_whatsapp).")
    if value in RESERVED_EVENTS:
        raise ValidationError(f"'{value}' ya lo registra el script automáticamente. Elegí otro nombre.")
