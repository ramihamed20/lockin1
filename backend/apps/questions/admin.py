from django.contrib import admin

from .models import Question, QuestionOption, QuestionVersion

admin.site.register(Question)
admin.site.register(QuestionVersion)
admin.site.register(QuestionOption)
