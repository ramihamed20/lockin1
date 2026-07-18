import uuid

from django.conf import settings
from django.db import models


class OperationalCapability(models.Model):
    code = models.CharField(max_length=80, primary_key=True)
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=300)

    class Meta:
        ordering = ("code",)

    def __str__(self) -> str:
        return self.code


class OperationalRole(models.Model):
    code = models.CharField(max_length=40, primary_key=True)
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=300)
    capabilities = models.ManyToManyField(OperationalCapability, related_name="roles")

    class Meta:
        ordering = ("code",)

    def __str__(self) -> str:
        return self.code


class OperationalRoleAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="operational_role_assignments",
    )
    role = models.ForeignKey(OperationalRole, on_delete=models.PROTECT, related_name="assignments")
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="operational_roles_granted",
    )
    reason = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("user_id", "role_id")
        constraints = [
            models.UniqueConstraint(fields=("user", "role"), name="administration_user_role_unique")
        ]
        indexes = [models.Index(fields=("role", "user"), name="admin_role_user_idx")]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.role_id}"
