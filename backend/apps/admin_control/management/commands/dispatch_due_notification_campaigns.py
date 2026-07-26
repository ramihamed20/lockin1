from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.admin_control.models import NotificationCampaign
from apps.admin_control.services import AdminControlError, dispatch_notification_campaign


class Command(BaseCommand):
    help = "Dispatch approved notification campaigns whose scheduled time has arrived."

    def handle(self, *args, **options):
        due = NotificationCampaign.objects.filter(
            status=NotificationCampaign.Status.SCHEDULED,
            scheduled_for__lte=timezone.now(),
        ).select_related("created_by").order_by("scheduled_for", "id")
        dispatched = 0
        failed = 0
        for campaign in due.iterator(chunk_size=50):
            try:
                dispatch_notification_campaign(
                    campaign_id=campaign.id,
                    actor=campaign.created_by,
                    reason=campaign.reason,
                    source="admin_control.scheduler",
                )
            except AdminControlError as error:
                failed += 1
                self.stderr.write(f"Campaign {campaign.id} was not dispatched: {error}")
            else:
                dispatched += 1
        self.stdout.write(self.style.SUCCESS(f"Dispatched {dispatched} campaign(s); {failed} failed."))
