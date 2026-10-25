from rest_framework.permissions import BasePermission

from .access import has_dashboard_access, is_platform_admin


class HasDashboardAccess(BasePermission):
    """Permiso por defecto de la API de consulta: superusuario o miembro de un cliente activo.

    El alcance de cada endpoint (qué sitios y con qué rol) lo resuelve accounts.access.
    """

    message = "El usuario no tiene acceso al dashboard."

    def has_permission(self, request, view):
        return has_dashboard_access(request.user)


class IsPlatformAdmin(BasePermission):
    message = "Sólo para administradores de la plataforma."

    def has_permission(self, request, view):
        return is_platform_admin(request.user)
