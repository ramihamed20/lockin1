from django.contrib import admin

from .models import StudentCohort


@admin.register(StudentCohort)
class StudentCohortAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("name_en", "program", "code", "is_active")
    list_filter = ("is_active", "program")
    search_fields = ("name_en", "name_ar", "code")
