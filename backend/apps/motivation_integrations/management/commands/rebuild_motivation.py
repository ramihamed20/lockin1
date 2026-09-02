from django.core.management.base import BaseCommand

from apps.accounts.events import UserEmailVerified
from apps.accounts.models import User
from apps.achievements.events import AchievementEarned
from apps.achievements.models import EarnedAchievement
from apps.achievements.services import rebuild_progress, record_evidence
from apps.assessments.events import QuizAttemptSubmitted
from apps.assessments.models import AttemptResult
from apps.community.events import DiscussionCreated, DiscussionReplyCreated
from apps.community.models import Comment, Discussion
from apps.focus.events import FocusSessionCompleted
from apps.focus.models import FocusSession
from apps.notifications.services import rebuild_counter
from apps.progress.events import LessonCompleted
from apps.progress.models import LessonProgress
from apps.rankings.services import record_ranking_fact
from apps.streaks.services import rebuild_streak
from apps.xp.models import XpTransaction
from apps.xp.services import rebuild_balance

from ...subscribers import (
    _achievement_earned,
    _assessment_submitted,
    _discussion_created,
    _email_verified,
    _focus_completed,
    _lesson_completed,
    _reply_created,
)


class Command(BaseCommand):
    help = "Rebuild deterministic Phase 7 projections from their authoritative ledgers."

    def handle(self, *args: object, **options: object) -> None:
        source_count = self._reconcile_source_evidence()
        users = User.objects.filter(is_active=True).iterator(chunk_size=500)
        user_count = 0
        for user in users:
            rebuild_balance(user=user)
            streak = rebuild_streak(user=user)
            if streak.longest_days:
                record_evidence(
                    user_id=user.id,
                    source_key=f"streak-rebuild:{streak.policy_id}:{streak.longest_days}",
                    evidence_type="streak.current_days",
                    source_object_id=None,
                    value=streak.longest_days,
                    occurred_at=streak.updated_at,
                    metadata={"reconciled": True},
                )
            rebuild_progress(user=user)
            rebuild_counter(user=user)
            user_count += 1
        fact_count = 0
        for award in XpTransaction.objects.filter(ranking_eligible=True).iterator(chunk_size=1_000):
            _, created = record_ranking_fact(
                user_id=award.user_id,
                source_transaction_id=award.id,
                source_key=award.source_key,
                points=award.points,
                category=award.category,
                occurred_at=award.occurred_at,
            )
            fact_count += int(created)
        self.stdout.write(
            self.style.SUCCESS(
                f"Reconciled {source_count} source records; rebuilt {user_count} users; "
                f"restored {fact_count} ranking facts."
            )
        )

    def _reconcile_source_evidence(self) -> int:
        count = 0
        for progress in LessonProgress.objects.iterator(chunk_size=1_000):
            _lesson_completed(
                LessonCompleted(
                    lesson_id=progress.lesson_id,
                    user_id=progress.user_id,
                    actor_id=progress.user_id,
                    occurred_at=progress.completed_at,
                )
            )
            count += 1
        sessions = FocusSession.objects.filter(status=FocusSession.Status.COMPLETED)
        for session in sessions.iterator(chunk_size=1_000):
            _focus_completed(
                FocusSessionCompleted(
                    session_id=session.id,
                    user_id=session.user_id,
                    context_type=session.context_type,
                    context_id=session.context_id,
                    active_duration_seconds=session.active_duration_seconds,
                    actor_id=session.user_id,
                    occurred_at=session.ended_at or session.updated_at,
                )
            )
            count += 1
        results = AttemptResult.objects.select_related("attempt", "attempt__quiz_version").filter(
            passed=True
        )
        for result in results.iterator(chunk_size=1_000):
            attempt = result.attempt
            _assessment_submitted(
                QuizAttemptSubmitted(
                    attempt_id=attempt.id,
                    result_id=result.id,
                    user_id=attempt.user_id,
                    quiz_id=attempt.quiz_id,
                    quiz_version_id=attempt.quiz_version_id,
                    mode=attempt.quiz_version.mode,
                    percentage=str(result.percentage),
                    passed=result.passed,
                    ranking_eligible=result.ranking_eligible,
                    achievement_eligible=result.achievement_eligible,
                    actor_id=attempt.user_id,
                    occurred_at=result.submitted_at,
                )
            )
            count += 1
        for discussion in Discussion.objects.iterator(chunk_size=1_000):
            _discussion_created(
                DiscussionCreated(
                    discussion_id=discussion.id,
                    author_id=discussion.author_id,
                    context_type=discussion.context_type,
                    context_id=discussion.context_id,
                    space_id=discussion.space_id,
                    actor_id=discussion.author_id,
                    occurred_at=discussion.created_at,
                )
            )
            count += 1
        comments = Comment.objects.select_related("discussion", "parent")
        for comment in comments.iterator(chunk_size=1_000):
            _reply_created(
                DiscussionReplyCreated(
                    comment_id=comment.id,
                    discussion_id=comment.discussion_id,
                    author_id=comment.author_id,
                    discussion_author_id=comment.discussion.author_id,
                    parent_comment_id=comment.parent_id,
                    parent_author_id=comment.parent.author_id if comment.parent else None,
                    context_type=comment.discussion.context_type,
                    context_id=comment.discussion.context_id,
                    space_id=comment.discussion.space_id,
                    actor_id=comment.author_id,
                    occurred_at=comment.created_at,
                )
            )
            count += 1
        for user in User.objects.filter(email_verified_at__isnull=False).iterator(chunk_size=1_000):
            verified_at = user.email_verified_at
            if verified_at is None:
                continue
            _email_verified(
                UserEmailVerified(
                    user_id=user.id,
                    actor_id=user.id,
                    occurred_at=verified_at,
                )
            )
            count += 1
        earned_records = EarnedAchievement.objects.select_related("version", "definition")
        for earned in earned_records.iterator(chunk_size=1_000):
            _achievement_earned(
                AchievementEarned(
                    earned_id=earned.id,
                    user_id=earned.user_id,
                    definition_code=earned.definition.code,
                    title=earned.version.title_en,
                    earned_at=earned.earned_at,
                    occurred_at=earned.earned_at,
                )
            )
            count += 1
        return count
