from typing import Any

from django.conf import settings
from django.db import models


class ConfigurationEntry(models.Model):
    class ValueType(models.TextChoices):
        INTEGER = "integer", "Integer"
        BOOLEAN = "boolean", "Boolean"
        STRING = "string", "String"

    key = models.CharField(max_length=100, primary_key=True)
    value_type = models.CharField(max_length=12, choices=ValueType.choices)
    value = models.JSONField()
    version = models.PositiveBigIntegerField(default=1)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="configuration_updates",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("key",)

    def __str__(self) -> str:
        return self.key

    def save(self, *args: Any, **kwargs: Any) -> None:
        if not self.key or self.key.startswith("secret."):
            raise ValueError("Secret material cannot be stored in system configuration.")
        super().save(*args, **kwargs)
