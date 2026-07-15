import pytest
from django.core.exceptions import ValidationError

from apps.accounts.models import User


@pytest.mark.django_db
def test_user_manager_normalizes_email_and_name() -> None:
    user = User.objects.create_user(
        email="  Student@Example.COM ", full_name="  Lock In  ", password="test-pass-123"
    )

    assert user.email == "student@example.com"
    assert user.full_name == "Lock In"
    assert user.check_password("test-pass-123")
    assert not user.is_staff


@pytest.mark.django_db
def test_superuser_has_required_permissions() -> None:
    user = User.objects.create_superuser(
        email="admin@example.com", full_name="Admin", password="test-pass-123"
    )

    assert user.is_staff
    assert user.is_superuser


@pytest.mark.django_db
def test_account_status_drives_authentication_flag() -> None:
    user = User.objects.create_user("student@example.com", "Student")
    user.status = User.Status.SUSPENDED
    user.save()

    assert not user.is_active


@pytest.mark.django_db
def test_email_is_unique_after_normalization() -> None:
    User.objects.create_user("student@example.com", "Student")

    with pytest.raises(ValidationError):
        User.objects.create_user("STUDENT@EXAMPLE.COM", "Other")
