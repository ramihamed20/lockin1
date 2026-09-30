from contextlib import suppress
from datetime import UTC, timedelta
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.review.models import ReviewAnswerLog, ReviewItem
from apps.review.services import ReviewRuleError, answer_review_item

from .models import BiweeklyReviewTest, BiweeklySnapshot
from .pdf import ensure_pdf
from .services import ensure_latest_closed, period_at


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise NotFound()
    return request.user


def _report(user: User, report_type: str, snapshot_id: UUID) -> BiweeklySnapshot:
    if report_type not in BiweeklySnapshot.Type.values:
        raise NotFound()
    report = BiweeklySnapshot.objects.filter(
        id=snapshot_id,
        user=user,
        report_type=report_type,
    ).first()
    if report is None:
        raise NotFound()
    return report


def _payload(report: BiweeklySnapshot) -> dict[str, Any]:
    return {
        "id": str(report.id),
        "report_type": report.report_type,
        "period_start": report.period_start,
        "period_end": report.period_end,
        "generated_at": report.generated_at,
        "summary": (
            report.data.get("metrics", {})
            if report.report_type == "analysis"
            else {"mistake_count": report.data.get("mistake_count", 0)}
        ),
        "test_completed_at": getattr(getattr(report, "test", None), "completed_at", None),
    }


class BiweeklyHistoryView(APIView):
    def get(self, request: Request, report_type: str) -> Response:
        if report_type not in BiweeklySnapshot.Type.values:
            raise NotFound()
        user = _user(request)
        ensure_latest_closed(user)
        start, end = period_at(user, timezone.now())
        history = BiweeklySnapshot.objects.filter(
            user=user, report_type=report_type
        ).select_related("test")
        return Response(
            {
                "current_period": {"period_start": start, "period_end": end, "next_report_at": end},
                "history": [_payload(report) for report in history],
            }
        )


class BiweeklyReportView(APIView):
    def get(self, request: Request, report_type: str, snapshot_id: UUID) -> Response:
        report = _report(_user(request), report_type, snapshot_id)
        return Response({**_payload(report), "data": report.data})


class BiweeklyPdfView(APIView):
    def get(self, request: Request, report_type: str, snapshot_id: UUID) -> FileResponse:
        report = _report(_user(request), report_type, snapshot_id)
        report = ensure_pdf(report)
        period_last_day = report.period_end.astimezone(UTC) - timedelta(days=1)
        filename = (
            f"lockin-{report_type}-{report.period_start.astimezone(UTC):%Y-%m-%d}_"
            f"{period_last_day:%Y-%m-%d}.pdf"
        )
        response = FileResponse(report.pdf.open("rb"), content_type="application/pdf")
        response["Content-Disposition"] = (
            f'inline; filename="{filename}"'
            if request.query_params.get("preview") == "1"
            else f'attachment; filename="{filename}"'
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response


class BiweeklyReviewTestView(APIView):
    def get(self, request: Request, snapshot_id: UUID) -> Response:
        report = _report(_user(request), BiweeklySnapshot.Type.REVIEW, snapshot_id)
        test = BiweeklyReviewTest.objects.filter(snapshot=report).first()
        questions = [
            {
                key: value
                for key, value in question.items()
                if key
                not in ("correct_option_ids", "correct_answers", "explanation", "student_answers")
            }
            for question in report.data.get("questions", [])
        ]
        return Response(
            {
                "questions": questions,
                "result": test.answers if test else None,
                "completed_at": test.completed_at if test else None,
            }
        )

    @transaction.atomic
    def post(self, request: Request, snapshot_id: UUID) -> Response:
        user = _user(request)
        report = _report(user, BiweeklySnapshot.Type.REVIEW, snapshot_id)
        BiweeklySnapshot.objects.select_for_update().get(pk=report.pk)
        existing = BiweeklyReviewTest.objects.filter(snapshot=report).first()
        if existing:
            return Response({"result": existing.answers, "completed_at": existing.completed_at})
        selections = request.data.get("answers")
        if not isinstance(selections, dict):
            raise ValidationError({"answers": "Answer selections must be an object."})
        questions = report.data.get("questions", [])
        expected = {question["review_item_id"] for question in questions}
        if set(selections) != expected:
            raise ValidationError({"answers": "Submit one answer for each review question."})
        result = {}
        for question in questions:
            key = question["review_item_id"]
            selected = selections[key]
            offered = {str(option["id"]) for option in question["options"]}
            if (
                not isinstance(selected, list)
                or not selected
                or len(selected) > 12
                or any(not isinstance(value, str) for value in selected)
                or len(selected) != len(set(selected))
                or not set(selected) <= offered
                or (question["question_type"] != "multiple_select" and len(selected) != 1)
            ):
                raise ValidationError({"answers": f"Invalid answer for question {key}."})
            result[key] = {
                "selected_option_ids": selected,
                "was_correct": set(selected) == set(question["correct_option_ids"]),
            }
        test = BiweeklyReviewTest.objects.create(
            snapshot=report, user=user, answers=result, completed_at=timezone.now()
        )
        for question in questions:
            key = question["review_item_id"]
            item = ReviewItem.objects.filter(
                id=key, user=user, state=ReviewItem.State.ACTIVE
            ).first()
            if (
                item
                and item.correct_option_ids_snapshot == question["correct_option_ids"]
                and item.options_snapshot == question["options"]
            ):
                with suppress(ReviewRuleError):
                    answer_review_item(
                        user=user,
                        review_item_id=item.id,
                        selected_option_ids=tuple(selections[key]),
                        idempotency_key=uuid5(NAMESPACE_URL, f"biweekly:{test.id}:{key}"),
                        context=ReviewAnswerLog.Context.REVIEW_BANK,
                    )
        return Response({"result": result, "completed_at": test.completed_at}, status=201)
