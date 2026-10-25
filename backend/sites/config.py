"""Configuración pública que baja el SDK (sin datos sensibles: la api_key ya es pública)."""

from django.core.cache import cache

CACHE_TTL = 60


def cache_key(api_key):
    return f"trackcfg:{api_key}"


def public_config(site):
    """Formato compacto para el SDK: cada byte cuenta en cada carga de página."""
    rules = []
    for rule in site.tracking_rules.filter(is_active=True):
        item = {"e": rule.event_name, "k": rule.kind}
        if rule.selector:
            item["s"] = rule.selector
        if rule.url_match != "any":
            item["m"], item["v"] = rule.url_match, rule.url_value
        if rule.threshold is not None:
            item["t"] = rule.threshold
        rules.append(item)
    return {
        "auto": site.tracking["auto"],
        "scroll": site.tracking["scroll_marks"],
        "exclude": site.tracking["excluded_paths"],
        "rules": rules,
    }


def cached_public_config(site):
    key = cache_key(site.api_key)
    config = cache.get(key)
    if config is None:
        config = public_config(site)
        cache.set(key, config, CACHE_TTL)
    return config


def invalidate_site_config(sender, instance, **kwargs):
    site = getattr(instance, "site", instance)
    cache.delete(cache_key(site.api_key))
