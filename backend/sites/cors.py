"""CORS dinámico: permite como origen cualquier dominio registrado en Site."""

from urllib.parse import urlsplit

from django.core.cache import cache

from .models import Site, host_matches_domain

DOMAINS_CACHE_KEY = "sites:allowed_domains"
DOMAINS_CACHE_TTL = 60


def allowed_domains():
    domains = cache.get(DOMAINS_CACHE_KEY)
    if domains is None:
        domains = list(Site.objects.values_list("domain", flat=True).distinct())
        cache.set(DOMAINS_CACHE_KEY, domains, DOMAINS_CACHE_TTL)
    return domains


def invalidate_allowed_domains(**kwargs):
    cache.delete(DOMAINS_CACHE_KEY)


def cors_allow_registered_sites(sender, request, **kwargs):
    # Sólo se invoca para URLs que matchean CORS_URLS_REGEX (la ingesta).
    origin = request.headers.get("Origin")
    if not origin or origin == "null":
        return False
    host = urlsplit(origin).hostname
    return any(host_matches_domain(host, domain) for domain in allowed_domains())
