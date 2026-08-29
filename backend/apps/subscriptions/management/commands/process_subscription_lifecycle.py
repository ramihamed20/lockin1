from math import ceil

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.audit.services import record_audit
from apps.notifications.models import Notification
from apps.notifications.services import create_notification
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import refresh_subscription


class Command(BaseCommand):
    help = "Advance subscription lifecycle state and create deduplicated expiry reminders."

    def handle(self, *args: object, **options: object) -> None:
        now = timezone.now()
        transitioned = 0
        reminders = 0
        queryset = Subscription.objects.select_related(
            "account__primary_user", "plan_version"
        ).filter(account__primary_user__is_active=True)
        for subscription in queryset.filter(
            status__in=(
                Subscription.Status.TRIALING,
                Subscription.Status.ACTIVE,
                Subscription.Status.GRACE,
            )
        ).iterator(chunk_size=500):
            previous_status = subscription.status
            current = refresh_subscription(subscription=subscription, now=now)
            if current.status != previous_status:
                transitioned += 1
                if current.status == Subscription.Status.EXPIRED:
                    record_audit(
                        actor=None,
                        action="subscription_expired",
                        domain="subscriptions",
                        target_type="subscriptions.subscription",
                        target_id=str(current.id),
                        reason="The authoritative trial or grace window ended.",
                        source="subscriptions.scheduler",
                        previous_state={"status": previous_status},
                        new_state={"status": current.status},
                        related_entities=[
                            {
                                "type": "accounts.user",
                                "id": str(current.account.primary_user_id),
                            }
                        ],
                    )
                continue
            if current.status not in (
                Subscription.Status.TRIALING,
                Subscription.Status.ACTIVE,
            ):
                continue
            expiry = (
                current.trial_ends_at
                if current.status == Subscription.Status.TRIALING
                else current.current_period_ends_at
            )
            user_id = current.account.primary_user_id
            if expiry is None or user_id is None or expiry <= now:
                continue
            days = ceil((expiry - now).total_seconds() / 86_400)
            if days not in {7, 3, 1}:
                continue
            user = current.account.primary_user
            if user and user.preferred_language == "ar":
                title = "ينتهي الاشتراك غدًا" if days == 1 else f"متبقي {days} أيام"
                body = (
                    "ينتهي وصولك إلى Lock-in غدًا. جدّد الآن للحفاظ على تدفق دراستك."
                    if days == 1
                    else f"ينتهي وصولك إلى Lock-in خلال {days} أيام. يمكنك التجديد من الاشتراك."
                )
            else:
                title = (
                    "Subscription expires tomorrow" if days == 1 else f"{days} days remaining"
                )
                body = (
                    "Your Lock-in access expires tomorrow. Renew now to keep your study "
                    "flow uninterrupted."
                    if days == 1
                    else f"Your Lock-in access expires in {days} days. Renew from Subscription."
                )
            _, created = create_notification(
                recipient_id=user_id,
                category=Notification.Category.BILLING,
                template_key=f"billing.expiry.{days}_days",
                title=title,
                body=body,
                deduplication_key=(f"subscription-expiry:{current.id}:{expiry.isoformat()}:{days}"),
                target_type="subscription",
                target_id=current.id,
                target_route="/subscription",
                required=True,
            )
            reminders += int(created)
        self.stdout.write(
            self.style.SUCCESS(
                f"Processed subscriptions: {transitioned} transitions; {reminders} reminders."
            )
        )
