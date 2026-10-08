from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.admin_control.selectors import operational_analytics
from apps.admin_control.tests.test_purchase_query_budget import _payment
from apps.focus.models import FocusSession
from apps.payments.models import ManualRechargeSubmission, Payment

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("legacy_duration_prices")]


def test_user_and_manual_review_metrics_keep_their_scopes_in_fewer_queries() -> None:
    now = timezone.now()
    end = now.date()
    start = end - timedelta(days=7)
    active = create_user(email="analytics-active@example.com", last_login=now)
    create_user(
        email="analytics-suspended@example.com", verified=False, status=User.Status.SUSPENDED
    )
    User.objects.filter(id=active.id).update(date_joined=now - timedelta(days=30))
    for duration in (60, 120):
        FocusSession.objects.create(
            user=active,
            active_duration_seconds=duration,
            status=FocusSession.Status.COMPLETED,
            started_at=now - timedelta(minutes=5),
            ended_at=now,
        )
    payment = _payment(0, ("analytics-synthetic-card",))
    manual = payment.manual_submission
    # A queue must include pending reviews from before the reporting period.
    ManualRechargeSubmission.objects.filter(id=manual.id).update(
        submitted_at=now - timedelta(days=30)
    )
    with CaptureQueriesContext(connection) as queries:
        payload = operational_analytics(start=start, end=end)
    assert payload["users"]["total"] == 3
    assert payload["users"]["verified"] == 2
    assert payload["users"]["suspended"] == 1
    assert payload["users"]["active_today"] == 1
    assert payload["users"]["returning"] == 1
    assert payload["users"]["new_registrations"] == 2
    assert payload["manual_reviews"]["pending"] == 1
    assert payload["manual_reviews"]["approved"] == 0
    assert payload["manual_reviews"]["oldest_pending_at"] == now - timedelta(days=30)
    assert payload["learning"]["active_learners"] == 1
    assert payload["learning"]["focus_sessions"] == 2
    assert payload["learning"]["focus_seconds"] == 180
    assert payload["learning"]["average_focus_seconds"] == 90
    assert len(queries) <= 28, len(queries)


def test_creator_collections_do_not_multiply_counts_or_query_growth() -> None:
    from django.contrib.auth.models import Group

    from apps.accounts.roles import Role
    from apps.assessments.models import Quiz
    from apps.content.models import LearningObject
    from apps.questions.models import Question

    now = timezone.now()
    creator = create_user(email="analytics-creator@example.test")
    creator.groups.add(Group.objects.get(name=Role.CREATOR.value))
    unrelated = create_user(email="analytics-noncreator@example.test")
    for model in (LearningObject, Question, Quiz):
        model.objects.create(owner=creator)
        model.objects.create(owner=unrelated)
    with CaptureQueriesContext(connection) as first:
        initial = operational_analytics(start=now.date(), end=now.date())
    for model in (LearningObject, Question, Quiz):
        model.objects.bulk_create([model(owner=creator) for _ in range(20)])
    with CaptureQueriesContext(connection) as many:
        expanded = operational_analytics(start=now.date(), end=now.date())
    assert initial["creators"]["active"] == expanded["creators"]["active"] == 1
    assert initial["creators"]["total"] == expanded["creators"]["total"] == 1
    assert len(first) == len(many) <= 28


def test_revenue_keeps_legacy_null_primary_user_distinct_count() -> None:
    from apps.subscriptions.models import SubscriptionAccount

    now = timezone.now()
    payment = _payment(720001, ("synthetic-legacy-payer",))
    SubscriptionAccount.objects.filter(pk=payment.account_id).update(
        kind=SubscriptionAccount.Kind.INSTITUTION, primary_user=None
    )
    Payment.objects.filter(pk=payment.pk).update(status="succeeded", succeeded_at=now)
    payload = operational_analytics(start=now.date(), end=now.date())
    assert payload["revenue"]["paying_users"] == 1
