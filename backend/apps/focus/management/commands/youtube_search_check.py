"""Run one real Paper Workspace YouTube search with this deployment's API key.

Goes through the same service the endpoint uses (filters, caching, error
mapping), bypassing only the per-student rate limit. The key itself is never
printed. Exit status is non-zero when the search cannot return results.

    python manage.py youtube_search_check "oral histology"
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError, CommandParser

from apps.focus.youtube_search import (
    YouTubeQuotaExceeded,
    YouTubeSearchError,
    YouTubeSearchUnavailable,
    normalize_query,
    search_videos,
)


class Command(BaseCommand):
    help = "Search YouTube once with the configured YOUTUBE_API_KEY and list the results."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("query", nargs="?", default="lofi study music")

    def handle(self, *args: object, **options: object) -> None:
        query = normalize_query(options["query"])
        if not query:
            raise CommandError("Give a non-empty search query.")
        self.stdout.write(
            f"YOUTUBE_API_KEY configured: {'yes' if settings.YOUTUBE_API_KEY else 'no'}"
        )
        try:
            # A distinct id keeps this check off every student's rate window.
            results = search_videos(query=query, user_id="management-check")
        except YouTubeSearchUnavailable as error:
            raise CommandError("YOUTUBE_API_KEY is not set in this environment.") from error
        except YouTubeQuotaExceeded as error:
            raise CommandError("YouTube refused the search for quota; try again later.") from error
        except YouTubeSearchError as error:
            raise CommandError("YouTube could not be reached or rejected the key.") from error
        if not results:
            raise CommandError(f"No embeddable videos for {query!r}.")
        self.stdout.write(f"{len(results)} embeddable result(s) for {query!r}:")
        for item in results:
            self.stdout.write(f"  {item['video_id']}  {item['title']}  —  {item['channel_title']}")
