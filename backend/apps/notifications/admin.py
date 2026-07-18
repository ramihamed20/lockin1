from django.contrib import admin

from .models import Notification, NotificationCounter, NotificationDelivery, NotificationPreference

admin.site.register(
    (Notification, NotificationPreference, NotificationCounter, NotificationDelivery)
)
