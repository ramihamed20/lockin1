from django.contrib import admin

from platform_core.admin import ReadOnlyAdmin

from .models import Subscription, SubscriptionAccount, SubscriptionTransition

admin.site.register(SubscriptionAccount, ReadOnlyAdmin)
admin.site.register(Subscription, ReadOnlyAdmin)
admin.site.register(SubscriptionTransition, ReadOnlyAdmin)
