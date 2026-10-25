"""Login por sesión de Django para el dashboard.

Entran los superusuarios (plataforma) y los miembros de algún cliente activo.

Flujo del frontend: GET /api/auth/me/ (deja la cookie csrftoken) -> POST
/api/auth/login/ con header X-CSRFToken -> el resto de la API usa la cookie de sesión.
"""

import re
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import billing
from accounts.access import active_memberships, has_dashboard_access, is_platform_admin
from accounts.models import Role


_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def brand():
    """Marca pública (también antes del login: la usa la pantalla de ingreso)."""
    config = settings.BRAND
    return {
        "name": config["name"],
        "color": config["color"] if _HEX_COLOR_RE.match(config["color"]) else None,
        "logo_url": config["logo_url"] or None,
        "default_theme": config["default_theme"] if config["default_theme"] in {"system", "light", "dark"} else "system",
    }


def whatsapp_url(message):
    number = settings.SALES["whatsapp"]
    return f"https://wa.me/{number}?text={quote(message)}" if number.isdigit() else None


def sales():
    """Links públicos para quien todavía no tiene cuenta: contratar y conocer el producto."""
    config = settings.SALES
    url = config["url"] or whatsapp_url(config["message"])
    return {"url": url or None, "product_url": config["product_url"] or None}


def _membership_payload(membership):
    client = membership.client
    data = {"client_id": str(client.id), "client_name": client.name, "role": membership.role}
    if membership.role == Role.OWNER:
        # Sólo los dueños ven el plan y el vencimiento (y el aviso para renovar).
        data["billing"] = {
            "plan_name": client.plan.name if client.plan else None,
            "paid_until": client.paid_until.isoformat() if client.paid_until else None,
            **billing.status(client),
            "renew_url": settings.SALES["url"] or whatsapp_url(f"Hola, quiero renovar SupReg Analytics para {client.name}"),
        }
    return data


def _user_payload(user):
    memberships = active_memberships(user).select_related("client__plan").order_by("client__name")
    return {
        "authenticated": True,
        "username": user.username,
        "email": user.email,
        "first_name": user.first_name,
        "is_platform_admin": is_platform_admin(user),
        "memberships": [_membership_payload(m) for m in memberships],
        "brand": brand(),
    }


@method_decorator(ensure_csrf_cookie, name="dispatch")
class MeView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        if not has_dashboard_access(request.user):
            # Incluye a quien perdió el acceso con la sesión abierta (cliente suspendido o quitado).
            return Response({"authenticated": False, "brand": brand(), "sales": sales()})
        return Response(_user_payload(request.user))


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        username = (request.data.get("username") or "").strip()
        password = request.data.get("password")
        user = authenticate(request, username=username, password=password)
        if user is None and "@" in username:
            # Usuarios cuyo username no es el email (por ejemplo, el superusuario inicial).
            match = get_user_model().objects.filter(email__iexact=username).first()
            if match is not None:
                user = authenticate(request, username=match.username, password=password)
        if user is None:
            return Response({"detail": "Usuario o contraseña incorrectos."}, status=status.HTTP_400_BAD_REQUEST)
        if not has_dashboard_access(user):
            detail = (
                "Tu cuenta está suspendida o vencida. Escribinos para reactivarla."
                if user.memberships.exists() else "El usuario no tiene acceso al dashboard."
            )
            return Response({"detail": detail}, status=status.HTTP_403_FORBIDDEN)
        login(request, user)
        return Response(_user_payload(user))


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)
