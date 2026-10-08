from django.db import migrations, models


def revenue_index():
    return models.Index(
        fields=("succeeded_at",),
        condition=models.Q(status__in=("succeeded", "partially_refunded", "refunded")),
        name="payment_revenue_time_idx",
    )


def create_index(apps, schema_editor):
    model = apps.get_model("payments", "Payment")
    index = revenue_index()
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute(index.create_sql(model, schema_editor, concurrently=True))
    else:
        schema_editor.add_index(model, index)


def remove_index(apps, schema_editor):
    model = apps.get_model("payments", "Payment")
    index = revenue_index()
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute(index.remove_sql(model, schema_editor, concurrently=True))
    else:
        schema_editor.remove_index(model, index)


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("payments", "0006_telegrampaymentoperator")]
    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[migrations.RunPython(create_index, remove_index)],
            state_operations=[migrations.AddIndex(model_name="payment", index=revenue_index())],
        )
    ]
