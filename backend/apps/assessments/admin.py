from django.contrib import admin

from .models import (
    Attempt,
    AttemptActivity,
    AttemptAnswer,
    AttemptQuestion,
    AttemptResult,
    AttemptSubmissionReceipt,
    QuestionIssueReport,
    Quiz,
    QuizVersion,
    QuizVersionQuestion,
)

admin.site.register(Quiz)
admin.site.register(QuizVersion)
admin.site.register(QuizVersionQuestion)
admin.site.register(Attempt)
admin.site.register(AttemptQuestion)
admin.site.register(AttemptAnswer)
admin.site.register(AttemptResult)
admin.site.register(AttemptSubmissionReceipt)
admin.site.register(AttemptActivity)
admin.site.register(QuestionIssueReport)
