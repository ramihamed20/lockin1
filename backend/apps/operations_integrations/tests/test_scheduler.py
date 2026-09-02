from datetime import timedelta
from io import StringIO
from typing import Any
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.core.management import CommandError, call_command
from django.utils import timezone

from apps.accounts.models import AccountSession, AuthAttempt, OAuthFlow, OneTimeToken
from apps.accounts.tests.helpers import create_user
from apps.operations_integrations.management.commands.run_operations_scheduler import JobSpec
from apps.operations_integrations.models import ScheduledJobState
from apps.operations_integrations.services import (
    JobClaim,
    claim_scheduled_job,
    finish_scheduled_job,
)
from platform_core.observability import providers

pytestmark = pytest.mark.django_db


class CapturingMetrics:
    def __init__(self) -> None:
        self.names: list[str] = []

    def increment(
        self, name: str, *, value: int = 1, attributes: dict[str, str] | None = None
    ) -> None:
        del value, attributes
        self.names.append(name)

    def observe(self, name: str, *, value: float, attributes: dict[str, str] | None = None) -> None:
        del value, attributes
        self.names.append(name)


class CapturingErrors:
    def __init__(self) -> None:
        self.jobs: list[str] = []

    def capture_exception(self, error: Exception, *, context: dict[str, Any]) -> None:
        del error
        self.jobs.append(str(context["job"]))


def test_scheduled_job_claim_is_atomic_leased_and_token_protected() -> None:
    claim = claim_scheduled_job(code="example", interval_seconds=60, lease_seconds=300)

    assert claim is not None
    assert claim_scheduled_job(code="example", interval_seconds=60, lease_seconds=300) is None
    assert (
        finish_scheduled_job(
            claim=JobClaim(code="example", token=uuid4(), started_at=timezone.now()),
            succeeded=True,
            duration_ms=4,
        )
        is False
    )
    assert finish_scheduled_job(claim=claim, succeeded=True, duration_ms=4) is True

    state = ScheduledJobState.objects.get(code="example")
    assert state.status == ScheduledJobState.Status.SUCCEEDED
    assert state.run_count == 1
    assert state.last_succeeded_at is not None


def test_scheduler_isolates_failures_and_records_health() -> None:
    metrics = CapturingMetrics()
    errors = CapturingErrors()
    previous_metrics = providers.metric_sink
    previous_errors = providers.error_reporter
    jobs = (
        JobSpec("successful", "successful_command", "SUCCESS_INTERVAL", 60, dict),
        JobSpec("failed", "failed_command", "FAILED_INTERVAL", 60, dict),
    )
    output = StringIO()
    try:
        providers.set_metric_sink(metrics)
        providers.set_error_reporter(errors)
        with (
            patch(
                "apps.operations_integrations.management.commands.run_operations_scheduler.JOBS",
                jobs,
            ),
            patch(
                "apps.operations_integrations.management.commands.run_operations_scheduler.call_command",
                side_effect=[None, CommandError("safe test failure")],
            ) as nested,
        ):
            call_command("run_operations_scheduler", once=True, stdout=output)
    finally:
        providers.set_metric_sink(previous_metrics)
        providers.set_error_reporter(previous_errors)

    assert nested.call_count == 2
    assert ScheduledJobState.objects.get(code="successful").status == "succeeded"
    failed = ScheduledJobState.objects.get(code="failed")
    assert failed.status == "failed"
    assert failed.failure_count == 1
    assert failed.last_error_code == "CommandError"
    assert errors.jobs == ["failed"]
    assert "operations.job.succeeded" in metrics.names
    assert "operations.job.failed" in metrics.names


def test_operational_cleanup_deletes_expired_records_and_preserves_current_records() -> None:
    now = timezone.now()
    old = now - timedelta(days=40)
    future = now + timedelta(days=1)
    user = create_user(email="cleanup@example.com")
    AuthAttempt.objects.create(scope="login", key_hash="old", attempted_at=old)
    AuthAttempt.objects.create(scope="login", key_hash="current", attempted_at=now)
    AccountSession.objects.create(
        user=user,
        session_key="expired-session",
        device_label="Old browser",
        expires_at=old,
    )
    OneTimeToken.objects.create(
        user=user,
        kind=OneTimeToken.Kind.PASSWORD_RESET,
        token_digest="a" * 64,
        expires_at=old,
    )
    OAuthFlow.objects.create(
        provider="google",
        intent=OAuthFlow.Intent.LOGIN,
        state_digest="state",
        nonce_digest="nonce",
        browser_binding_digest="browser",
        expires_at=old,
    )
    OAuthFlow.objects.create(
        provider="google",
        intent=OAuthFlow.Intent.LOGIN,
        state_digest="future-state",
        nonce_digest="future-nonce",
        browser_binding_digest="future-browser",
        expires_at=future,
    )

    call_command("cleanup_operational_data")

    assert not AuthAttempt.objects.filter(key_hash="old").exists()
    assert AuthAttempt.objects.filter(key_hash="current").exists()
    assert not AccountSession.objects.filter(session_key="expired-session").exists()
    assert not OneTimeToken.objects.filter(token_digest="a" * 64).exists()
    assert OAuthFlow.objects.count() == 1
