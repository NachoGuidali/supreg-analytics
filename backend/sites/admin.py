from django.contrib import admin, messages
from django.utils.html import format_html

from .models import Site, generate_api_key


@admin.register(Site)
class SiteAdmin(admin.ModelAdmin):
    list_display = ("name", "domain", "client", "timezone", "api_key", "created_at")
    list_filter = ("client",)
    list_select_related = ("client",)
    search_fields = ("name", "domain", "client__name")
    readonly_fields = ("id", "api_key", "snippet", "created_at")
    fields = ("id", "client", "name", "domain", "timezone", "api_key", "snippet", "created_at")
    actions = ["regenerate_api_key"]

    @admin.display(description="Snippet de instalación")
    def snippet(self, obj):
        if not obj.pk:
            return "Se genera al guardar."
        return format_html(
            "<code>&lt;script src=\"https://TU-BACKEND/static/analytics.js\" "
            "data-api-key=\"{}\" defer&gt;&lt;/script&gt;</code>",
            obj.api_key,
        )

    @admin.action(description="Regenerar api_key (el snippet viejo deja de funcionar)")
    def regenerate_api_key(self, request, queryset):
        for site in queryset:
            site.api_key = generate_api_key()
            site.save(update_fields=["api_key"])
        self.message_user(request, f"api_key regenerada para {queryset.count()} sitio(s).", messages.WARNING)
