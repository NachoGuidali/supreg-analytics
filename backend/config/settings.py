import os
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name, default=""):
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-insecure-change-me")
DEBUG = env_bool("DJANGO_DEBUG", False)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")

if env_bool("DJANGO_BEHIND_HTTPS_PROXY"):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # La redirección http -> https y el HSTS los hace el proxy (Caddy); se declara igual para Django.
    SECURE_HSTS_SECONDS = int(os.environ.get("DJANGO_HSTS_SECONDS", "31536000"))
    SECURE_SSL_REDIRECT = False
    # Silenciados a propósito (manage.py check --deploy): el proxy redirige a https (W008), y el HSTS
    # no incluye subdominios ni preload (W005, W021) para no afectar otros sitios del mismo dominio.
    SILENCED_SYSTEM_CHECKS = ["security.W005", "security.W008", "security.W021"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "rest_framework",
    "corsheaders",
    # Nota: la app se llama "sites"; no instalar django.contrib.sites (mismo label).
    "accounts.apps.AccountsConfig",
    "sites.apps.SitesConfig",
    "tracking.apps.TrackingConfig",
    "analytics.apps.AnalyticsConfig",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",  # sirve /static/ (analytics.js) en producción
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": dj_database_url.config(
        default="postgres://analytics:analytics@localhost:5432/analytics",
        conn_max_age=60,
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "es-ar"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    # Sin hashes en el nombre: el snippet apunta siempre a /static/analytics.js.
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    # Consulta: superusuario o miembro de un cliente activo; el alcance por cliente lo
    # aplica accounts.access en cada endpoint. Los endpoints de ingesta lo sobreescriben.
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["accounts.permissions.HasDashboardAccess"],
    "EXCEPTION_HANDLER": "analytics.exceptions.api_exception_handler",
}

# Admin y dashboard no se embeben en iframes de otros sitios.
X_FRAME_OPTIONS = "DENY"

# CORS: sólo aplica a la ingesta. Los orígenes permitidos salen de Site.domain
# (ver sites.cors). CORS_ALLOWED_ORIGINS queda para orígenes fijos extra.
CORS_URLS_REGEX = r"^/api/track/.*$"
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = False

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

TRACKING = {
    "MAX_BATCH_SIZE": 100,
    "MAX_PROPERTIES_BYTES": 8 * 1024,
    # Rechazar requests de ingesta sin header Origin (curl, server-to-server).
    "REQUIRE_ORIGIN": env_bool("TRACKING_REQUIRE_ORIGIN", True),
    # Confiar en X-Forwarded-For / CF-IPCountry. Activar sólo detrás de un proxy propio.
    "TRUST_PROXY_HEADERS": env_bool("TRACKING_TRUST_PROXY_HEADERS", False),
    # Ruta a GeoLite2-Country.mmdb. Vacío = country queda en null.
    "GEOIP_PATH": os.environ.get("GEOIP_PATH", ""),
}

# Identidad visual del dashboard: una sola marca para todos los clientes de la plataforma.
BRAND = {
    "name": os.environ.get("BRAND_NAME", "").strip() or "SupReg Analytics",
    # Color de acento en hex (#RRGGBB). En modo claro el frontend lo oscurece hasta que sea legible.
    "color": os.environ.get("BRAND_COLOR", "").strip(),
    "logo_url": os.environ.get("BRAND_LOGO_URL", "").strip(),
    # system | light | dark: tema inicial si el usuario no eligió uno.
    "default_theme": os.environ.get("BRAND_DEFAULT_THEME", "system").strip() or "system",
}

# Venta del producto: el login muestra "Contratar" con este link. Hoy WhatsApp; cuando haya un
# checkout (Mercado Pago), se cambia SALES_URL por el link de pago sin tocar código.
SALES = {
    "url": os.environ.get("SALES_URL", "").strip(),
    "whatsapp": os.environ.get("SALES_WHATSAPP", "").strip(),  # número con código de país, sin + ni espacios
    "message": os.environ.get("SALES_MESSAGE", "Hola, quiero contratar SupReg Analytics").strip(),
    "product_url": os.environ.get("PRODUCT_URL", "").strip(),  # página del producto en el sitio
}

# Suscripciones (ver accounts.billing).
BILLING = {
    "warn_days": int(os.environ.get("BILLING_WARN_DAYS", "7")),
    "grace_days": int(os.environ.get("BILLING_GRACE_DAYS", "5")),
    # 1 = bloquear a los clientes vencidos hace más de grace_days. 0 = sólo avisar.
    "auto_block": env_bool("BILLING_AUTO_BLOCK", False),
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
