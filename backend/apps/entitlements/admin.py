from django.contrib import admin

from platform_core.admin import ReadOnlyAdmin

from .models import (
    EntitlementDefinition,
    EntitlementGrant,
    EntitlementGrantAudit,
    PlanEntitlementRule,
)

admin.site.register(EntitlementDefinition, ReadOnlyAdmin)
admin.site.register(PlanEntitlementRule, ReadOnlyAdmin)
admin.site.register(EntitlementGrant, ReadOnlyAdmin)
admin.site.register(EntitlementGrantAudit, ReadOnlyAdmin)
