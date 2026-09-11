"""Cohort switching keeps the account but retires cohort-bound learner state."""

from django.db import transaction
from django.db.models import QuerySet

from apps.accounts.models import User
from apps.accounts.roles import is_subscription_exempt
from apps.content.models import LearningObject

from .models import StudentCohort


def _objects_under(cohort: StudentCohort) -> QuerySet[LearningObject]:
    paths = cohort.content_nodes.values_list("path", flat=True)
    # A scoped root authorizes every descendant.  Build explicit prefix checks
    # at the database boundary rather than comparing labels in application code.
    from django.db.models import Q

    condition = Q()
    for path in paths:
        condition |= Q(current_version__academic_node__path__startswith=path)
    return LearningObject.objects.filter(condition) if condition else LearningObject.objects.none()


@transaction.atomic
def change_student_cohort(*, user: User, cohort: StudentCohort) -> bool:
    """Move a student and clear only learning state owned by the prior path.

    Identity, account sessions, subscriptions, purchases and payment history are
    not touched here.  The operation is deliberately not available to founders:
    their operational view is capability-based, not a student enrolment.
    """
    # Founders administer and browse every branch through operational
    # capabilities. A selected path is client-side context for them, never an
    # enrolment mutation and never a reason to clear account-owned study data.
    if is_subscription_exempt(user) or user.cohort_id == cohort.id:
        return False
    previous = user.cohort
    if previous is not None:
        old_objects = _objects_under(previous)
        old_object_ids = old_objects.values_list("id", flat=True)
        old_paths = list(previous.content_nodes.values_list("path", flat=True))

        from apps.assessments.models import Attempt
        from apps.content.models import CatalogWorkspaceSnapshot
        from apps.focus.models import (
            ActiveStudyRun,
            FocusAnnotationCollection,
            FocusWorkspaceSnapshot,
        )
        from apps.progress.models import (
            Bookmark,
            LearningProgress,
            LessonProgress,
            QuestionReview,
            QuestionReviewLog,
        )
        from apps.review.models import (
            MistakeEvent,
            ReviewAnswerLog,
            ReviewItem,
            WeeklyRecallQuestion,
            WeeklyRecallSession,
        )

        old_version_ids = list(old_objects.values_list("current_version_id", flat=True)) + list(
            old_objects.values_list("published_version_id", flat=True)
        )
        old_version_ids = [version_id for version_id in old_version_ids if version_id is not None]

        # This is an explicit allowlist of student-owned, cohort-bound study
        # state. It intentionally excludes User fields, subscriptions,
        # payments, purchases, receipts, sessions, and all account history.
        LearningProgress.objects.filter(user=user, learning_object_id__in=old_object_ids).delete()
        Bookmark.objects.filter(user=user, learning_object_id__in=old_object_ids).delete()
        ActiveStudyRun.objects.filter(user=user, sheet_id__in=old_object_ids).delete()
        CatalogWorkspaceSnapshot.objects.filter(
            user=user, document__version_id__in=old_version_ids
        ).delete()
        FocusWorkspaceSnapshot.objects.filter(
            user=user, document_version_id__in=old_version_ids
        ).delete()
        FocusAnnotationCollection.objects.filter(
            user=user, document_version_id__in=old_version_ids
        ).delete()
        if old_paths:
            from django.db.models import Q

            condition = Q()
            for path in old_paths:
                condition |= Q(lesson__path__startswith=path)
            LessonProgress.objects.filter(user=user).filter(condition).delete()

            attempt_condition = Q()
            for path in old_paths:
                attempt_condition |= Q(quiz_version__academic_node__path__startswith=path)
            # Only unfinished attempts are reset. Submitted assessment results
            # are immutable evidence and are therefore deliberately retained.
            Attempt.objects.filter(
                user=user,
                status=Attempt.Status.ACTIVE,
            ).filter(attempt_condition).delete()

            review_condition = Q()
            for path in old_paths:
                review_condition |= Q(
                    question__current_version__academic_node__path__startswith=path
                )
            QuestionReviewLog.objects.filter(user=user).filter(review_condition).delete()
            QuestionReview.objects.filter(user=user).filter(review_condition).delete()
            item_condition = Q()
            for path in old_paths:
                item_condition |= Q(subject__path__startswith=path)
            item_ids = list(
                ReviewItem.objects.filter(user=user)
                .filter(item_condition)
                .values_list("id", flat=True)
            )
            from django.db.models import Count, F

            # Delete a weekly-recall session only when every question it holds
            # belongs to the departing cohort. This avoids crossing paths in a
            # mixed or legacy session.
            old_recall_session_ids = list(
                WeeklyRecallSession.objects.filter(user=user)
                .annotate(
                    recall_question_count=Count("questions"),
                    old_questions=Count(
                        "questions", filter=Q(questions__review_item_id__in=item_ids)
                    ),
                )
                .filter(recall_question_count=F("old_questions"))
                .values_list("id", flat=True)
            )
            ReviewAnswerLog.objects.filter(
                user=user,
                weekly_question__session_id__in=old_recall_session_ids,
            ).delete()
            ReviewAnswerLog.objects.filter(user=user, review_item_id__in=item_ids).delete()
            MistakeEvent.objects.filter(user=user, review_item_id__in=item_ids).delete()
            WeeklyRecallQuestion.objects.filter(review_item_id__in=item_ids).delete()
            ReviewItem.objects.filter(id__in=item_ids).delete()
            WeeklyRecallSession.objects.filter(id__in=old_recall_session_ids).delete()

    user.cohort = cohort
    user.save(update_fields=["cohort", "updated_at"])
    return True
