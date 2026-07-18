from datetime import timedelta
from io import StringIO
from typing import Any, cast
from uuid import uuid4

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.accounts.tests.helpers import create_user
from apps.achievements.models import EarnedAchievement
from apps.achievements.services import record_evidence
from apps.notifications.models import Notification, NotificationPreference
from apps.notifications.services import (
    NotificationTargetUnavailable,
    create_notification,
    mark_all_read,
    mark_read,
    resolve_target,
    set_preferences,
)
from apps.progress.events import LessonCompleted
from apps.rankings.models import (
    RankingDefinition,
    RankingEntry,
    RankingFact,
    RankingProfile,
    RankingSnapshot,
)
from apps.rankings.selectors import current_ranking
from apps.rankings.services import build_snapshot, record_ranking_fact
from apps.streaks.services import record_activity
from apps.xp.models import XpBalance, XpTransaction
from apps.xp.services import award_xp, rebuild_balance
from platform_core.events import domain_events

pytestmark = pytest.mark.django_db


def test_lesson_event_connects_authoritative_engines_once(
    django_capture_on_commit_callbacks: Any,
) -> None:
    user = create_user()
    lesson_id = uuid4()
    event = LessonCompleted(user_id=user.id, lesson_id=lesson_id)

    with django_capture_on_commit_callbacks(execute=True):
        domain_events.publish(event)
        domain_events.publish(event)

    award = XpTransaction.objects.get(user=user)
    assert award.points == 50
    assert award.ranking_eligible is True
    assert XpBalance.objects.get(user=user).total_points == 50
    assert RankingFact.objects.get(user=user).source_transaction_id == award.id
    assert user.streak_state.current_days == 1
    earned = EarnedAchievement.objects.get(user=user, definition__code="first_step")
    assert (
        Notification.objects.get(recipient=user, template_key="achievement.earned").target_id
        == earned.id
    )


def test_xp_ledger_is_idempotent_and_balance_is_rebuildable() -> None:
    user = create_user()
    now = timezone.now()
    source_event_id = uuid4()
    source_object_id = uuid4()

    def apply_award() -> tuple[XpTransaction, bool]:
        return award_xp(
            user_id=user.id,
            source_key="lesson:stable",
            source_event_id=source_event_id,
            source_event_name="education.lesson_completed",
            source_object_id=source_object_id,
            rule_code="lesson_completed_v1",
            points=50,
            category="learning",
            reason="Lesson completed",
            occurred_at=now,
            ranking_eligible=True,
        )

    first, created = apply_award()
    repeated, repeated_created = apply_award()

    assert created is True
    assert repeated_created is False
    assert repeated.id == first.id
    XpBalance.objects.filter(user=user).update(total_points=999)
    rebuilt = rebuild_balance(user=user)
    assert rebuilt.total_points == 50
    assert rebuilt.ranking_points == 50


def test_streak_recomputes_deterministically_from_out_of_order_evidence() -> None:
    user = create_user()
    now = timezone.now()
    for offset in (0, 2, 1):
        state, created = record_activity(
            user_id=user.id,
            source_key=f"lesson:{offset}",
            activity_type="lesson.completed",
            source_object_id=uuid4(),
            occurred_at=now - timedelta(days=offset),
        )
        assert created is True
    state.refresh_from_db()
    assert state.current_days == 3
    assert state.longest_days == 3


def test_achievement_progress_uses_versioned_criteria_and_unique_award() -> None:
    user = create_user()
    now = timezone.now()
    evidence, created = record_evidence(
        user_id=user.id,
        source_key="focus:one",
        evidence_type="focus.minutes",
        source_object_id=uuid4(),
        value=60,
        occurred_at=now,
    )
    repeated, repeated_created = record_evidence(
        user_id=user.id,
        source_key="focus:one",
        evidence_type="focus.minutes",
        source_object_id=uuid4(),
        value=60,
        occurred_at=now,
    )
    assert created is True
    assert repeated_created is False
    assert repeated.id == evidence.id
    assert EarnedAchievement.objects.filter(user=user, definition__code="deep_focus").count() == 1


def test_ranking_snapshot_has_deterministic_ties_and_privacy() -> None:
    viewer = create_user(email="viewer@example.com", full_name="Viewer Learner")
    private = create_user(email="private@example.com", full_name="Private Learner")
    excluded = create_user(email="excluded@example.com", full_name="Excluded Learner")
    RankingProfile.objects.create(
        user=private, included=True, display_mode=RankingProfile.DisplayMode.ANONYMOUS
    )
    RankingProfile.objects.create(user=excluded, included=False)
    now = timezone.now()
    for user, points in ((viewer, 100), (private, 100), (excluded, 500)):
        record_ranking_fact(
            user_id=user.id,
            source_transaction_id=uuid4(),
            source_key=f"fact:{user.id}",
            points=points,
            category="learning",
            occurred_at=now,
        )
    definition = RankingDefinition.objects.get(code="learning_all_time")
    snapshot = build_snapshot(definition=definition)
    payload = current_ranking(viewer=viewer)

    assert snapshot.participant_count == 2
    entries = cast(list[dict[str, object]], payload["entries"])
    assert [entry["position"] for entry in entries] == [1, 1]
    private_entry = next(entry for entry in entries if not entry["is_me"])
    assert str(private_entry["display_name"]).startswith("Learner ")
    assert "Private" not in str(private_entry["display_name"])


def test_failed_ranking_build_leaves_an_auditable_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    definition = RankingDefinition.objects.get(code="learning_all_time")

    def fail_build(*args: object, **kwargs: object) -> None:
        raise RuntimeError("simulated calculation failure")

    monkeypatch.setattr(RankingEntry.objects, "bulk_create", fail_build)
    with pytest.raises(RuntimeError, match="simulated calculation failure"):
        build_snapshot(definition=definition)

    snapshot = RankingSnapshot.objects.get(definition=definition)
    assert snapshot.status == RankingSnapshot.Status.FAILED
    assert "simulated calculation failure" in snapshot.error


def test_notifications_enforce_dedup_preferences_ownership_and_safe_open() -> None:
    user = create_user()
    other = create_user(email="other@example.com")
    set_preferences(
        user=user,
        preferences=[
            {
                "category": Notification.Category.COMMUNITY,
                "channel": NotificationPreference.Channel.IN_APP,
                "enabled": False,
            }
        ],
    )
    skipped, created = create_notification(
        recipient_id=user.id,
        category=Notification.Category.COMMUNITY,
        template_key="community.reply",
        title="Reply",
        body="Body",
        deduplication_key="reply:1",
    )
    assert skipped is None
    assert created is False

    notification, created = create_notification(
        recipient_id=user.id,
        category=Notification.Category.ACCOUNT,
        template_key="account.notice",
        title="Account notice",
        body="Required body",
        deduplication_key="account:1",
        target_route="/security",
        required=True,
    )
    assert notification is not None and created is True
    repeated, repeated_created = create_notification(
        recipient_id=user.id,
        category=Notification.Category.ACCOUNT,
        template_key="account.notice",
        title="Changed title must not overwrite",
        body="Body",
        deduplication_key="account:1",
        target_route="/security",
        required=True,
    )
    assert repeated is not None and repeated.id == notification.id
    assert repeated_created is False
    with pytest.raises(Notification.DoesNotExist):
        mark_read(user=other, notification_id=notification.id)
    assert resolve_target(user=user, notification=notification) == "/security"
    mark_read(user=user, notification_id=notification.id)
    assert user.notification_counter.unread_count == 0
    assert mark_all_read(user=user) == 0

    notification.target_route = ""
    notification.save(update_fields=("target_route",))
    with pytest.raises(NotificationTargetUnavailable):
        resolve_target(user=user, notification=notification)


def test_required_account_preference_cannot_be_disabled() -> None:
    user = create_user()
    with pytest.raises(ValueError, match="cannot be disabled"):
        set_preferences(
            user=user,
            preferences=[
                {
                    "category": Notification.Category.ACCOUNT,
                    "channel": NotificationPreference.Channel.IN_APP,
                    "enabled": False,
                }
            ],
        )


def test_rebuild_command_reconciles_durable_ledgers_and_notifications() -> None:
    user = create_user()
    now = timezone.now()
    award, _ = award_xp(
        user_id=user.id,
        source_key="lesson:rebuild",
        source_event_id=uuid4(),
        source_event_name="education.lesson_completed",
        source_object_id=uuid4(),
        rule_code="lesson_completed_v1",
        points=50,
        category="learning",
        reason="Lesson completed",
        occurred_at=now,
        ranking_eligible=True,
    )
    record_evidence(
        user_id=user.id,
        source_key="lesson:rebuild",
        evidence_type="lesson.completed",
        source_object_id=uuid4(),
        value=1,
        occurred_at=now,
    )
    XpBalance.objects.filter(user=user).update(total_points=999)
    RankingFact.objects.all().delete()

    output = StringIO()
    call_command("rebuild_motivation", stdout=output)

    assert XpBalance.objects.get(user=user).total_points == 50
    assert RankingFact.objects.get(source_transaction_id=award.id).points == 50
    assert Notification.objects.filter(
        recipient=user,
        template_key="account.email_verified",
    ).exists()
    assert Notification.objects.filter(recipient=user, template_key="achievement.earned").exists()
    assert "Reconciled" in output.getvalue()
