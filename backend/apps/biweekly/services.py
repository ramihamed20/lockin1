"""Frozen 14-day reports. The close command is the normal writer; reads only fill a missed close."""

from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.assessments.models import AttemptQuestion
from apps.content.models import LearningObjectVersion
from apps.focus.models import ActiveStudyAnswer, ActiveStudyAttempt, FocusSession
from apps.progress.models import LearningProgress
from apps.questions.models import QuestionAnswer, QuestionVersion
from apps.review.models import MistakeEvent, ReviewItem
from apps.streaks.models import StreakActivity
from apps.xp.models import XpTransaction

from .models import BiweeklySnapshot

PERIOD = timedelta(days=14)


def launch_at() -> datetime:
    launch = datetime.fromisoformat(settings.BIWEEKLY_LAUNCH_AT)
    if launch.tzinfo is None:
        raise ValueError("BIWEEKLY_LAUNCH_AT must include a timezone offset.")
    return launch.astimezone(UTC)


def anchor_for(user: User) -> datetime:
    """Start of the account's first period: its UTC sign-up day, never before launch."""
    joined = user.date_joined.astimezone(UTC)
    return max(launch_at(), datetime(joined.year, joined.month, joined.day, tzinfo=UTC))


def period_at(user: User, instant: datetime) -> tuple[datetime, datetime]:
    """Return immutable half-open UTC boundaries of the account's period containing instant.

    Before the first period starts, the first period is the current one, so the
    countdown already points at the first report.
    """
    anchor = anchor_for(user)
    index = max(0, (instant.astimezone(UTC) - anchor) // PERIOD)
    start = anchor + index * PERIOD
    return start, start + PERIOD


def most_recent_closed(user: User, now: datetime | None = None) -> tuple[datetime, datetime] | None:
    current_start, _ = period_at(user, now or timezone.now())
    if current_start <= anchor_for(user):
        return None
    return current_start - PERIOD, current_start


def _subject_label(version: QuestionVersion | None) -> str:
    if version is None:
        return "Other"
    return _subject_label_for_node(version.academic_node)


def _subject_label_for_node(node: Any) -> str:
    while node.parent_id and node.kind != node.Kind.SUBJECT:
        node = node.parent
    return str(node.title)


def _question_rows(user: User, start: datetime, end: datetime) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    normal = QuestionAnswer.objects.filter(
        user=user, answered_at__gte=start, answered_at__lt=end
    ).select_related("version__academic_node__parent__parent")
    for answer in normal:
        rows.append(
            {
                "correct": answer.is_correct,
                "difficulty": answer.version.difficulty,
                "subject": _subject_label(answer.version),
                "at": answer.answered_at,
            }
        )
    assessments = AttemptQuestion.objects.filter(
        attempt__user=user,
        attempt__result__submitted_at__gte=start,
        attempt__result__submitted_at__lt=end,
        answer__isnull=False,
    ).select_related("attempt__result", "answer", "question_version__academic_node__parent__parent")
    for question in assessments:
        rows.append(
            {
                "correct": set(question.answer.selected_option_ids)
                == set(question.correct_option_ids),
                "difficulty": question.difficulty,
                "subject": _subject_label(question.question_version),
                "at": question.attempt.result.submitted_at,
            }
        )
    active = ActiveStudyAnswer.objects.filter(
        attempt__run__user=user,
        answered_at__gte=start,
        answered_at__lt=end,
    ).select_related("attempt__run")
    for active_answer in active:
        rows.append(
            {
                "correct": active_answer.was_correct,
                "difficulty": active_answer.attempt.run.difficulty,
                "subject": active_answer.attempt.run.material_slug or "Active Study",
                "at": active_answer.answered_at,
            }
        )
    return rows


def analysis_data(
    user: User, start: datetime, end: datetime, previous: dict[str, Any] | None
) -> dict[str, Any]:
    sessions = list(
        FocusSession.objects.filter(
            user=user,
            status=FocusSession.Status.COMPLETED,
            ended_at__gte=start,
            ended_at__lt=end,
        ).only("started_at", "ended_at", "active_duration_seconds", "context_type", "context_id")
    )
    questions = _question_rows(user, start, end)
    mistakes = list(
        MistakeEvent.objects.filter(
            user=user, answered_at__gte=start, answered_at__lt=end
        ).select_related("review_item")
    )
    xp = XpTransaction.objects.filter(user=user, occurred_at__gte=start, occurred_at__lt=end)
    streak_days = set(
        StreakActivity.objects.filter(
            user=user,
            occurred_at__gte=start,
            occurred_at__lt=end,
        ).values_list("qualified_on", flat=True)
    )
    activity_days = (
        streak_days | {s.started_at.date() for s in sessions} | {r["at"].date() for r in questions}
    )
    correct = sum(bool(row["correct"]) for row in questions)
    subject_counts: defaultdict[str, list[int]] = defaultdict(lambda: [0, 0])
    difficulty_counts: defaultdict[str, list[int]] = defaultdict(lambda: [0, 0])
    for row in questions:
        subject_counts[row["subject"]][0] += 1
        subject_counts[row["subject"]][1] += bool(row["correct"])
        difficulty_counts[row["difficulty"]][0] += 1
        difficulty_counts[row["difficulty"]][1] += bool(row["correct"])
    counts = Counter(str(event.review_item_id) for event in mistakes)
    mastered = len(
        {
            event.review_item_id
            for event in mistakes
            if event.review_item.state == ReviewItem.State.MASTERED
        }
    )
    unresolved = len(
        {
            event.review_item_id
            for event in mistakes
            if event.review_item.state == ReviewItem.State.ACTIVE
        }
    )
    checkpoint_count = ActiveStudyAttempt.objects.filter(
        run__user=user,
        kind=ActiveStudyAttempt.Kind.CHECKPOINT,
        submitted_at__gte=start,
        submitted_at__lt=end,
    ).count()
    final_count = ActiveStudyAttempt.objects.filter(
        run__user=user,
        kind=ActiveStudyAttempt.Kind.FINAL,
        submitted_at__gte=start,
        submitted_at__lt=end,
    ).count()
    focus_seconds = sum(s.active_duration_seconds for s in sessions)
    document_ids = {
        session.context_id
        for session in sessions
        if session.context_type == FocusSession.ContextType.STUDY and session.context_id
    }
    documents = {
        str(version.id): version
        for version in LearningObjectVersion.objects.filter(id__in=document_ids).select_related(
            "academic_node", "academic_node__parent", "academic_node__parent__parent"
        )
    }
    subject_time: Counter[str] = Counter()
    sheet_time: Counter[str] = Counter()
    for session in sessions:
        document = documents.get(str(session.context_id))
        if document:
            subject_time[_subject_label_for_node(document.academic_node)] += (
                session.active_duration_seconds
            )
            sheet_time[document.title] += session.active_duration_seconds
        else:
            subject_time["Unattributed Focus"] += session.active_duration_seconds
    sheets_completed = LearningProgress.objects.filter(
        user=user,
        completed_at__gte=start,
        completed_at__lt=end,
        version__content_type=LearningObjectVersion.ContentType.PDF,
    ).count()
    metrics: dict[str, Any] = {
        "study_time_seconds": focus_seconds,
        "focus_time_seconds": focus_seconds,
        "questions_answered": len(questions),
        "correct_answers": correct,
        "incorrect_answers": len(questions) - correct,
        "accuracy": round(100 * correct / len(questions)) if questions else None,
        "xp_earned": sum(int(value) for value in xp.values_list("points", flat=True)),
        "active_days": len(activity_days),
        "average_session_seconds": round(focus_seconds / len(sessions)) if sessions else None,
        "longest_session_seconds": max((s.active_duration_seconds for s in sessions), default=None),
        "mistakes_created": len(mistakes),
        "mistakes_repeated": sum(value - 1 for value in counts.values()),
        "mistakes_mastered": mastered,
        "mistakes_unresolved": unresolved,
        "sheets_completed": sheets_completed,
        "active_study_checkpoints": checkpoint_count,
        "final_exams_completed": final_count,
    }
    for difficulty in ("easy", "medium", "hard"):
        total, correct_count = difficulty_counts[difficulty]
        metrics[f"{difficulty}_accuracy"] = round(100 * correct_count / total) if total else None
    difficulties = [
        {
            "label": difficulty.title(),
            "answered": difficulty_counts[difficulty][0],
            "accuracy": metrics[f"{difficulty}_accuracy"],
            "reliable": difficulty_counts[difficulty][0] >= 10,
        }
        for difficulty in ("easy", "medium", "hard")
    ]
    subjects: list[dict[str, Any]] = [
        {
            "subject": subject,
            "answered": total,
            "correct": right,
            "accuracy": round(100 * right / total),
            "reliable": total >= 10,
        }
        for subject, (total, right) in sorted(subject_counts.items())
    ]
    insights = []
    if previous and len(questions) >= 10 and previous.get("questions_answered", 0) >= 10:
        old_accuracy = previous.get("accuracy")
        if old_accuracy is not None and metrics["accuracy"] >= old_accuracy + 5:
            insights.append("Your question accuracy improved over the previous two weeks.")
    if not questions:
        insights.append("Not enough question activity yet to calculate a reliable trend.")
    if subjects and not any(subject["reliable"] for subject in subjects):
        insights.append("Not enough answers in any one subject for a reliable subject trend.")
    reliable_subjects = [subject for subject in subjects if subject["reliable"]]
    if reliable_subjects:
        strongest = max(reliable_subjects, key=lambda subject: subject["accuracy"])
        insights.append(
            f"{strongest['subject']} had your highest subject accuracy "
            "among subjects with at least 10 answers."
        )
    if (
        difficulty_counts["hard"][0] >= 10
        and difficulty_counts["medium"][0] >= 10
        and metrics["hard_accuracy"] < metrics["medium_accuracy"]
    ):
        insights.append("Hard question accuracy remained below Medium question accuracy.")
    return {
        "metrics": metrics,
        "previous_period_metrics": previous,
        "subject_performance": subjects,
        "difficulty_performance": difficulties,
        "insights": insights,
        "study_days": sorted(day.isoformat() for day in activity_days),
        "subject_study_time": [
            {
                "subject": subject,
                "seconds": seconds,
                "percentage": round(100 * seconds / focus_seconds) if focus_seconds else 0,
            }
            for subject, seconds in subject_time.most_common()
        ],
        "most_studied_sheet": sheet_time.most_common(1)[0][0] if sheet_time else None,
    }


def review_data(user: User, start: datetime, end: datetime) -> dict[str, Any]:
    events = (
        MistakeEvent.objects.filter(user=user, answered_at__gte=start, answered_at__lt=end)
        .select_related(
            "review_item__last_question_version__source_learning_object__published_version"
        )
        .order_by("answered_at", "id")
    )
    grouped: dict[str, list[MistakeEvent]] = defaultdict(list)
    for event in events:
        grouped[str(event.review_item_id)].append(event)
    questions = []
    for event_group in grouped.values():
        latest = event_group[-1]
        item = latest.review_item
        version = item.last_question_version
        sheet = version.source_learning_object if version else None
        correct_ids = latest.correct_option_ids_snapshot or item.correct_option_ids_snapshot
        question_type = latest.question_type_snapshot or (
            version.question_type
            if version
            else "multiple_select"
            if len(correct_ids) > 1
            else "single_choice"
        )
        questions.append(
            {
                "review_item_id": str(item.id),
                "question_id": str(item.question_id) if item.question_id else None,
                "question_version_id": (
                    str(latest.question_version_id_snapshot)
                    if latest.question_version_id_snapshot
                    else str(version.id)
                    if version
                    else None
                ),
                "subject": latest.subject_label_snapshot or item.subject_label_snapshot,
                "sheet": (
                    latest.source_label_snapshot
                    or (
                        sheet.published_version.title
                        if sheet and sheet.published_version
                        else "Other"
                    )
                ),
                "edition": None,
                "source_page": latest.source_page_snapshot
                or (version.source_page if version else None),
                "source_type": latest.source_type,
                "source_label": latest.source_label_snapshot,
                "question_number": latest.source_question_index,
                "question_type": question_type,
                "prompt": latest.prompt_snapshot,
                "options": latest.options_snapshot or item.options_snapshot,
                "correct_option_ids": correct_ids,
                "student_answers": latest.selected_answer_snapshot,
                "correct_answers": latest.correct_answer_snapshot,
                "explanation": (
                    latest.explanation_snapshot
                    if latest.options_snapshot
                    else item.explanation_snapshot
                ),
                "repetitions": len(event_group),
            }
        )
    questions.sort(
        key=lambda row: (
            row["subject"].casefold(),
            row["sheet"].casefold(),
            -row["repetitions"],
            row["question_number"] or 0,
        )
    )
    return {
        "questions": questions,
        "mistake_count": len(grouped),
        "mistake_events": sum(len(events) for events in grouped.values()),
    }


@transaction.atomic
def create_snapshot(
    *, user: User, report_type: str, start: datetime, end: datetime
) -> BiweeklySnapshot:
    anchor = anchor_for(user)
    if (
        report_type not in BiweeklySnapshot.Type.values
        or end != start + PERIOD
        or start < anchor
        or (start - anchor) % PERIOD
    ):
        raise ValueError("Invalid biweekly report period.")
    if timezone.now() < end:
        raise ValueError("An active period cannot be frozen.")
    User.objects.select_for_update().only("id").get(pk=user.pk)
    existing = BiweeklySnapshot.objects.filter(
        user=user, report_type=report_type, period_start=start
    ).first()
    if existing:
        return existing
    if report_type == BiweeklySnapshot.Type.ANALYSIS:
        previous = BiweeklySnapshot.objects.filter(
            user=user,
            report_type=report_type,
            period_start=start - PERIOD,
        ).first()
        data = analysis_data(user, start, end, previous.data.get("metrics") if previous else None)
    else:
        data = review_data(user, start, end)
    return BiweeklySnapshot.objects.create(
        user=user,
        report_type=report_type,
        period_start=start,
        period_end=end,
        data=data,
    )


def ensure_latest_closed(user: User, now: datetime | None = None) -> None:
    period = most_recent_closed(user, now)
    if period:
        for report_type in BiweeklySnapshot.Type.values:
            create_snapshot(user=user, report_type=report_type, start=period[0], end=period[1])
