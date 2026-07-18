from django.contrib import admin

from platform_core.admin import ReadOnlyAdmin

from .models import Invoice, InvoiceLine, InvoiceTransition

admin.site.register(Invoice, ReadOnlyAdmin)
admin.site.register(InvoiceLine, ReadOnlyAdmin)
admin.site.register(InvoiceTransition, ReadOnlyAdmin)
