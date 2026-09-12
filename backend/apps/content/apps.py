from django.apps import AppConfig


class ContentConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.content"

    def ready(self) -> None:
        # Registers the Catalog branch projection. Imported here so the app
        # registry is fully populated before the education models are resolved.
        from . import signals  # noqa: F401
