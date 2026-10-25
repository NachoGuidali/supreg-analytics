from django.contrib import admin

from .models import Dashboard, SavedAnalysis


@admin.register(SavedAnalysis)
class SavedAnalysisAdmin(admin.ModelAdmin):
    list_display = ("name", "analysis_type", "site", "is_pinned", "updated_at")
    list_filter = ("site", "analysis_type", "is_pinned")
    search_fields = ("name", "description")
    list_select_related = ("site",)
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(Dashboard)
class DashboardAdmin(admin.ModelAdmin):
    list_display = ("name", "site", "updated_at")
    list_filter = ("site",)
    search_fields = ("name",)
    list_select_related = ("site",)
    readonly_fields = ("id", "created_at", "updated_at")
