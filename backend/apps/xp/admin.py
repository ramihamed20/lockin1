from django.contrib import admin

from .models import XpBalance, XpTransaction


@admin.register(XpTransaction)
class XpTransactionAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("user", "points", "rule_code", "ranking_eligible", "occurred_at")
    list_filter = ("category", "ranking_eligible", "rule_code")
    search_fields = ("user__email", "source_key")
    readonly_fields = tuple(field.name for field in XpTransaction._meta.fields)

    def has_add_permission(self, request):  # type: ignore[no-untyped-def]
        return False

    def has_change_permission(self, request, obj=None):  # type: ignore[no-untyped-def]
        return False

    def has_delete_permission(self, request, obj=None):  # type: ignore[no-untyped-def]
        return False


admin.site.register(XpBalance)
