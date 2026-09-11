from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0010_accountemaildelivery")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="dynamic_theme",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="user",
            name="mascot_preference",
            field=models.CharField(
                choices=[("black", "Black cat"), ("white", "White cat"), ("none", "No mascot")],
                default="white",
                max_length=8,
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="theme_preference",
            field=models.CharField(
                choices=[
                    ("dawn", "Dawn"),
                    ("day", "Day"),
                    ("sunset", "Sunset"),
                    ("night", "Night"),
                ],
                default="night",
                max_length=8,
            ),
        ),
    ]
