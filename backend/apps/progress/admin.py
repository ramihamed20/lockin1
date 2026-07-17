from django.contrib import admin

from .models import Bookmark, LearningProgress, LessonProgress

admin.site.register(Bookmark)
admin.site.register(LearningProgress)
admin.site.register(LessonProgress)
