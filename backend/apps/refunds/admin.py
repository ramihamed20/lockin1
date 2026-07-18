from django.contrib import admin

from platform_core.admin import ReadOnlyAdmin

from .models import Refund, RefundTransition

admin.site.register(Refund, ReadOnlyAdmin)
admin.site.register(RefundTransition, ReadOnlyAdmin)
