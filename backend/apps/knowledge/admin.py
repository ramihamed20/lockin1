from typing import Any

from django import forms
from django.contrib import admin
from django.core.exceptions import ValidationError

from apps.education.policies import is_content_administrator

from .models import Concept, ConceptSource, ExplainQuestion, McqConceptLink, StudyToolSettings


class ContentAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    def has_module_permission(self, request: Any) -> bool:
        return is_content_administrator(request.user)

    def has_view_permission(self, request: Any, obj: Any = None) -> bool:
        return self.has_module_permission(request)

    def has_add_permission(self, request: Any) -> bool:
        return self.has_module_permission(request)

    def has_change_permission(self, request: Any, obj: Any = None) -> bool:
        return self.has_module_permission(request)

    def has_delete_permission(self, request: Any, obj: Any = None) -> bool:
        return self.has_module_permission(request)


class SourceFormMixin(forms.ModelForm):  # type: ignore[type-arg]
    def clean(self) -> dict[str, Any]:
        data = super().clean() or {}
        source = data.get("source")
        if source and (
            source.source_version_id != source.document.version_id
            or (
                source.source_file_id != source.document.managed_file_id
                or source.concept.sheet_id != source.document.version.learning_object_id
            )
        ):
            raise ValidationError("Question source must match its sheet and current PDF.")
        return data


class QuestionForm(SourceFormMixin):
    class Meta:
        model = ExplainQuestion
        fields = (
            "source",
            "concepts",
            "difficulty",
            "prompt",
            "reference_answer",
            "essential_points",
            "alternatives",
            "follow_ups",
            "published",
        )

    def clean(self) -> dict[str, Any]:
        data = super().clean() or {}
        for field in ("essential_points", "alternatives", "follow_ups"):
            value = data.get(field, [])
            if (
                not isinstance(value, list)
                or len(value) > 20
                or any(not isinstance(point, str) or len(point) > 2000 for point in value)
            ):
                raise ValidationError("Rubric fields need at most 20 short text entries.")
        if data.get("source"):
            for concept in data.get("concepts", []):
                if concept.sheet_id != data["source"].concept.sheet_id or (
                    data.get("published") and not concept.published
                ):
                    raise ValidationError(
                        "Additional concepts must belong to this sheet and be published."
                    )
        if data.get("published") and (
            not data.get("reference_answer")
            or not data.get("essential_points")
            or not data.get("source")
            or not data["source"].concept.published
        ):
            raise ValidationError("Publication needs a published concept and a complete rubric.")
        return data


@admin.register(ExplainQuestion)
class ExplainQuestionAdmin(ContentAdmin):
    form = QuestionForm
    list_display = ("prompt", "difficulty", "published", "revision")
    list_filter = ("published", "difficulty")
    readonly_fields = ("revision",)

    def save_model(self, request: Any, obj: Any, form: Any, change: bool) -> None:
        if change:
            obj.revision = ExplainQuestion.objects.get(pk=obj.pk).revision + 1
        super().save_model(request, obj, form, change)


class SourceForm(forms.ModelForm):  # type: ignore[type-arg]
    class Meta:
        model = ConceptSource
        fields = ("concept", "document", "source_version", "source_file", "page_start", "page_end")

    def clean(self) -> dict[str, Any]:
        data = super().clean() or {}
        document, concept = data.get("document"), data.get("concept")
        if not self.instance._state.adding:
            original = ConceptSource.objects.get(pk=self.instance.pk)
            for field in self.Meta.fields:
                if data.get(field) != getattr(original, field):
                    raise ValidationError(
                        "Source references are immutable. Create a new mapping instead."
                    )
        if (
            document
            and concept
            and (
                data.get("source_version") != document.version
                or data.get("source_file") != document.managed_file
                or concept.sheet_id != document.version.learning_object_id
            )
        ):
            raise ValidationError("Source must match the concept's sheet and current edition PDF.")
        if data.get("page_start") and data.get("page_end"):
            if data["page_end"] < data["page_start"]:
                raise ValidationError("Invalid source page range.")
            if (
                document
                and document.managed_file.pdf_page_count
                and (data["page_end"] > document.managed_file.pdf_page_count)
            ):
                raise ValidationError("Source page exceeds the PDF.")
        return data


@admin.register(ConceptSource)
class ConceptSourceAdmin(ContentAdmin):
    form = SourceForm


admin.site.register(Concept, ContentAdmin)
admin.site.register(McqConceptLink, ContentAdmin)
admin.site.register(StudyToolSettings, ContentAdmin)
# Private artifacts and attempts are deliberately absent from the admin registry.
