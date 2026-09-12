"""A plan that can be bought must grant what it is sold as granting.

``sync_subscription_entitlements`` derives the entitlements a subscription
should hold from its plan version's rules and revokes everything outside that
set. A purchasable plan version with no rules therefore does not merely grant
nothing extra -- it strips the reader of every study entitlement they had, in
the same transaction that records their payment as successful.

Four plans shipped in exactly that state (the 5 LYD first month and the two,
three and four month offers), so a reader who paid ended up ACTIVE, VERIFIED and
locked out of the product. These tests fail on any future plan that repeats it.
"""

import pytest

from apps.accounts.tests.helpers import create_user
from apps.entitlements.models import PlanEntitlementRule
from apps.entitlements.services import entitlement_decision, sync_subscription_entitlements
from apps.product_catalog.models import Price
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import create_trial_for_user

pytestmark = pytest.mark.django_db

STUDY_ENTITLEMENTS = {"focus.workspace", "content.premium", "files.download"}


def _purchasable_versions():
    return {
        price.plan_version_id: price.plan_version
        for price in Price.objects.filter(status=Price.Status.ACTIVE).select_related(
            "plan_version__plan"
        )
    }.values()


def test_every_purchasable_plan_version_grants_the_study_entitlements() -> None:
    versions = list(_purchasable_versions())
    assert versions, "the catalog must publish at least one purchasable plan"

    missing = {}
    for version in versions:
        granted = set(
            PlanEntitlementRule.objects.filter(
                plan_version=version, entitlement__is_active=True
            ).values_list("entitlement__code", flat=True)
        )
        if not granted >= STUDY_ENTITLEMENTS:
            missing[version.plan.code] = sorted(STUDY_ENTITLEMENTS - granted)

    assert missing == {}, (
        f"These purchasable plans grant no study access, so paying for one revokes it: {missing}"
    )


def test_moving_a_subscription_onto_any_purchasable_plan_keeps_access() -> None:
    """The failure mode, reproduced through the service that caused it."""

    for index, version in enumerate(_purchasable_versions()):
        user = create_user(email=f"plan-cover-{index}@example.com", username=f"plan_cover_{index}")
        subscription, _ = create_trial_for_user(user=user, source_reference="plan-coverage")
        assert entitlement_decision(user=user, entitlement_code="content.premium").allowed is True

        # Exactly what a manual payment does to the subscription before the
        # entitlement state is recalculated.
        subscription.plan_version = version
        subscription.status = Subscription.Status.ACTIVE
        subscription.save(update_fields=("plan_version", "status", "updated_at"))
        sync_subscription_entitlements(subscription_id=subscription.id)

        for code in sorted(STUDY_ENTITLEMENTS):
            decision = entitlement_decision(user=user, entitlement_code=code)
            assert decision.allowed is True, (
                f"paying for {version.plan.code} revoked {code} ({decision.reason})"
            )
