# Generated manually for the initial audited administration-control domain.

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("notifications", "0002_alter_notification_category_and_more"),
        ("subscriptions", "0002_backfill_verified_trials"),
    ]

    operations = [
        migrations.CreateModel(
            name="NotificationCampaign",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("audience", models.CharField(choices=[("user", "One user"), ("selected_users", "Selected users"), ("all_users", "All users"), ("active_subscribers", "Active subscribers"), ("expired_subscribers", "Expired subscribers"), ("trial_users", "Trial users"), ("creators", "Creators"), ("plan_users", "Users on a plan")], max_length=24)),
                ("audience_filter", models.JSONField(blank=True, default=dict)),
                ("title", models.CharField(max_length=160)),
                ("body", models.CharField(max_length=320)),
                ("send_in_app", models.BooleanField(default=True)),
                ("send_email", models.BooleanField(default=False)),
                ("status", models.CharField(choices=[("draft", "Draft"), ("scheduled", "Scheduled"), ("processing", "Processing"), ("completed", "Completed"), ("failed", "Failed"), ("cancelled", "Cancelled")], default="draft", max_length=16)),
                ("scheduled_for", models.DateTimeField(blank=True, null=True)),
                ("reason", models.CharField(max_length=500)),
                ("delivered_count", models.PositiveIntegerField(default=0)),
                ("failed_count", models.PositiveIntegerField(default=0)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="notification_campaigns_created", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-created_at", "-id")},
        ),
        migrations.CreateModel(
            name="AdminInternalNote",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("target_type", models.CharField(max_length=80)),
                ("target_id", models.CharField(max_length=100)),
                ("body", models.TextField(max_length=4000)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("author", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="administrative_notes", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-created_at", "-id")},
        ),
        migrations.CreateModel(
            name="SubscriptionAdminEvent",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("action", models.CharField(max_length=60)),
                ("idempotency_key", models.CharField(max_length=180)),
                ("reason", models.CharField(max_length=500)),
                ("note", models.TextField(blank=True, max_length=4000)),
                ("previous_state", models.JSONField(blank=True, default=dict)),
                ("new_state", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("actor", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="subscription_admin_events", to=settings.AUTH_USER_MODEL)),
                ("subscription", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="admin_events", to="subscriptions.subscription")),
            ],
            options={"ordering": ("-created_at", "-id")},
        ),
        migrations.CreateModel(
            name="NotificationCampaignDelivery",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("in_app_status", models.CharField(default="not_requested", max_length=12)),
                ("email_status", models.CharField(default="not_requested", max_length=12)),
                ("failure_reason", models.CharField(blank=True, max_length=240)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("campaign", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="deliveries", to="admin_control.notificationcampaign")),
                ("in_app_notification", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="campaign_delivery_records", to="notifications.notification")),
                ("recipient", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="campaign_deliveries", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-created_at", "-id")},
        ),
        migrations.AddIndex(model_name="notificationcampaign", index=models.Index(fields=["status", "scheduled_for"], name="admin_campaign_due_idx")),
        migrations.AddIndex(model_name="notificationcampaign", index=models.Index(fields=["created_by", "-created_at"], name="admin_campaign_creator_idx")),
        migrations.AddIndex(model_name="admininternalnote", index=models.Index(fields=["target_type", "target_id", "-created_at"], name="admin_note_target_time_idx")),
        migrations.AddIndex(model_name="admininternalnote", index=models.Index(fields=["author", "-created_at"], name="admin_note_author_time_idx")),
        migrations.AddIndex(model_name="subscriptionadminevent", index=models.Index(fields=["subscription", "-created_at"], name="admin_sub_event_time_idx")),
        migrations.AddConstraint(model_name="subscriptionadminevent", constraint=models.UniqueConstraint(fields=("subscription", "idempotency_key"), name="admin_sub_event_idempotent")),
        migrations.AddConstraint(model_name="notificationcampaigndelivery", constraint=models.UniqueConstraint(fields=("campaign", "recipient"), name="admin_campaign_recipient_unique")),
        migrations.AddIndex(model_name="notificationcampaigndelivery", index=models.Index(fields=["campaign", "in_app_status"], name="admin_campaign_inapp_idx")),
        migrations.AddIndex(model_name="notificationcampaigndelivery", index=models.Index(fields=["campaign", "email_status"], name="admin_campaign_email_idx")),
    ]
