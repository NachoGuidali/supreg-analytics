from django.contrib import admin

from .models import Event, Session, Visitor


class ReadOnlyAdminMixin:
    """Los datos de tracking sólo los escribe la ingesta; el admin es para inspeccionar."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Visitor)
class VisitorAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ("visitor_id", "site", "device_type", "country", "first_utm_source", "first_seen_at", "last_seen_at")
    list_filter = ("site", "device_type", "country")
    search_fields = ("=visitor_id",)
    list_select_related = ("site",)
    date_hierarchy = "last_seen_at"
    ordering = ("-last_seen_at",)


@admin.register(Session)
class SessionAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = (
        "session_id", "site", "visitor", "started_at", "ended_at", "event_count",
        "is_bounce", "referrer", "utm_source", "utm_campaign", "landing_page",
    )
    list_filter = ("site", "is_bounce", "utm_source", "utm_medium")
    search_fields = ("=session_id", "=visitor__visitor_id")
    list_select_related = ("site", "visitor")
    date_hierarchy = "started_at"
    ordering = ("-started_at",)


@admin.register(Event)
class EventAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ("timestamp", "event_name", "page", "site", "visitor", "session", "received_at")
    list_filter = ("site",)
    search_fields = ("=event_name", "page", "=visitor__visitor_id", "=session__session_id")
    list_select_related = ("site", "visitor", "session")
    date_hierarchy = "timestamp"
    ordering = ("-timestamp",)
    show_full_result_count = False  # evita COUNT(*) sobre toda la tabla
    list_per_page = 50
