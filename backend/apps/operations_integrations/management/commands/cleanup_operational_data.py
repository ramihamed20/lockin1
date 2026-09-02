from datetime import timedelta

from django.conf import settings
from django.contrib.sessions.models import Session
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import AccountSession, AuthAttempt, OAuthFlow, OneTimeToken
from apps.community.models import CommunityRateBucket
from apps.moderation.models import ModerationRateBucket


class Command(BaseCommand):
    help = "Delete bounded, expired operational records according to configured retention."

    def handle(self, *args: object, **options: object) -> None:
        del args, options
        now = timezone.now()
        retention_days = max(1, int(getattr(settings, "OPERATIONAL_DATA_RETENTION_DAYS", 30)))
        cutoff = now - timedelta(days=retention_days)
        deleted = {
            "django_sessions": Session.objects.filter(expire_date__lte=now).delete()[0],
            "account_sessions": AccountSession.objects.filter(expires_at__lte=now).delete()[0],
            "one_time_tokens": OneTimeToken.objects.filter(expires_at__lte=cutoff).delete()[0],
            "oauth_flows": OAuthFlow.objects.filter(expires_at__lte=cutoff).delete()[0],
            "auth_attempts": AuthAttempt.objects.filter(attempted_at__lte=cutoff).delete()[0],
            "community_rate_buckets": CommunityRateBucket.objects.filter(
                window_started_at__lte=cutoff
            ).delete()[0],
            "moderation_rate_buckets": ModerationRateBucket.objects.filter(
                window_started_at__lte=cutoff
            ).delete()[0],
        }
        summary = ", ".join(f"{key}={value}" for key, value in deleted.items())
        self.stdout.write(self.style.SUCCESS(f"Operational cleanup complete: {summary}"))
