from django.contrib import admin
from django.urls import include, path

from .auth_views import LoginView, LogoutView, MeView

urlpatterns = [
    path("admin/", admin.site.urls),
    # Ingesta (api_key)
    path("api/", include("tracking.urls")),
    # Consulta (sesión de un superusuario o de un miembro de un cliente)
    path("api/auth/me/", MeView.as_view(), name="auth-me"),
    path("api/auth/login/", LoginView.as_view(), name="auth-login"),
    path("api/auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("api/", include("accounts.urls")),
    path("api/", include("sites.urls")),
    path("api/", include("analytics.urls")),
]
