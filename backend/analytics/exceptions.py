from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from .engine.errors import ConfigError


def api_exception_handler(exc, context):
    """Las configs inválidas del motor salen como 400 con un mensaje legible."""
    if isinstance(exc, ConfigError):
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return drf_exception_handler(exc, context)
