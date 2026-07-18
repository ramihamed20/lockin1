from django.contrib import admin

from platform_core.admin import ReadOnlyAdmin

from .models import Plan, PlanVersion, Price, Product

admin.site.register(Product, ReadOnlyAdmin)
admin.site.register(Plan, ReadOnlyAdmin)
admin.site.register(PlanVersion, ReadOnlyAdmin)
admin.site.register(Price, ReadOnlyAdmin)
