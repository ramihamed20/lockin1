from typing import Any

from django.db import transaction

from apps.accounts.models import User
from apps.audit.services import record_audit

from .catalog import DEFINITIONS, ConfigurationDefinition
from .models import ConfigurationEntry


class ConfigurationError(ValueError):
    pass


def validate_configuration_value(*, definition: ConfigurationDefinition, value: Any) -> Any:
    if definition.value_type == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ConfigurationError("This configuration requires an integer value.")
        if definition.minimum is not None and value < definition.minimum:
            raise ConfigurationError(f"The value must be at least {definition.minimum}.")
        if definition.maximum is not None and value > definition.maximum:
            raise ConfigurationError(f"The value must be at most {definition.maximum}.")
        return value
    if definition.value_type == "boolean":
        if not isinstance(value, bool):
            raise ConfigurationError("This configuration requires a boolean value.")
        return value
    if definition.value_type == "string":
        if not isinstance(value, str) or len(value) > 500:
            raise ConfigurationError("This configuration requires a string up to 500 characters.")
        return value.strip()
    raise ConfigurationError("The configuration type is unsupported.")


def get_configuration_value(key: str) -> Any:
    definition = DEFINITIONS.get(key)
    if definition is None:
        raise ConfigurationError("Unknown configuration key.")
    try:
        return ConfigurationEntry.objects.only("value").get(key=key).value
    except ConfigurationEntry.DoesNotExist:
        return definition.default


@transaction.atomic
def update_configuration(
    *, key: str, value: Any, expected_version: int, actor: User, reason: str, source: str
) -> ConfigurationEntry:
    definition = DEFINITIONS.get(key)
    if definition is None:
        raise ConfigurationError("Unknown configuration key.")
    reason = reason.strip()
    if len(reason) < 8:
        raise ConfigurationError("A reason of at least 8 characters is required.")
    validated = validate_configuration_value(definition=definition, value=value)
    entry, _ = ConfigurationEntry.objects.select_for_update().get_or_create(
        key=key,
        defaults={"value_type": definition.value_type, "value": definition.default},
    )
    if entry.version != expected_version:
        raise ConfigurationError("Configuration changed since it was loaded.")
    previous = entry.value
    entry.value = validated
    entry.value_type = definition.value_type
    entry.version += 1
    entry.updated_by = actor
    entry.save(update_fields=("value", "value_type", "version", "updated_by", "updated_at"))
    record_audit(
        actor=actor,
        action="system_configuration.updated",
        domain="system_configuration",
        target_type="system_configuration.entry",
        target_id=key,
        reason=reason,
        source=source,
        previous_state={"value": previous, "version": expected_version},
        new_state={"value": validated, "version": entry.version},
    )
    return entry
