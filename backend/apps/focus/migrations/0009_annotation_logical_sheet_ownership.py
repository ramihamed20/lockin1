from django.db import migrations, models
import django.db.models.deletion
from django.utils import timezone


def merge_version_collections(apps, schema_editor):
    Collection = apps.get_model("focus", "FocusAnnotationCollection")
    Annotation = apps.get_model("focus", "FocusAnnotation")
    duplicate_keys = (
        Collection.objects.filter(merged_into__isnull=True)
        .values("user_id", "document_id")
        .annotate(total=models.Count("id"))
        .filter(total__gt=1)
    )
    for key in duplicate_keys.iterator():
        collections = list(
            Collection.objects.filter(
                user_id=key["user_id"],
                document_id=key["document_id"],
                merged_into__isnull=True,
            ).order_by("-updated_at", "-created_at", "id")
        )
        keeper, aliases = collections[0], collections[1:]
        alias_ids = [item.id for item in aliases]
        Annotation.objects.filter(collection_id__in=alias_ids).update(collection_id=keeper.id)
        Collection.objects.filter(id__in=alias_ids).update(merged_into_id=keeper.id)
        keeper.revision = max(item.revision for item in collections) + 1
        if len({item.document_version_id for item in collections}) > 1:
            keeper.version_changed_at = timezone.now()
        keeper.save(update_fields=("revision", "version_changed_at", "updated_at"))


class Migration(migrations.Migration):

    dependencies = [("focus", "0008_activestudyrun_active_study_one_active_run_per_sheet")]

    operations = [
        migrations.AddField(
            model_name="focusannotationcollection",
            name="merged_into",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="merged_annotation_collections",
                to="focus.focusannotationcollection",
            ),
        ),
        migrations.AddField(
            model_name="focusannotationcollection",
            name="version_changed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RemoveConstraint(
            model_name="focusannotationcollection",
            name="focus_annotation_collection_unique",
        ),
        migrations.RemoveIndex(
            model_name="focusannotationcollection",
            name="focus_annotation_owner_idx",
        ),
        migrations.RunPython(merge_version_collections, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name="focusannotationcollection",
            index=models.Index(
                fields=["user", "document_id"], name="focus_annotation_owner_idx"
            ),
        ),
        migrations.AddConstraint(
            model_name="focusannotationcollection",
            constraint=models.UniqueConstraint(
                condition=models.Q(("merged_into__isnull", True)),
                fields=("user", "document_id"),
                name="focus_annotation_collection_unique",
            ),
        ),
    ]
