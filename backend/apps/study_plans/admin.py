from django.contrib import admin

from .exam_models import ExamPeriod, ExamSchedule, ExamSyllabusScope
from .models import StudySheetDifficulty


class ExamScheduleInline(admin.TabularInline):  # type: ignore[type-arg]
    model = ExamSchedule
    extra = 0


class ExamSyllabusInline(admin.TabularInline):  # type: ignore[type-arg]
    model = ExamSyllabusScope
    extra = 0


@admin.register(ExamPeriod)
class ExamPeriodAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("title", "institution", "cohort", "kind", "starts_on", "status")
    list_filter = ("status", "kind", "cohort__program", "cohort")
    search_fields = ("title", "cohort__name_en", "cohort__name_ar")
    readonly_fields = ("created_at", "updated_at")
    inlines = (ExamScheduleInline, ExamSyllabusInline)


@admin.register(ExamSyllabusScope)
class ExamSyllabusScopeAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("period", "subject", "include_future_sheets")
    list_filter = ("period", "include_future_sheets")
    filter_horizontal = ("sheets",)


@admin.register(StudySheetDifficulty)
class StudySheetDifficultyAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("sheet", "level", "updated_at")
    list_filter = ("level",)
    search_fields = ("sheet__current_version__title", "sheet__published_version__title")
