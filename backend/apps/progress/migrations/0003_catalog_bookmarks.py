import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("progress", "0002_questionreview_questionreviewlog"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="bookmark",
            name="progress_bookmark_unique",
        ),
        migrations.AlterField(
            model_name="bookmark",
            name="learning_object",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="bookmarks",
                to="content.learningobject",
            ),
        ),
        migrations.AddField(
            model_name="bookmark",
            name="catalog_material_slug",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="bookmark",
            name="catalog_material_title",
            field=models.CharField(blank=True, default="", max_length=160),
        ),
        migrations.AddField(
            model_name="bookmark",
            name="catalog_sheet_slug",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="bookmark",
            name="catalog_sheet_title",
            field=models.CharField(blank=True, default="", max_length=240),
        ),
        migrations.AddField(
            model_name="bookmark",
            name="position",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddConstraint(
            model_name="bookmark",
            constraint=models.UniqueConstraint(
                condition=models.Q(learning_object__isnull=False),
                fields=("user", "learning_object"),
                name="progress_bookmark_unique",
            ),
        ),
        migrations.AddConstraint(
            model_name="bookmark",
            constraint=models.UniqueConstraint(
                condition=(
                    models.Q(learning_object__isnull=True)
                    & ~models.Q(catalog_material_slug="")
                    & ~models.Q(catalog_sheet_slug="")
                ),
                fields=("user", "catalog_material_slug", "catalog_sheet_slug"),
                name="progress_catalog_bookmark_unique",
            ),
        ),
        migrations.AddConstraint(
            model_name="bookmark",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(
                        learning_object__isnull=False,
                        catalog_material_slug="",
                        catalog_sheet_slug="",
                    )
                    | (
                        models.Q(learning_object__isnull=True)
                        & ~models.Q(catalog_material_slug="")
                        & ~models.Q(catalog_sheet_slug="")
                    )
                ),
                name="progress_bookmark_target_valid",
            ),
        ),
    ]
