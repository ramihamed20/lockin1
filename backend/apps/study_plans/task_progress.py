"""Consume authoritative review results without awarding points twice."""

from django.db import transaction

from apps.accounts.models import User
from apps.review.planning import planned_review_completions

from .models import StudyPlanItem


@transaction.atomic
def reconcile_review_tasks(user: User) -> None:
    User.objects.select_for_update().get(pk=user.pk)
    reconcile_active_tasks(user)
    reconcile_question_tasks(user)
    pending = list(
        StudyPlanItem.objects.filter(
            user=user,
            planning_key__isnull=False,
            activity="review",
            status="planned",
            review_item__user=user,
        ).exclude(review_item=None)[:3000]
    )
    if not pending:
        return
    completions = {
        row["review_item_id"]: row["answered_at"]
        for row in planned_review_completions(
            user=user, item_ids=[task.review_item_id for task in pending if task.review_item_id]
        )
    }
    changed = []
    for task in pending:
        scored_at = completions.get(task.review_item_id)
        # An explicit later manual reopen wins until another correct answer.
        if scored_at is not None and scored_at > (task.status_changed_at or task.created_at):
            task.status = StudyPlanItem.Status.COMPLETED
            task.completed_at = scored_at
            task.updated_at = scored_at
            task.revision += 1
            changed.append(task)
    if changed:
        StudyPlanItem.objects.bulk_update(
            changed, ["status", "completed_at", "updated_at", "revision"], batch_size=200
        )


def reconcile_active_tasks(user: User) -> None:
    from datetime import datetime

    from apps.focus.planning import scored_checkpoints

    tasks = list(
        StudyPlanItem.objects.filter(
            user=user,
            activity="active_study",
            status="planned",
            planning_key__isnull=False,
        )[:3000]
    )
    if not tasks:
        return
    scores = scored_checkpoints(
        user=user, version_ids=list({str(task.content_version_id) for task in tasks})
    )
    changed = []
    for task in tasks:
        candidates = [
            score
            for score in scores
            if score["study_source_version"] == str(task.content_version_id)
            and score["study_source_file"] == str(task.source_file_id)
            and score["edition"] == task.edition
            and score["difficulty"] == task.difficulty
            and score["page_start"] == task.page_start
            and score["page_end"] == task.page_end
            and str(score.get("bank_revision")) == (task.planning_key or "::").split(":")[-2]
        ]
        if not candidates or not candidates[0]["passed"]:
            continue
        stamp = datetime.fromisoformat(candidates[0]["submitted_at"])
        if stamp <= (task.status_changed_at or task.created_at):
            continue
        task.status = "completed"
        task.completed_at = stamp
        task.updated_at = stamp
        task.revision += 1
        changed.append(task)
    if changed:
        StudyPlanItem.objects.bulk_update(
            changed, ["status", "completed_at", "updated_at", "revision"], batch_size=200
        )



def reconcile_question_tasks(user: User) -> None:
    """Mark coverage complete only from actual recorded QuestionAnswer rows."""
    from apps.questions.models import QuestionAnswer

    tasks = list(
        StudyPlanItem.objects.filter(
            user=user, activity="questions", status="planned", planning_key__isnull=False
        ).order_by("id")[:3000]
    )
    if not tasks:
        return
    ids = {qid for task in tasks for qid in task.question_ids}
    recorded = dict(
        (str(qid), when) for qid, when in QuestionAnswer.objects.filter(
            user=user, question_id__in=ids
        ).values_list("question_id", "answered_at")
    )
    changed = []
    for task in tasks:
        if not task.question_ids or not all(qid in recorded for qid in task.question_ids):
            continue
        finished_at = max(recorded[qid] for qid in task.question_ids)
        if finished_at <= (task.status_changed_at or task.created_at):
            continue
        task.status = StudyPlanItem.Status.COMPLETED
        task.completed_at = finished_at
        task.status_changed_at = finished_at
        task.revision += 1
        changed.append(task)
    if changed:
        StudyPlanItem.objects.bulk_update(
            changed, ["status", "completed_at", "status_changed_at", "revision"],
            batch_size=200,
        )
