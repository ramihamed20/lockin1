from django.apps import AppConfig


class OperationsIntegrationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.operations_integrations"

    def ready(self) -> None:
        from .subscribers import register_subscribers

        register_subscribers()
