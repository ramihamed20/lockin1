from django.apps import AppConfig


class FilesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.files"

    def ready(self) -> None:
        from django.db.models.signals import post_delete

        from .models import ManagedFile
        from .signals import forget_cached_copy

        post_delete.connect(
            forget_cached_copy, sender=ManagedFile, dispatch_uid="files-forget-cache"
        )
