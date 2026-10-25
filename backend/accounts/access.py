"""Control de acceso multi-tenant. Toda consulta de la API pasa por acá.

- Superusuario: administrador de la plataforma. Ve y gestiona todos los clientes.
- Resto: accede a los sitios de los clientes activos (y al día, si el bloqueo por vencimiento
  está activado; ver accounts.billing) donde tiene una membresía,
  con los permisos de su rol (lector < editor < dueño).

Un sitio ajeno se responde como inexistente (404), para no revelar que existe.
"""

import uuid

from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from sites.models import Site

from .billing import usable_clients_q
from .models import ROLE_RANK, Client, Membership, Role, roles_at_least


def is_platform_admin(user):
    return bool(user and user.is_authenticated and user.is_superuser)


def active_memberships(user):
    return Membership.objects.filter(usable_clients_q("client__"), user=user)


def has_dashboard_access(user):
    if not (user and user.is_authenticated and user.is_active):
        return False
    return is_platform_admin(user) or active_memberships(user).exists()


def clients_for(user, min_role=Role.VIEWER):
    if is_platform_admin(user):
        return Client.objects.all()
    return Client.objects.filter(
        usable_clients_q(), memberships__user=user, memberships__role__in=roles_at_least(min_role)
    ).distinct()


def sites_for(user, min_role=Role.VIEWER):
    if is_platform_admin(user):
        return Site.objects.all()
    return Site.objects.filter(
        usable_clients_q("client__"),
        client__memberships__user=user,
        client__memberships__role__in=roles_at_least(min_role),
    ).distinct()


def roles_by_client(user):
    """{client_id: rol} para las membresías activas del usuario (una query)."""
    return dict(active_memberships(user).values_list("client_id", "role"))


def role_for_client(user, client_id):
    if is_platform_admin(user):
        return Role.OWNER
    return roles_by_client(user).get(client_id)


def has_role(role, min_role):
    return role is not None and ROLE_RANK[role] >= ROLE_RANK[min_role]


def get_site(user, site_id, min_role=Role.VIEWER):
    """Sitio por id si el usuario tiene al menos `min_role` en su cliente.

    Sin acceso de lectura -> 404. Con lectura pero sin el rol pedido -> 403.
    """
    if not site_id:
        raise ValidationError({"site_id": "Es obligatorio."})
    try:
        site_uuid = uuid.UUID(str(site_id))
    except ValueError:
        raise ValidationError({"site_id": "No es un UUID válido."}) from None
    site = sites_for(user).filter(pk=site_uuid).first()
    if site is None:
        raise NotFound("Sitio inexistente.")
    if not has_role(role_for_client(user, site.client_id), min_role):
        raise PermissionDenied("Tu rol no permite esta acción.")
    return site
