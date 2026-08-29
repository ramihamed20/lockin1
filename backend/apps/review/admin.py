from django.contrib import admin

from .models import (
    MistakeEvent,
    ReviewAnswerLog,
    ReviewItem,
    WeeklyRecallQuestion,
    WeeklyRecallSession,
)

admin.site.register(ReviewItem)
admin.site.register(MistakeEvent)
admin.site.register(ReviewAnswerLog)
admin.site.register(WeeklyRecallSession)
admin.site.register(WeeklyRecallQuestion)
