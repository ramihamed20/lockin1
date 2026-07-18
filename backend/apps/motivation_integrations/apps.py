from django.apps import AppConfig


class MotivationIntegrationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.motivation_integrations"
    verbose_name = "Motivation domain integrations"

    def ready(self) -> None:
        from .subscribers import register_subscribers

        register_subscribers()
