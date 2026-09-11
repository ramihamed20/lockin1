import pytest
from django.contrib.auth.models import Group

from apps.accounts.roles import MANAGED_ROLES


@pytest.fixture(autouse=True)
def managed_role_groups(db: object) -> None:
    """Keep assessment fixtures usable by the documented SQLite fast-check mode."""
    for role in MANAGED_ROLES:
        Group.objects.get_or_create(name=role.value)
