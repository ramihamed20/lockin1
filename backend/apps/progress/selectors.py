from django.db.models import QuerySet
from django.utils import timezone

from apps.accounts.models import User

from .models import Bookmark, LearningProgress, QuestionReview


def bookmarks_for_user(*, user: User) -> QuerySet[Bookmark]:
    return (
        Bookmark.objects.filter(
            user=user,
            learning_object__archived_at__isnull=True,
            learning_object__published_version__academic_node__is_discoverable=True,
        )
        .select_related("learning_object__published_version__academic_node")
        .prefetch_related("learning_object__published_version__assets__managed_file")
    )


def resumable_progress(*, user: User) -> QuerySet[LearningProgress]:
    return (
        LearningProgress.objects.filter(
            user=user,
            status=LearningProgress.Status.IN_PROGRESS,
            learning_object__archived_at__isnull=True,
            learning_object__published_version__academic_node__is_discoverable=True,
        )
        .select_related(
            "learning_object__published_version__academic_node",
            "version",
        )
        .order_by("-updated_at", "id")
    )


def due_question_reviews(
    *, user: User, academic_path: str | None = None
) -> QuerySet[QuestionReview]:
    queryset = QuestionReview.objects.filter(
        user=user,
        due_at__lte=timezone.now(),
        question__retired_at__isnull=True,
        question__published_version__isnull=False,
        question__published_version__academic_node__is_discoverable=True,
    )
    if academic_path:
        queryset = queryset.filter(
            question__published_version__academic_node__path__startswith=academic_path
        )
    return queryset.select_related(
        "question__published_version__academic_node",
        "last_question_version",
    ).order_by("due_at", "id")


def learning_dashboard(*, user: User) -> dict[str, object]:
    next_progress = resumable_progress(user=user).first()
    recent_bookmark = bookmarks_for_user(user=user).first()
    from apps.content.selectors import published_learning_objects

    recent_content = published_learning_objects()[:4]
    next_item = None
    if next_progress is not None:
        version = next_progress.learning_object.published_version
        if version is not None:
            next_item = {
                "learning_object_id": next_progress.learning_object_id,
                "title": version.title,
                "content_type": version.content_type,
                "reason": "resume",
                "completion_percent": next_progress.completion_percent,
            }
    elif recent_bookmark is not None:
        version = recent_bookmark.learning_object.published_version
        if version is not None:
            next_item = {
                "learning_object_id": recent_bookmark.learning_object_id,
                "title": version.title,
                "content_type": version.content_type,
                "reason": "bookmark",
                "completion_percent": 0,
            }
    review_due = due_question_reviews(user=user)[:4]
    return {
        "next_item": next_item,
        "bookmark_count": bookmarks_for_user(user=user).count(),
        "completed_count": LearningProgress.objects.filter(
            user=user, status=LearningProgress.Status.COMPLETED
        ).count(),
        "recent_content": [
            {
                "learning_object_id": item.id,
                "title": item.published_version.title,
                "content_type": item.published_version.content_type,
            }
            for item in recent_content
            if item.published_version is not None
        ],
        "review_due": [
            {
                "question_id": review.question_id,
                "prompt": review.question.published_version.prompt[:220],
                "academic_node_id": review.question.published_version.academic_node_id,
                "academic_node_title": review.question.published_version.academic_node.title,
                "due_at": review.due_at,
                "repetitions": review.repetitions,
            }
            for review in review_due
            if review.question.published_version is not None
        ],
    }
