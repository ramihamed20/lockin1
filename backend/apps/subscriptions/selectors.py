from django.db.models import QuerySet

from apps.accounts.models import User

from .models import Subscription, SubscriptionAccount


def account_for_user(*, user: User) -> SubscriptionAccount | None:
    return SubscriptionAccount.objects.filter(
        kind=SubscriptionAccount.Kind.INDIVIDUAL, primary_user=user
    ).first()


def subscriptions_for_user(*, user: User) -> QuerySet[Subscription]:
    return Subscription.objects.filter(account__primary_user=user).select_related(
        "account", "plan_version__plan__product"
    )


def current_subscription_for_user(*, user: User) -> Subscription | None:
    return subscriptions_for_user(user=user).order_by("-created_at").first()
