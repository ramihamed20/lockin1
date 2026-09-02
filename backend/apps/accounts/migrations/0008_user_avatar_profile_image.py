# Generated manually to keep the migration focused on the profile-avatar feature.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("files", "0001_initial"),
        ("accounts", "0007_username_and_welcome_state"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="avatar_default",
            field=models.CharField(
                blank=True,
                choices=[
                    ("cat-male-grayblue", "Gray-blue cat"),
                    ("cat-female-calico", "Calico cat"),
                    ("cat-male-orange", "Orange cat"),
                    ("cat-male-tuxedo", "Tuxedo cat"),
                    ("cat-female-lavender", "Lavender cat"),
                    ("cat-female-pink", "Pink cat"),
                ],
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="profile_image",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="profile_image_users",
                to="files.managedfile",
            ),
        ),
    ]
