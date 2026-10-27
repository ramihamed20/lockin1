"""Consume authoritative review results without awarding points twice."""

from django.db import transaction

from apps.accounts.models import User
from apps.review.planning import planned_review_completions

from .models import StudyPlanItem


@transaction.atomic
def reconcile_review_tasks(user: User) -> None:
    User.objects.select_for_update().get(pk=user.pk)
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
