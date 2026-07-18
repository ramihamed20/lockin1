from django.apps import AppConfig


class CommerceIntegrationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.commerce_integrations"
    verbose_name = "Commerce domain integrations"

    def ready(self) -> None:
        from .subscribers import register_subscribers

        register_subscribers()
