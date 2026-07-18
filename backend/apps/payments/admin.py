from django.contrib import admin

from platform_core.admin import ReadOnlyAdmin

from .models import Payment, PaymentTransition

admin.site.register(Payment, ReadOnlyAdmin)
admin.site.register(PaymentTransition, ReadOnlyAdmin)
