import re

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from accounts.access import clients_for, is_platform_admin, sites_for
from accounts.models import Client, Role

from .models import Site, TrackingRule
from .tracking import AUTO_EVENTS, normalize_tracking


class SiteSerializer(serializers.ModelSerializer):
    client_id = serializers.PrimaryKeyRelatedField(source="client", queryset=Client.objects.none(), required=False)
    client_name = serializers.CharField(source="client.name", read_only=True)
    role = serializers.SerializerMethodField()

    class Meta:
        model = Site
        fields = ["id", "client_id", "client_name", "name", "domain", "timezone", "api_key", "role", "created_at"]
        read_only_fields = ["id", "api_key", "created_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None:
            # Sólo se puede crear un sitio en un cliente donde se es dueño.
            self.fields["client_id"].queryset = clients_for(request.user, Role.OWNER)
        if self.instance is not None:
            # Mover un sitio de cliente se hace desde el admin.
            self.fields["client_id"].read_only = True

    def get_role(self, site):
        if is_platform_admin(self.context["request"].user):
            return Role.OWNER
        return self.context.get("roles", {}).get(site.client_id)

    def validate(self, attrs):
        if self.instance is None and "client" not in attrs:
            # Sin client_id: si el usuario es dueño de un único cliente, va ahí.
            owned = list(self.fields["client_id"].queryset[:2])
            if len(owned) != 1:
                raise serializers.ValidationError({"client_id": "Indicá en qué cliente crear el sitio."})
            attrs["client"] = owned[0]
        client = attrs.get("client")
        request = self.context.get("request")
        plan = client.plan if client and self.instance is None else None
        # La plataforma puede pasarse del límite (por ejemplo, mientras se cambia de plan).
        if plan and plan.max_sites is not None and not is_platform_admin(request.user):
            if client.sites.count() >= plan.max_sites:
                raise serializers.ValidationError({
                    "detail": f"Tu plan {plan.name} incluye {plan.max_sites} "
                              f"{'sitio' if plan.max_sites == 1 else 'sitios'}. Escribinos para ampliarlo."
                })
        return attrs


class TrackingSettingsSerializer(serializers.Serializer):
    """PATCH /api/sites/{id}/tracking/: captura automática, cortes de scroll y rutas excluidas."""

    auto = serializers.DictField(child=serializers.BooleanField(), required=False)
    scroll_marks = serializers.ListField(child=serializers.IntegerField(), required=False)
    excluded_paths = serializers.ListField(child=serializers.CharField(allow_blank=True), required=False)

    def validate(self, attrs):
        current = self.instance.tracking
        merged = {**current, **attrs, "auto": {**current["auto"], **attrs.get("auto", {})}}
        merged["excluded_paths"] = [p for p in merged.get("excluded_paths", []) if p.strip()]
        try:
            return normalize_tracking(merged)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"detail": exc.messages[0]}) from exc

    def update(self, instance, validated_data):
        instance.tracking = validated_data
        instance.save(update_fields=["tracking"])
        return instance

    def to_representation(self, instance):
        return {**instance.tracking, "auto_labels": AUTO_EVENTS}


MAX_RULES_PER_SITE = 100


class TrackingRuleSerializer(serializers.ModelSerializer):
    site_id = serializers.PrimaryKeyRelatedField(source="site", queryset=Site.objects.none())

    class Meta:
        model = TrackingRule
        fields = ["id", "site_id", "name", "event_name", "kind", "selector", "url_match", "url_value",
                  "threshold", "is_active", "created_at"]
        read_only_fields = ["id", "created_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None:
            self.fields["site_id"].queryset = sites_for(request.user, Role.EDITOR)
        if self.instance is not None and not isinstance(self.instance, list):
            self.fields["site_id"].read_only = True

    def validate(self, attrs):
        fields = ("site", "kind", "url_match", "url_value", "selector", "threshold")
        current = {f: getattr(self.instance, f) for f in fields} if self.instance else {}
        data = {**current, **attrs}
        kind, match, value = data.get("kind"), data.get("url_match", "any"), (data.get("url_value") or "").strip()
        selector, threshold = (data.get("selector") or "").strip(), data.get("threshold")
        errors = {}
        if kind == "click" and not selector:
            errors["selector"] = "Indicá qué elemento: un selector CSS como .btn-comprar o a[href*='wa.me']."
        if selector and (len(selector) > 300 or "<" in selector or "{" in selector):
            errors["selector"] = "No parece un selector CSS válido."
        if kind == "pageview" and match == "any":
            errors["url_match"] = "Elegí qué página dispara el evento."
        if match != "any" and not value:
            errors["url_value"] = "Completá la dirección o parte de ella (ej: /gracias)."
        if match == "regex" and value:
            try:
                re.compile(value)
            except re.error:
                errors["url_value"] = "La expresión regular no es válida."
        if kind == "scroll" and not (threshold and 1 <= threshold <= 100):
            errors["threshold"] = "Indicá un porcentaje de scroll entre 1 y 100."
        if kind == "time" and not (threshold and 1 <= threshold <= 3600):
            errors["threshold"] = "Indicá los segundos (entre 1 y 3600)."
        if errors:
            raise serializers.ValidationError(errors)
        attrs["selector"] = selector
        attrs["url_value"] = value if match != "any" else ""
        if kind in ("click", "pageview", "form"):
            attrs["threshold"] = None
        site = data.get("site")
        if self.instance is None and site and site.tracking_rules.count() >= MAX_RULES_PER_SITE:
            raise serializers.ValidationError({"detail": f"Máximo {MAX_RULES_PER_SITE} reglas por sitio."})
        return attrs
