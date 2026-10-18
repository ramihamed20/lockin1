"""Explicit personal learning-data boundary for export and reviewed erasure.

Published creator material and shared work require a separate operator review;
financial and security evidence are never silently swept up with study notes.
"""

from typing import Any

from django.apps import apps
from django.db.models import Q, QuerySet

from .models import User

PERSONAL_APPS = {
    "focus",
    "progress",
    "review",
    "study_plans",
    "class_schedule",
    "biweekly",
    "xp",
    "streaks",
    "achievements",
    "rankings",
    "offline",
}
PERSONAL_MODELS = {
    "content.PersonalSheet",
    "content.CatalogWorkspaceSnapshot",
    "content.PracticeSlideProgress",
    "questions.QuestionAnswer",
    "assessments.Attempt",
    "assessments.AttemptQuestion",
    "assessments.AttemptAnswer",
    "assessments.AttemptResult",
    "assessments.AttemptSubmissionReceipt",
    "assessments.AttemptActivity",
}


def personal_queries(user: User) -> dict[str, QuerySet[Any]]:
    models = [
        model
        for model in apps.get_models()
        if model._meta.app_label in PERSONAL_APPS or model._meta.label in PERSONAL_MODELS
    ]
    result: dict[str, QuerySet[Any]] = {}
    for model in models:
        own = Q()
        found = False
        for field in model._meta.fields:
            if (
                field.remote_field is not None
                and field.remote_field.model is User
                and field.name in {"user", "owner", "author", "requested_by"}
            ):
                own |= Q(**{field.name: user})
                found = True
        if found:
            result[model._meta.label] = model._default_manager.filter(own)
    # Include notes, answer snapshots and other children of owned records.
    for _ in range(len(models)):
        additions = {}
        for model in models:
            if model._meta.label in result:
                continue
            scopes = Q()
            found = False
            for field in model._meta.fields:
                relation = getattr(field, "remote_field", None)
                label = (
                    relation.model._meta.label
                    if relation and hasattr(relation.model, "_meta")
                    else ""
                )
                if label in result:
                    scopes |= Q(**{f"{field.name}__in": result[label]})
                    found = True
            if found:
                additions[model._meta.label] = model._default_manager.filter(scopes)
        if not additions:
            break
        result.update(additions)
    return result


def export_study_rows(label: str, query: QuerySet[Any]) -> list[dict[str, Any]]:
    excluded = {"request_digest", "response_payload", "plan_signature"}
    if label == "assessments.AttemptQuestion":
        # Platform question keys are not personal notes. An export must not
        # bypass the release policy for an active assessment.
        excluded |= {"correct_option_ids", "explanation", "option_snapshot", "prompt"}
    fields = [field.attname for field in query.model._meta.fields if field.name not in excluded]
    return list(query.values(*fields))


def export_personal_data(user: User) -> dict[str, Any]:
    from apps.payments.selectors import payments_for_user
    from apps.payments.serializers import PaymentSerializer

    from .serializers import UserSerializer

    return {
        "profile": UserSerializer(user).data,
        "study_data": {
            label: export_study_rows(label, query)
            for label, query in personal_queries(user).items()
        },
        "payments": PaymentSerializer(payments_for_user(user=user), many=True).data,
        "notice": (
            "نسخة من البيانات المحفوظة على الخادم. قد توجد مسودات غير متزامنة "
            "على أجهزتك. للاستفسار أو نسخة أخرى تواصل مع الدعم."
        ),
    }
