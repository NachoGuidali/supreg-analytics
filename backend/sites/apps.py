from django.apps import AppConfig


class SitesConfig(AppConfig):
    name = "sites"
    verbose_name = "Sitios"

    def ready(self):
        from corsheaders.signals import check_request_enabled
        from django.db.models.signals import post_delete, post_save

        from .config import invalidate_site_config
        from .cors import cors_allow_registered_sites, invalidate_allowed_domains
        from .models import Site, TrackingRule

        check_request_enabled.connect(cors_allow_registered_sites, dispatch_uid="sites_cors")
        post_save.connect(invalidate_allowed_domains, sender=Site, dispatch_uid="sites_cors_save")
        post_delete.connect(invalidate_allowed_domains, sender=Site, dispatch_uid="sites_cors_delete")
        for model in (Site, TrackingRule):
            post_save.connect(invalidate_site_config, sender=model, dispatch_uid=f"trackcfg_save_{model.__name__}")
            post_delete.connect(invalidate_site_config, sender=model, dispatch_uid=f"trackcfg_delete_{model.__name__}")
