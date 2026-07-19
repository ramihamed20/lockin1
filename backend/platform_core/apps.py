from django.apps import AppConfig


class PlatformCoreConfig(AppConfig):
    name = "platform_core"
    verbose_name = "Lock-in platform core"

    def ready(self) -> None:
        from platform_core.production import checks

        del checks
