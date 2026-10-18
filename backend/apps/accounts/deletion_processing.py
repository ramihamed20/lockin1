"""Operator-reviewed erasure; no automatic production deletion is scheduled."""

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from django.apps import apps
from django.conf import settings
from django.db import models, transaction
from django.db.models.deletion import Collector, ProtectedError
from django.utils import timezone

from apps.audit.services import record_audit
from apps.files.models import ManagedFile
from apps.subscriptions.models import SubscriptionAccount

from .models import AccountDeletionRequest, AccountEmailDelivery, OneTimeToken, SocialIdentity, User
from .personal_data import personal_queries
from .roles import Role, user_has_role
from .services import invalidate_sessions


def deletion_preview(request: AccountDeletionRequest) -> dict[str, Any]:
    return {
        "request_id": str(request.id),
        "status": request.status,
        "personal_rows": {
            label: query.count() for label, query in personal_queries(request.user).items()
        },
        "managed_files": ManagedFile.objects.filter(owner=request.user).count(),
        "retained": ["pseudonymous financial references", "required security/audit evidence"],
        "requires": [
            "approved retention policy version",
            "record-specific legal basis and expiry",
            "review/removal of shared or published content",
            "backup restore replay",
        ],
    }


def _check_shared(user: User) -> None:
    for label, field in (
        ("content.LearningObject", "owner"),
        ("questions.Question", "owner"),
        ("assessments.Quiz", "owner"),
        ("community.CommunitySpace", "owner"),
        ("community.Discussion", "author"),
        ("community.Comment", "author"),
    ):
        if apps.get_model(label).objects.filter(**{field: user}).exists():
            raise ValueError(
                f"Review/remove or transfer shared or published content first: {label}."
            )
    team = apps.get_model("focus.FocusTeam")
    membership = apps.get_model("focus.FocusTeamMembership")
    if (
        membership.objects.filter(team__in=team.objects.filter(owner=user))
        .exclude(user=user)
        .exists()
    ):
        raise ValueError("Transfer the shared focus team before erasing this account.")


def _delete_owned(query: models.QuerySet[Any], user: User) -> None:
    collector = Collector(using=query.db)
    collector.collect(list(query))
    ownership = {"user", "owner", "author", "recipient", "requested_by"}
    for model, rows in collector.data.items():
        fields = [
            field
            for field in model._meta.fields
            if field.remote_field is not None
            and field.remote_field.model is User
            and field.name in ownership
        ]
        if any(
            getattr(row, field.attname) not in {None, user.id} for row in rows for field in fields
        ):
            raise ValueError(f"Review shared data before erasure: {model._meta.label}.")
    for fast in collector.fast_deletes:
        for field in fast.model._meta.fields:
            if (
                field.remote_field is not None
                and field.remote_field.model is User
                and field.name in ownership
                and fast.exclude(**{field.name: user})
                .filter(**{f"{field.name}__isnull": False})
                .exists()
            ):
                raise ValueError(f"Review shared data before erasure: {fast.model._meta.label}.")
    collector.delete()


@transaction.atomic
def begin_deletion(
    *, request_id: UUID, actor: User, retention_reason: str, retained_until: datetime
) -> AccountDeletionRequest:
    if (
        not actor.is_active
        or actor.status != User.Status.ACTIVE
        or not user_has_role(actor, Role.ADMINISTRATOR)
    ):
        raise ValueError("An administrator must review account erasure.")
    policy = str(getattr(settings, "ACCOUNT_DELETION_POLICY_VERSION", ""))
    if not policy or len(retention_reason.strip()) < 20 or retained_until <= timezone.now():
        raise ValueError(
            "Approve the retention matrix and provide a specific legal basis and expiry first."
        )
    request = (
        AccountDeletionRequest.objects.select_for_update().select_related("user").get(id=request_id)
    )
    if request.status == AccountDeletionRequest.Status.COMPLETED:
        return request
    if request.status not in {
        AccountDeletionRequest.Status.CONFIRMED,
        AccountDeletionRequest.Status.PROCESSING,
    }:
        raise ValueError("Only a verified request can be processed.")
    _check_shared(request.user)
    if user_has_role(request.user, Role.ADMINISTRATOR):
        raise ValueError("Transfer administrator responsibilities before erasing an administrator.")
    request.status = AccountDeletionRequest.Status.PROCESSING
    request.processing_started_at = request.processing_started_at or timezone.now()
    request.policy_version = policy
    request.retention_reason = retention_reason.strip()
    request.retained_until = retained_until
    request.processing_note = (
        "جارٍ حذف البيانات الشخصية. تُحفظ فقط السجلات المحددة لسبب قانوني، "
        "ولا يعني تأكيد الطلب اكتمال الحذف."
    )
    request.save()
    user = User.objects.select_for_update().get(id=request.user_id)
    user.status = User.Status.SUSPENDED
    user.is_active = False
    user.save(update_fields=("status", "is_active", "updated_at"))
    invalidate_sessions(user=user)
    OneTimeToken.objects.filter(user=user, used_at__isnull=True).update(used_at=timezone.now())
    record_audit(
        actor=actor,
        action="account.deletion.processing",
        domain="accounts",
        target_type="accounts.account_deletion_request",
        target_id=str(request.id),
        reason=retention_reason[:500],
        source="accounts.erasure_operator",
        new_state={"policy_version": policy, "retained_until": retained_until.isoformat()},
    )
    return request


@transaction.atomic
def erase_personal_data(*, request_id: UUID, actor: User) -> AccountDeletionRequest:
    if (
        not actor.is_active
        or actor.status != User.Status.ACTIVE
        or not user_has_role(actor, Role.ADMINISTRATOR)
    ):
        raise ValueError("An administrator must process erasure.")
    request = (
        AccountDeletionRequest.objects.select_for_update().select_related("user").get(id=request_id)
    )
    if request.status == AccountDeletionRequest.Status.COMPLETED:
        return request
    if request.status != AccountDeletionRequest.Status.PROCESSING or not request.retained_until:
        raise ValueError("Review and begin the verified request first.")
    user = User.objects.select_for_update().get(id=request.user_id)
    _check_shared(user)
    # Freeze IDs before parents with SET_NULL children can disappear.
    selected = {
        label: list(query.values_list("pk", flat=True))
        for label, query in personal_queries(user).items()
    }
    files = list(ManagedFile.objects.filter(owner=user))
    blobs = [item.blob for item in files if item.blob]
    for label, ids in selected.items():
        model = apps.get_model(label)
        file_fields = [field for field in model._meta.fields if isinstance(field, models.FileField)]
        if file_fields:
            blobs.extend(
                getattr(row, field.name)
                for row in model.objects.filter(pk__in=ids)
                for field in file_fields
                if getattr(row, field.name)
            )
    # Protected child rows are removed before their parents; never bypass PROTECT
    # against an unreviewed record outside this explicit boundary.
    remaining = {label: ids for label, ids in selected.items() if ids}
    while remaining:
        progress = False
        for label, ids in list(remaining.items()):
            model = apps.get_model(label)
            try:
                with transaction.atomic():
                    for field in model._meta.fields:
                        if (
                            getattr(field, "remote_field", None)
                            and field.remote_field.model is model
                            and field.null
                        ):
                            model.objects.filter(pk__in=ids).update(**{field.name: None})
                    _delete_owned(model.objects.filter(pk__in=ids), user)
            except ProtectedError:
                continue
            del remaining[label]
            progress = True
        if not progress:
            raise ValueError(
                "Operator review is required for protected personal records: "
                + ", ".join(remaining)
            )
    AccountEmailDelivery.objects.filter(token__user=user).delete()
    SocialIdentity.objects.filter(user=user).delete()
    # Keep the consumed confirmation token as evidence, not as a reusable secret.
    OneTimeToken.objects.filter(user=user, account_deletion_request__isnull=True).delete()
    OneTimeToken.objects.filter(user=user).update(payload={})
    user.profile_image = None
    user.email = f"deleted-{uuid4().hex}@deleted.invalid"
    user.username = None
    user.full_name = ""
    user.cohort = None
    user.email_verified_at = None
    user.last_login = None
    user.welcome_completed_at = None
    user.avatar_default = ""
    user.is_staff = False
    user.is_superuser = False
    user.is_active = False
    user.status = User.Status.DELETED
    user.set_unusable_password()
    user.save()
    user.groups.clear()
    user.user_permissions.clear()
    apps.get_model("administration.OperationalRoleAssignment").objects.filter(user=user).delete()
    apps.get_model("administration.OperationalCapabilityAssignment").objects.filter(
        user=user
    ).delete()
    SubscriptionAccount.objects.filter(primary_user=user).update(display_name="Deleted account")
    ManagedFile.objects.filter(owner=user).delete()  # Protected published files stop completion.
    # A failed object-store delete leaves PROCESSING, so a retry is honest and
    # safe. The account was disabled in the separately committed begin step.
    for blob in blobs:
        blob.storage.delete(blob.name)
    request.status = AccountDeletionRequest.Status.COMPLETED
    request.completed_at = timezone.now()
    request.processing_note = (
        "اكتمل حذف البيانات الشخصية والأعمال الخاضعة للمعالجة. "
        "السجلات القانونية المستثناة محدودة بالسبب والمدة المسجلين."
    )
    request.save(update_fields=("status", "completed_at", "processing_note"))
    record_audit(
        actor=actor,
        action="account.deletion.completed",
        domain="accounts",
        target_type="accounts.account_deletion_request",
        target_id=str(request.id),
        reason="Personal learning data and eligible media erased; direct identity replaced.",
        source="accounts.erasure_operator",
        new_state={"completed_at": request.completed_at.isoformat()},
    )
    return request
