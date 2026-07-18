import uuid
from typing import Any

from django.db import models
from django.db.models import Q


class Product(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.SlugField(max_length=60, unique=True)
    title = models.CharField(max_length=120)
    description = models.CharField(max_length=320, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("code",)

    def __str__(self) -> str:
        return self.code


class Plan(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="plans")
    code = models.SlugField(max_length=60, unique=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    current_version = models.OneToOneField(
        "PlanVersion",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("product__code", "code")
        indexes = [models.Index(fields=("product", "status"), name="catalog_plan_status_idx")]

    def __str__(self) -> str:
        return self.code


class PlanVersion(models.Model):
    class Audience(models.TextChoices):
        INDIVIDUAL = "individual", "Individual"
        FAMILY = "family", "Family (future)"
        ORGANIZATION = "organization", "Organization (future)"
        INSTITUTION = "institution", "Institution (future)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="versions")
    version = models.PositiveIntegerField()
    title = models.CharField(max_length=120)
    description = models.CharField(max_length=320, blank=True)
    audience = models.CharField(
        max_length=16, choices=Audience.choices, default=Audience.INDIVIDUAL
    )
    trial_days = models.PositiveSmallIntegerField(default=0)
    grace_days = models.PositiveSmallIntegerField(default=0)
    terms = models.JSONField(default=dict, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("plan__code", "-version")
        constraints = [
            models.UniqueConstraint(fields=("plan", "version"), name="catalog_plan_version_unique")
        ]

    def __str__(self) -> str:
        return f"{self.plan.code}:v{self.version}"


class Price(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"

    class Interval(models.TextChoices):
        DAY = "day", "Day"
        MONTH = "month", "Month"
        YEAR = "year", "Year"

    class TaxBehavior(models.TextChoices):
        UNSPECIFIED = "unspecified", "Unspecified"
        INCLUSIVE = "inclusive", "Inclusive"
        EXCLUSIVE = "exclusive", "Exclusive"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan_version = models.ForeignKey(PlanVersion, on_delete=models.PROTECT, related_name="prices")
    code = models.SlugField(max_length=80, unique=True)
    amount_minor = models.PositiveBigIntegerField()
    currency = models.CharField(max_length=3)
    currency_exponent = models.PositiveSmallIntegerField(default=2)
    region_code = models.CharField(max_length=2, blank=True)
    interval = models.CharField(max_length=8, choices=Interval.choices)
    interval_count = models.PositiveSmallIntegerField(default=1)
    tax_behavior = models.CharField(
        max_length=12, choices=TaxBehavior.choices, default=TaxBehavior.UNSPECIFIED
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    valid_from = models.DateTimeField(null=True, blank=True)
    valid_until = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("currency", "region_code", "amount_minor")
        constraints = [
            models.CheckConstraint(condition=Q(amount_minor__gt=0), name="catalog_price_positive"),
            models.CheckConstraint(
                condition=Q(interval_count__gt=0), name="catalog_price_interval_positive"
            ),
            models.CheckConstraint(
                condition=Q(currency_exponent__lte=4), name="catalog_currency_exponent_valid"
            ),
            models.CheckConstraint(
                condition=Q(valid_until__isnull=True)
                | Q(valid_from__isnull=True)
                | Q(valid_until__gt=models.F("valid_from")),
                name="catalog_price_valid_window",
            ),
        ]
        indexes = [
            models.Index(
                fields=("plan_version", "status", "currency", "region_code"),
                name="catalog_price_offer_idx",
            ),
            models.Index(fields=("status", "valid_until"), name="catalog_price_expiry_idx"),
        ]

    def __str__(self) -> str:
        return self.code

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.currency = self.currency.upper()
        self.region_code = self.region_code.upper()
        super().save(*args, **kwargs)
