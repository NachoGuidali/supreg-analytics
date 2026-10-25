import uuid

from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from accounts.access import get_site, has_role, role_for_client, roles_by_client, sites_for
from accounts.models import Role
from accounts.scoped import SiteScopedViewSet

from .models import TrackingRule
from .serializers import SiteSerializer, TrackingRuleSerializer, TrackingSettingsSerializer
from .setup import setup_status


class SiteViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                  mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """GET/POST /api/sites/, GET/PUT/PATCH /api/sites/{id}/.

    Lista los sitios de los clientes del usuario (todos, para la plataforma). Crear y
    modificar requiere ser dueño del cliente. Filtro opcional: ?client_id=.

    Sin DELETE: borrar un sitio borra en cascada todos sus eventos. Eso queda en el admin.
    """

    serializer_class = SiteSerializer

    def get_queryset(self):
        queryset = sites_for(self.request.user).select_related("client")
        client_id = self.request.query_params.get("client_id")
        if client_id:
            try:
                queryset = queryset.filter(client_id=uuid.UUID(client_id))
            except ValueError:
                raise ValidationError({"client_id": "No es un UUID válido."}) from None
        return queryset

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "roles": roles_by_client(self.request.user)}

    def perform_update(self, serializer):
        if not has_role(role_for_client(self.request.user, serializer.instance.client_id), Role.OWNER):
            raise PermissionDenied("Sólo un dueño del cliente puede modificar el sitio.")
        serializer.save()

    @action(detail=True, methods=["get", "patch"])
    def tracking(self, request, pk=None):
        """GET/PATCH /api/sites/{id}/tracking/ — qué captura el script solo. Editar: editor o más."""
        site = get_site(request.user, pk, Role.EDITOR if request.method == "PATCH" else Role.VIEWER)
        serializer = TrackingSettingsSerializer(site, data=request.data, partial=True)
        if request.method == "PATCH":
            serializer.is_valid(raise_exception=True)
            serializer.save()
        return Response(TrackingSettingsSerializer(site).data)

    @action(detail=True, methods=["get"])
    def setup(self, request, pk=None):
        """GET /api/sites/{id}/setup/ — pasos de puesta en marcha y estado de la instalación."""
        return Response(setup_status(get_site(request.user, pk)))


class TrackingRuleViewSet(SiteScopedViewSet):
    """/api/tracking-rules/?site_id= — eventos sin código."""

    model = TrackingRule
    serializer_class = TrackingRuleSerializer
