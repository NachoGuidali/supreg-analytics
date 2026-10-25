import uuid

from rest_framework import serializers

from accounts.access import sites_for
from accounts.models import Role
from sites.models import Site

from .engine import ConfigError, validate_config
from .models import Dashboard, EventDefinition, Goal, SavedAnalysis


class SavedAnalysisSerializer(serializers.ModelSerializer):
    site_id = serializers.PrimaryKeyRelatedField(source="site", queryset=Site.objects.none())

    class Meta:
        model = SavedAnalysis
        fields = [
            "id", "site_id", "name", "description", "analysis_type", "config",
            "is_pinned", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None:
            # Sólo se guardan análisis en sitios donde el usuario es editor o dueño.
            self.fields["site_id"].queryset = sites_for(request.user, Role.EDITOR)

    def validate(self, attrs):
        # En un PATCH puede llegar sólo uno de los dos: se valida contra lo guardado.
        instance = self.instance
        analysis_type = attrs.get("analysis_type", instance.analysis_type if instance else None)
        config = attrs.get("config", instance.config if instance else None)
        try:
            validate_config(analysis_type, config)
        except ConfigError as exc:
            raise serializers.ValidationError({"config": str(exc)}) from exc
        return attrs


class RunAnalysisSerializer(serializers.Serializer):
    site_id = serializers.UUIDField()
    analysis_type = serializers.CharField()
    config = serializers.JSONField()
    date_from = serializers.CharField(required=False, allow_blank=True)
    date_to = serializers.CharField(required=False, allow_blank=True)


class SiteBoundSerializer(serializers.ModelSerializer):
    """site_id escribible sólo en el alta y sólo hacia sitios donde el usuario es editor o dueño."""

    site_id = serializers.PrimaryKeyRelatedField(source="site", queryset=Site.objects.none())

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None:
            self.fields["site_id"].queryset = sites_for(request.user, Role.EDITOR)
        if self.instance is not None and not isinstance(self.instance, (list, tuple)) and hasattr(self.instance, "pk"):
            self.fields["site_id"].read_only = True


MAX_GOALS_PER_SITE = 30


class GoalSerializer(SiteBoundSerializer):
    class Meta:
        model = Goal
        fields = ["id", "site_id", "name", "event_name", "page_contains", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate(self, attrs):
        site = attrs.get("site")
        if self.instance is None and site and site.goals.count() >= MAX_GOALS_PER_SITE:
            raise serializers.ValidationError({"detail": f"Máximo {MAX_GOALS_PER_SITE} objetivos por sitio."})
        if "event_name" in attrs:
            attrs["event_name"] = attrs["event_name"].strip()
        return attrs


class EventDefinitionSerializer(SiteBoundSerializer):
    class Meta:
        model = EventDefinition
        fields = ["id", "site_id", "event_name", "label", "description", "is_hidden"]
        read_only_fields = ["id"]
        # El upsert lo resuelve la vista: sin el validador de unicidad automático.
        validators = []


DASHBOARD_WIDTHS = (4, 6, 8, 12)
MAX_WIDGETS = 40


class DashboardSerializer(SiteBoundSerializer):
    analyses = serializers.SerializerMethodField()

    class Meta:
        model = Dashboard
        fields = ["id", "site_id", "name", "description", "layout", "analyses", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_layout(self, layout):
        if not isinstance(layout, list) or len(layout) > MAX_WIDGETS:
            raise serializers.ValidationError(f"El dashboard admite hasta {MAX_WIDGETS} widgets.")
        clean = []
        for item in layout:
            if not isinstance(item, dict):
                raise serializers.ValidationError("Cada widget tiene que ser un objeto.")
            try:
                analysis_id = str(uuid.UUID(str(item.get("analysis_id"))))
            except ValueError:
                raise serializers.ValidationError("Cada widget necesita un 'analysis_id' válido.") from None
            width = item.get("width", 6)
            if width not in DASHBOARD_WIDTHS:
                raise serializers.ValidationError(f"El ancho tiene que ser uno de {DASHBOARD_WIDTHS}.")
            clean.append({"analysis_id": analysis_id, "width": width})
        return clean

    def validate(self, attrs):
        site = attrs.get("site") or (self.instance.site if self.instance else None)
        ids = {item["analysis_id"] for item in attrs.get("layout", [])}
        if ids and site:
            found = {str(pk) for pk in SavedAnalysis.objects.filter(site=site, pk__in=ids).values_list("pk", flat=True)}
            if ids - found:
                raise serializers.ValidationError({"layout": "Hay widgets con análisis de otro sitio o que no existen."})
        return attrs

    def get_analyses(self, dashboard):
        """Los análisis de los widgets, para dibujar el dashboard en una sola llamada."""
        ids = [item["analysis_id"] for item in dashboard.layout]
        analyses = SavedAnalysis.objects.filter(site_id=dashboard.site_id, pk__in=ids)
        return SavedAnalysisSerializer(analyses, many=True).data

    def to_representation(self, dashboard):
        data = super().to_representation(dashboard)
        existing = {a["id"] for a in data["analyses"]}
        # Un análisis borrado deja de mostrarse sin romper el dashboard.
        data["layout"] = [item for item in data["layout"] if item["analysis_id"] in existing]
        return data
