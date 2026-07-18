from typing import Any

from .catalog import DEFINITIONS
from .models import ConfigurationEntry


def configuration_catalog() -> list[dict[str, Any]]:
    stored = {entry.key: entry for entry in ConfigurationEntry.objects.all()}
    results: list[dict[str, Any]] = []
    for definition in DEFINITIONS.values():
        entry = stored.get(definition.key)
        results.append(
            {
                "key": definition.key,
                "name": definition.name,
                "description": definition.description,
                "value_type": definition.value_type,
                "value": entry.value if entry is not None else definition.default,
                "version": entry.version if entry is not None else 1,
                "minimum": definition.minimum,
                "maximum": definition.maximum,
                "updated_at": entry.updated_at if entry is not None else None,
            }
        )
    return results
