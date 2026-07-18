import re

CODE_PATTERN = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*$")
CURRENCY_PATTERN = re.compile(r"^[A-Z]{3}$")
REGION_PATTERN = re.compile(r"^[A-Z]{2}$")


def validate_catalog_code(value: str) -> str:
    normalized = value.strip().lower()
    if not CODE_PATTERN.fullmatch(normalized):
        raise ValueError("Catalog codes use lowercase letters, numbers, and underscores.")
    return normalized


def validate_currency(value: str) -> str:
    normalized = value.strip().upper()
    if not CURRENCY_PATTERN.fullmatch(normalized):
        raise ValueError("Currency must be a three-letter ISO-style code.")
    return normalized


def validate_region(value: str) -> str:
    normalized = value.strip().upper()
    if normalized and not REGION_PATTERN.fullmatch(normalized):
        raise ValueError("Region must be blank or a two-letter code.")
    return normalized
