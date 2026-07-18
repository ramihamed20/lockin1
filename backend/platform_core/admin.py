from django.contrib import admin
from django.http import HttpRequest


class ReadOnlyAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    """Expose authoritative ledgers for inspection without bypassing domain services."""

    def get_readonly_fields(
        self, request: HttpRequest, obj: object | None = None
    ) -> tuple[str, ...]:
        return tuple(field.name for field in self.model._meta.concrete_fields)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: object | None = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: object | None = None) -> bool:
        return False
