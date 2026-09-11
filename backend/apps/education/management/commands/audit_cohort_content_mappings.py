from django.core.management.base import BaseCommand

from apps.content.models import LearningObject
from apps.education.models import StudentCohort


class Command(BaseCommand):
    help = "Read-only report of cohort content scopes and affected published learning objects."

    def handle(self, *args: object, **options: object) -> None:
        del args, options
        cohorts = StudentCohort.objects.select_related("program").prefetch_related("content_nodes")
        mapped_paths: set[str] = set()
        for cohort in cohorts:
            paths = sorted(node.path for node in cohort.content_nodes.all())
            mapped_paths.update(paths)
            scope_text = ", ".join(paths) or "UNASSIGNED"
            self.stdout.write(
                f"COHORT {cohort.id} {cohort.program.code}/{cohort.code}: {scope_text}"
            )
        published = LearningObject.objects.filter(
            archived_at__isnull=True, published_version__isnull=False
        ).select_related("published_version__academic_node")
        unmapped = []
        for learning_object in published:
            version = learning_object.published_version
            if version is None:
                continue
            path = version.academic_node.path
            if not any(path.startswith(root) for root in mapped_paths):
                unmapped.append((learning_object.id, path))
        self.stdout.write(f"Published learning objects without any cohort scope: {len(unmapped)}")
        for object_id, path in unmapped:
            self.stdout.write(f"UNMAPPED {object_id} {path}")
