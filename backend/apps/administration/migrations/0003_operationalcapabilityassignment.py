import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("administration", "0002_seed_operational_roles"),
    ]

    operations = [
        migrations.CreateModel(
            name="OperationalCapabilityAssignment",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("reason", models.CharField(max_length=500)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("capability", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="assignments", to="administration.operationalcapability")),
                ("granted_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="operational_capabilities_granted", to=settings.AUTH_USER_MODEL)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="operational_capability_assignments", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("user_id", "capability_id")},
        ),
        migrations.AddConstraint(model_name="operationalcapabilityassignment", constraint=models.UniqueConstraint(fields=("user", "capability"), name="administration_user_capability_unique")),
        migrations.AddIndex(model_name="operationalcapabilityassignment", index=models.Index(fields=["capability", "user"], name="admin_capability_user_idx")),
    ]
