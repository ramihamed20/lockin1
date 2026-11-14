from pathlib import Path
from uuid import UUID

from django.core.management.base import BaseCommand, CommandError

from apps.administration.models import AutomationJob
from apps.administration.pdf_extraction import PDFExtractionError, export_page_images
from apps.content.admin_services import edition_primary_file
from apps.content.editions import UNIVERSITY


class Command(BaseCommand):
    help = "Render up to eight original lecture PDF pages for authorized visual review."

    def add_arguments(self, parser):  # type: ignore[no-untyped-def]
        parser.add_argument("job_id", type=UUID)
        parser.add_argument("--output-dir", type=Path, required=True)
        parser.add_argument("--page", type=int, action="append", required=True)

    def handle(self, *args, **options):  # type: ignore[no-untyped-def]
        job = (
            AutomationJob.objects.filter(pk=options["job_id"], job_type="question_package")
            .select_related("learning_object__current_version")
            .first()
        )
        if job is None or job.learning_object is None:
            raise CommandError("Question package not found.")
        file = edition_primary_file(job.learning_object, UNIVERSITY)
        if file is None or file.checksum_sha256 != job.output_manifest.get("source_sha256"):
            raise CommandError("The lecture PDF changed or the package is unavailable.")
        try:
            images = export_page_images(file, pages=options["page"], target=options["output_dir"])
        except (OSError, PDFExtractionError) as error:
            raise CommandError(str(error)) from error
        for image in images:
            self.stdout.write(image.name)
