from pathlib import Path


def test_materials_tree_is_not_reintroduced_as_a_public_api() -> None:
    urls = (Path(__file__).parents[3] / "platform_core" / "api" / "urls.py").read_text(
        encoding="utf-8"
    )
    assert 'include("apps.education.urls")' not in urls
