from django.contrib import admin

from platform_core.admin import ReadOnlyAdmin

from .models import ProviderEvent, ProviderObjectLink, WebhookAttempt

admin.site.register(ProviderObjectLink, ReadOnlyAdmin)
admin.site.register(WebhookAttempt, ReadOnlyAdmin)
admin.site.register(ProviderEvent, ReadOnlyAdmin)
