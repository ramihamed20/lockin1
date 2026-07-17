from django.contrib import admin

from .models import Bookmark, LearningProgress, LessonProgress, QuestionReview, QuestionReviewLog

admin.site.register(Bookmark)
admin.site.register(LearningProgress)
admin.site.register(LessonProgress)
admin.site.register(QuestionReview)
admin.site.register(QuestionReviewLog)
