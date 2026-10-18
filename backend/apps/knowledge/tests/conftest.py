import pytest
from django.contrib.auth.models import Group

from apps.accounts.roles import Role
from apps.entitlements.models import EntitlementDefinition

from .test_api import private_media, setup  # noqa: F401


@pytest.fixture(autouse=True)
def knowledge_reference_data(db):
    """Transaction-test flushes remove migration-seeded reference rows."""
    del db
    for role in Role:
        Group.objects.get_or_create(name=role.value)
    EntitlementDefinition.objects.get_or_create(
        code="focus.workspace",
        defaults={
            "title": "Focus workspace",
            "value_type": "boolean",
            "is_active": True,
            "description": "Professional document study workspace.",
        },
    )
