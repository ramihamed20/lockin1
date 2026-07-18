import re

ENTITLEMENT_CODE_PATTERN = re.compile(r"^[a-z][a-z0-9_.-]{2,79}$")


def validate_entitlement_code(value: str) -> str:
    normalized = value.strip().lower()
    if not ENTITLEMENT_CODE_PATTERN.fullmatch(normalized):
        raise ValueError("Entitlement codes use lowercase namespaced identifiers.")
    return normalized
