from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.audit.services import record_audit
from apps.notifications.models import Notification
from apps.notifications.services import create_notification
from apps.product_catalog.dentistry_terms import FOUR_MONTHS, PRE_MIDTERM, PRE_MIDTERM_ENDS_AT
from apps.product_catalog.models import Plan
from apps.subscriptions.models import Subscription, SubscriptionTransition
from apps.subscriptions.services import transition_subscription


class Command(BaseCommand):
    help = (
        "Move live four-month subscriptions onto the pre-midterm term, ending on "
        "25 January 2027 or on their own later end. Dry run unless --apply."
    )

    def add_arguments(self, parser):  # type: ignore[no-untyped-def]
        parser.add_argument("--apply", action="store_true", help="Write the changes.")

    def handle(self, *args: object, **options: object) -> None:
        apply = bool(options["apply"])
        pre_midterm = Plan.objects.select_related("current_version").get(code=PRE_MIDTERM)
        version = pre_midterm.current_version
        if version is None:
            self.stderr.write("The pre-midterm plan has no published version.")
            return
        candidates = Subscription.objects.select_related(
            "account__primary_user", "plan_version__plan"
        ).filter(
            plan_version__plan__code=FOUR_MONTHS,
            status__in=(Subscription.Status.ACTIVE, Subscription.Status.GRACE),
        )
        converted = skipped = 0
        for subscription in candidates.order_by("created_at"):
            user = subscription.account.primary_user
            label = user.username if user else str(subscription.account_id)
            # A card still under review can be rejected, and a rejection
            # restores the subscription it found at submission. Converting it
            # now would let a refused payment keep the term.
            if subscription.payment_verification != Subscription.PaymentVerification.VERIFIED:
                skipped += 1
                self.stdout.write(f"skip  {label}: payment still under review")
                continue
            current_end = subscription.current_period_ends_at
            new_end = max(current_end, PRE_MIDTERM_ENDS_AT) if current_end else PRE_MIDTERM_ENDS_AT
            self.stdout.write(
                f"{'move' if apply else 'would move'} {label}: "
                f"{current_end.isoformat() if current_end else '-'} -> {new_end.isoformat()}"
            )
            if apply:
                self._convert(subscription=subscription, version=version, new_end=new_end)
            converted += 1
        verb = "Converted" if apply else "Would convert"
        self.stdout.write(
            self.style.SUCCESS(f"{verb} {converted}; skipped {skipped} awaiting review.")
        )

    @transaction.atomic
    def _convert(self, *, subscription: Subscription, version, new_end) -> None:  # type: ignore[no-untyped-def]
        locked = Subscription.objects.select_for_update().get(id=subscription.id)
        if locked.plan_version_id == version.id:
            return
        previous_plan = locked.plan_version_id
        previous_end = locked.current_period_ends_at
        locked.plan_version = version
        locked.save(update_fields=("plan_version", "updated_at"))
        now = timezone.now()
        result = transition_subscription(
            subscription_id=locked.id,
            to_status=Subscription.Status.ACTIVE,
            reason_code="four_month_converted",
            source=SubscriptionTransition.Source.ADMIN,
            effective_at=now,
            idempotency_key=f"four-month-convert:{locked.id}",
            period_started_at=locked.current_period_started_at,
            period_ends_at=new_end,
            allow_out_of_order=True,
        )
        record_audit(
            actor=None,
            action="subscription_plan_converted",
            domain="subscriptions",
            target_type="subscriptions.subscription",
            target_id=str(locked.id),
            reason="Four-month subscription moved to the pre-midterm term.",
            source="payments.convert_four_month_subscriptions",
            previous_state={"plan_version_id": previous_plan, "period_ends_at": previous_end},
            new_state={"plan_version_id": version.id, "period_ends_at": new_end},
        )
        user = locked.account.primary_user
        if user is None or not result.changed:
            return
        arabic = user.preferred_language == User.Language.ARABIC
        create_notification(
            recipient_id=user.id,
            category=Notification.Category.BILLING,
            template_key="billing.plan_converted.pre_midterm",
            title="اشتراكك أصبح «قبل النصفي»" if arabic else "You now have the pre-midterm plan",
            body=(
                "حوّلنا اشتراك الأربعة أشهر إلى خطة قبل النصفي. "
                "ويمكنك الترقية للعام الكامل بـ40 دينار فقط."
                if arabic
                else "Your four-month plan is now the pre-midterm plan. You can upgrade to the "
                "full year for just 40 LYD."
            ),
            deduplication_key=f"plan-converted:{locked.id}",
            target_type="subscription",
            target_id=locked.id,
            target_route="/subscription",
            required=True,
        )
