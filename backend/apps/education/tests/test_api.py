import pytest
from django.urls import Resolver404, resolve


def test_education_tree_routes_are_not_exposed() -> None:
    """Materials is Catalog-only; the legacy hierarchy has no public API."""

    for path in (
        "/api/v1/education/nodes",
        "/api/v1/management/education/nodes",
        "/api/v1/management/education/scopes",
    ):
        with pytest.raises(Resolver404):
            resolve(path)
