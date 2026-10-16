from django.conf import settings
from django.core.checks import Error, register

from .policies import USER_POLICY_VERSION, policy_effective_at


@register(deploy=True)
def approved_policy_activation(app_configs, **kwargs):  # type: ignore[no-untyped-def]
    if settings.ACCOUNT_POLICY_VERSION == USER_POLICY_VERSION and policy_effective_at() is None:
        return [
            Error(
                "Set USER_POLICY_EFFECTIVE_AT to the announced timezone-aware launch time.",
                id="accounts.E001",
            )
        ]
    return []
