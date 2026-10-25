from rest_framework import viewsets

from .access import get_site, sites_for
from .models import Role

WRITE_ACTIONS = ("create", "update", "partial_update", "destroy")


class SiteScopedViewSet(viewsets.ModelViewSet):
    """CRUD de un modelo con FK `site`: lee cualquier rol, escribe `write_role` o más.

    Filtro ?site_id=. El alta valida el sitio en el serializer (queryset de sitios editables).
    """

    model = None
    write_role = Role.EDITOR

    def get_queryset(self):
        user = self.request.user
        queryset = self.model.objects.filter(site__in=sites_for(user))
        site_id = self.request.query_params.get("site_id")
        if site_id:
            queryset = queryset.filter(site=get_site(user, site_id))
        return queryset

    def get_object(self):
        obj = super().get_object()
        if self.action in WRITE_ACTIONS:
            get_site(self.request.user, obj.site_id, self.write_role)
        return obj
