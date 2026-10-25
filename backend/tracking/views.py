import logging

from django.conf import settings
from rest_framework import status
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.billing import usable_clients_q
from sites.config import cached_public_config
from sites.models import Site

from .request_info import country_from_request, device_type_from_user_agent, is_bot
from .serializers import EventPayloadSerializer
from .services.ingest import ingest_events

logger = logging.getLogger(__name__)


class PlainTextJSONParser(JSONParser):
    """El SDK manda JSON como text/plain: es un content-type 'simple', así que
    fetch no dispara preflight CORS y sendBeacon no tiene restricciones."""

    media_type = "text/plain"


class IngestView(APIView):
    authentication_classes = []  # autenticación por api_key; sin sesión ni CSRF
    permission_classes = [AllowAny]
    parser_classes = [JSONParser, PlainTextJSONParser]

    def post(self, request):
        if not isinstance(request.data, dict):
            return Response({"detail": "Se esperaba un objeto JSON."}, status=status.HTTP_400_BAD_REQUEST)

        site, error = self.authorize(request)
        if error:
            return error

        user_agent = request.headers.get("User-Agent", "")
        if is_bot(user_agent):
            return Response(status=status.HTTP_204_NO_CONTENT)

        payloads, error = self.validate_payloads(request.data)
        if error:
            return error

        ingest_events(
            site,
            payloads,
            device_type=device_type_from_user_agent(user_agent),
            country=country_from_request(request),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    def authorize(self, request):
        api_key = request.data.get("api_key")
        site = (
            # Los sitios de un cliente suspendido (o bloqueado por falta de pago) dejan de recibir eventos.
            Site.objects.filter(usable_clients_q("client__"), api_key=api_key).only("id", "domain").first()
            if isinstance(api_key, str) else None
        )
        if site is None:
            return None, Response({"detail": "api_key inválida."}, status=status.HTTP_401_UNAUTHORIZED)

        origin = request.headers.get("Origin")
        if origin is None and not settings.TRACKING["REQUIRE_ORIGIN"]:
            return site, None
        if not site.allows_origin(origin):
            return None, Response(
                {"detail": f"Origin '{origin}' no coincide con el dominio del sitio."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return site, None

    def validate_payloads(self, data):
        raise NotImplementedError


class TrackView(IngestView):
    def validate_payloads(self, data):
        serializer = EventPayloadSerializer(data=data)
        if not serializer.is_valid():
            return None, Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        return [serializer.validated_data], None


class TrackBatchView(IngestView):
    def validate_payloads(self, data):
        events = data.get("events")
        max_size = settings.TRACKING["MAX_BATCH_SIZE"]
        if not isinstance(events, list) or not events:
            return None, Response({"detail": "'events' debe ser una lista no vacía."}, status=status.HTTP_400_BAD_REQUEST)
        if len(events) > max_size:
            return None, Response({"detail": f"Máximo {max_size} eventos por batch."}, status=status.HTTP_400_BAD_REQUEST)

        # Un evento inválido no tira el batch entero: si no, el SDK reintentaría
        # para siempre un lote que nunca va a entrar.
        valid, errors = [], {}
        for index, raw in enumerate(events):
            serializer = EventPayloadSerializer(data=raw)
            if serializer.is_valid():
                valid.append(serializer.validated_data)
            else:
                errors[index] = serializer.errors

        if not valid:
            return None, Response({"detail": "Ningún evento válido.", "errors": errors}, status=status.HTTP_400_BAD_REQUEST)
        if errors:
            logger.warning("Batch con %d evento(s) descartado(s): %s", len(errors), errors)
        return valid, None


class TrackingConfigView(APIView):
    """GET /api/track/config/?key=API_KEY — lo que el SDK tiene que capturar en este sitio.

    Público como el snippet. El SDK la guarda unos minutos en localStorage, así una
    página nueva arranca con la última conocida sin esperar la red.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        api_key = request.query_params.get("key", "")
        site = Site.objects.filter(usable_clients_q("client__"), api_key=api_key).first() if api_key else None
        if site is None:
            return Response({"detail": "api_key inválida."}, status=status.HTTP_404_NOT_FOUND)
        response = Response(cached_public_config(site))
        response["Cache-Control"] = "public, max-age=60"
        return response
