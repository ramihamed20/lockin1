import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.product_catalog.models import PlanVersion


class EntitlementDefinition(models.Model):
    class ValueType(models.TextChoices):
        BOOLEAN = "boolean", "Boolean access"
        QUANTITY = "quantity", "Quantity limit"
        CONFIGURATION = "configuration", "Configuration"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=80, unique=True)
    title = models.CharField(max_length=120)
    description = models.CharField(max_length=320, blank=True)
    value_type = models.CharField(
        max_length=16, choices=ValueType.choices, default=ValueType.BOOLEAN
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("code",)

    def __str__(self) -> str:
        return self.code


class PlanEntitlementRule(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan_version = models.ForeignKey(
        PlanVersion, on_delete=models.PROTECT, related_name="entitlement_rules"
    )
    entitlement = models.ForeignKey(
        EntitlementDefinition, on_delete=models.PROTECT, related_name="plan_rules"
    )
    quantity_limit = models.PositiveBigIntegerField(null=True, blank=True)
    configuration = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("plan_version", "entitlement"),
                name="entitlement_plan_rule_unique",
            )
        ]
        indexes = [
            models.Index(fields=("plan_version", "entitlement"), name="entitlement_plan_lookup_idx")
        ]

    def __str__(self) -> str:
        return f"{self.plan_version_id}:{self.entitlement.code}"


class EntitlementGrant(models.Model):
    class SourceType(models.TextChoices):
        SUBSCRIPTION = "subscription", "Subscription"
        MANUAL = "manual", "Administrator override"
        PROMOTION = "promotion", "Promotion (future)"
        FAMILY = "family", "Family (future)"
        ORGANIZATION = "organization", "Organization (future)"
        INSTITUTION = "institution", "Institution (future)"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        REVOKED = "revoked", "Revoked"
        EXPIRED = "expired", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="entitlement_grants"
    )
    entitlement = models.ForeignKey(
        EntitlementDefinition, on_delete=models.PROTECT, related_name="grants"
    )
    source_type = models.CharField(max_length=16, choices=SourceType.choices)
    source_id = models.UUIDField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    quantity_limit = models.PositiveBigIntegerField(null=True, blank=True)
    configuration = models.JSONField(default=dict, blank=True)
    granted_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revision = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ("entitlement__code", "-granted_at")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "entitlement", "source_type", "source_id"),
                name="entitlement_grant_source_unique",
            ),
            models.CheckConstraint(
                condition=Q(ends_at__isnull=True) | Q(ends_at__gt=models.F("starts_at")),
                name="entitlement_grant_window_valid",
            ),
        ]
        indexes = [
            models.Index(
                fields=("user", "entitlement", "status", "ends_at"),
                name="entitlement_access_check_idx",
            ),
            models.Index(
                fields=("source_type", "source_id", "status"),
                name="entitlement_source_state_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.entitlement.code}:{self.status}"


class EntitlementGrantAudit(models.Model):
    class Action(models.TextChoices):
        GRANTED = "granted", "Granted"
        UPDATED = "updated", "Updated"
        REVOKED = "revoked", "Revoked"
        EXPIRED = "expired", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    grant = models.ForeignKey(
        EntitlementGrant, on_delete=models.PROTECT, related_name="audit_entries"
    )
    action = models.CharField(max_length=12, choices=Action.choices)
    reason_code = models.CharField(max_length=80)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="entitlement_grant_actions",
    )
    source_reference = models.CharField(max_length=160, blank=True)
    snapshot = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")
        indexes = [models.Index(fields=("grant", "created_at"), name="entitlement_audit_time_idx")]

    def __str__(self) -> str:
        return f"{self.grant_id}:{self.action}"
