import uuid

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("content", "0004_activestudyquestioncontent"),
        ("files", "0001_initial"),
    ]
    operations = [
        migrations.CreateModel(
            name="CatalogDocument",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("material_slug", models.SlugField(max_length=120)),
                ("sheet_slug", models.SlugField(max_length=120)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "managed_file",
                    models.ForeignKey(
                        on_delete=models.deletion.PROTECT,
                        related_name="catalog_documents",
                        to="files.managedfile",
                    ),
                ),
                (
                    "version",
                    models.OneToOneField(
                        on_delete=models.deletion.PROTECT,
                        related_name="catalog_document",
                        to="content.learningobjectversion",
                    ),
                ),
            ],
            options={
                "indexes": [
                    models.Index(
                        fields=["material_slug", "sheet_slug", "is_active"],
                        name="content_catalog_lookup_idx",
                    )
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("material_slug", "sheet_slug"), name="content_catalog_alias_unique"
                    )
                ],
            },
        ),
        migrations.CreateModel(
            name="CatalogWorkspaceSnapshot",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("state", models.JSONField(blank=True, default=dict)),
                ("revision", models.PositiveBigIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "document",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="workspaces",
                        to="content.catalogdocument",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="catalog_workspaces",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=("user", "document"), name="content_catalog_workspace_unique"
                    )
                ]
            },
        ),
        migrations.CreateModel(
            name="CatalogWorkspaceReceipt",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("idempotency_key", models.UUIDField()),
                ("request_digest", models.CharField(max_length=64)),
                ("response_payload", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="receipts",
                        to="content.catalogworkspacesnapshot",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=("workspace", "idempotency_key"),
                        name="content_catalog_receipt_unique",
                    )
                ]
            },
        ),
    ]
