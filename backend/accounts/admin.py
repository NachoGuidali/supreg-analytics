from django.contrib import admin
from django.db.models import Count

from .models import Client, Membership, Payment, Plan


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 1
    autocomplete_fields = ("user",)


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ("name", "is_active", "plan", "paid_until", "site_count", "member_count", "created_at")
    list_filter = ("is_active", "plan")
    search_fields = ("name",)
    readonly_fields = ("id", "created_at")
    inlines = [MembershipInline]

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(
            _site_count=Count("sites", distinct=True), _member_count=Count("memberships", distinct=True)
        )

    @admin.display(description="Sitios", ordering="_site_count")
    def site_count(self, obj):
        return obj._site_count

    @admin.display(description="Usuarios", ordering="_member_count")
    def member_count(self, obj):
        return obj._member_count


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("user", "client", "role", "created_at")
    list_filter = ("role", "client")
    search_fields = ("user__username", "user__email", "client__name")
    list_select_related = ("user", "client")
    autocomplete_fields = ("user", "client")


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ("name", "price", "currency", "period", "max_sites", "is_active")
    list_filter = ("is_active", "period")


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("client", "amount", "currency", "paid_at", "method", "covers_until")
    list_filter = ("method",)
    search_fields = ("client__name", "reference")
    list_select_related = ("client",)
