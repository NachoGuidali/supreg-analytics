import json
import re

from django.conf import settings
from rest_framework import serializers

_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def to_snake_case(value):
    """'WhatsApp Click' -> 'whatsapp_click'. Evita que el mismo evento se registre con dos nombres."""
    return _NON_ALNUM_RE.sub("_", value.strip().lower()).strip("_")


class EventPayloadSerializer(serializers.Serializer):
    event_name = serializers.CharField(max_length=200)
    visitor_id = serializers.CharField(max_length=64)
    session_id = serializers.CharField(max_length=64)
    timestamp = serializers.DateTimeField(required=False)
    page = serializers.CharField(required=False, allow_blank=True, default="")
    properties = serializers.DictField(required=False, default=dict)

    def validate_event_name(self, value):
        name = to_snake_case(value)[:100]
        if not name:
            raise serializers.ValidationError("event_name vacío después de normalizar.")
        return name

    def validate_page(self, value):
        return value[:500]

    def validate_properties(self, value):
        max_bytes = settings.TRACKING["MAX_PROPERTIES_BYTES"]
        if len(json.dumps(value, default=str)) > max_bytes:
            raise serializers.ValidationError(f"properties supera {max_bytes} bytes.")
        return value
