import io
import json
from collections.abc import Iterator
from datetime import timedelta
from typing import Any
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import pytest
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant
from apps.focus import youtube_search

pytestmark = pytest.mark.django_db

URL = "/api/v1/focus/paper-workspace/youtube-search"
KEY = "test-youtube-key-never-sent-to-clients"


def _search_item(video_id: str, title: str = "Lecture", live: str = "none") -> dict[str, Any]:
    return {
        "id": {"videoId": video_id},
        "snippet": {
            "title": title,
            "channelTitle": "Dental &amp; Oral",
            "liveBroadcastContent": live,
        },
    }


def _video(
    video_id: str, *, embeddable: bool = True, age_restricted: bool = False
) -> dict[str, Any]:
    rating = {"ytRating": "ytAgeRestricted"} if age_restricted else {}
    return {
        "id": video_id,
        "status": {"embeddable": embeddable, "privacyStatus": "public"},
        "contentDetails": {"contentRating": rating},
    }


class FakeResponse(io.BytesIO):
    status = 200

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


class FakeYouTube:
    """Stands in for urlopen and records every request it receives."""

    def __init__(
        self, search: list[dict[str, Any]], videos: list[dict[str, Any]] | None = None
    ) -> None:
        self.search = search
        self.videos = videos
        self.requests: list[Any] = []
        self.error: HTTPError | None = None

    def __call__(self, request: Any, timeout: int) -> FakeResponse:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        if request.full_url.startswith(youtube_search.SEARCH_URL):
            body = {"items": self.search}
        else:
            ids = parse_qs(urlparse(request.full_url).query)["id"][0].split(",")
            body = {
                "items": self.videos if self.videos is not None else [_video(item) for item in ids]
            }
        return FakeResponse(json.dumps(body).encode())


def _quota_error() -> HTTPError:
    body = json.dumps({"error": {"errors": [{"reason": "quotaExceeded"}]}}).encode()
    return HTTPError(youtube_search.SEARCH_URL, 403, "Forbidden", {}, io.BytesIO(body))  # type: ignore[arg-type]


@pytest.fixture(autouse=True)
def _clean_cache() -> Iterator[None]:
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeYouTube:
    ids = [f"video{index:06d}" for index in range(12)]
    youtube = FakeYouTube([_search_item(item) for item in ids])
    monkeypatch.setattr(youtube_search, "urlopen", youtube)
    return youtube


def _student() -> APIClient:
    student: User = create_user(email=f"yt-{uuid4().hex[:8]}@example.com")
    EntitlementGrant.objects.create(
        user=student,
        entitlement=EntitlementDefinition.objects.get(code="focus.workspace"),
        source_type=EntitlementGrant.SourceType.MANUAL,
        source_id=uuid4(),
        starts_at=timezone.now() - timedelta(minutes=1),
    )
    client = APIClient()
    client.force_authenticate(student)
    return client


@override_settings(YOUTUBE_API_KEY=KEY)
def test_search_returns_embeddable_videos_without_exposing_the_key(fake: FakeYouTube) -> None:
    fake.search = [
        _search_item("aaaaaaaaaaa", "It&#39;s enamel"),
        _search_item("aaaaaaaaaaa", "duplicate"),
        _search_item("bbbbbbbbbbb", "premiere", live="upcoming"),
        _search_item("not-an-id"),
        _search_item("ccccccccccc"),
        _search_item("ddddddddddd"),
        _search_item("eeeeeeeeeee"),
    ]
    fake.videos = [
        _video("aaaaaaaaaaa"),
        _video("ccccccccccc", embeddable=False),
        _video("ddddddddddd", age_restricted=True),
        _video("eeeeeeeeeee"),
    ]

    response = _student().get(URL, {"q": "  oral   histology "})

    assert response.status_code == 200
    assert response.json() == {
        "query": "oral histology",
        "results": [
            {
                "video_id": "aaaaaaaaaaa",
                "title": "It's enamel",
                "channel_title": "Dental & Oral",
                "thumbnail": "https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg",
            },
            {
                "video_id": "eeeeeeeeeee",
                "title": "Lecture",
                "channel_title": "Dental & Oral",
                "thumbnail": "https://i.ytimg.com/vi/eeeeeeeeeee/mqdefault.jpg",
            },
        ],
    }
    assert KEY not in response.content.decode()
    search = fake.requests[0]
    params = parse_qs(urlparse(search.full_url).query)
    assert (
        params["type"] == ["video"]
        and params["videoEmbeddable"] == ["true"]
        and params["q"] == ["oral histology"]
    )
    # The key travels in a header only, never in a URL that could be logged.
    assert all(KEY not in request.full_url for request in fake.requests)
    assert search.get_header("X-goog-api-key") == KEY


@override_settings(YOUTUBE_API_KEY=KEY)
def test_results_are_capped_and_cached_per_query(fake: FakeYouTube) -> None:
    client = _student()
    first = client.get(URL, {"q": "Lofi"}).json()["results"]
    assert len(first) == youtube_search.MAX_RESULTS
    calls = len(fake.requests)
    assert client.get(URL, {"q": "  lofi "}).json()["results"] == first
    assert len(fake.requests) == calls


@override_settings(YOUTUBE_API_KEY=KEY)
def test_unverifiable_embed_status_falls_back_to_the_search_filter(
    fake: FakeYouTube, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(youtube_search, "_embeddable_ids", lambda ids: None)
    assert len(_student().get(URL, {"q": "lofi"}).json()["results"]) == youtube_search.MAX_RESULTS


@override_settings(YOUTUBE_API_KEY="")
def test_search_without_a_key_is_unavailable(fake: FakeYouTube) -> None:
    response = _student().get(URL, {"q": "lofi"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "youtube_search_unavailable"
    assert fake.requests == []


@override_settings(YOUTUBE_API_KEY=KEY)
def test_quota_refusal_pauses_searches_instead_of_retrying(fake: FakeYouTube) -> None:
    client = _student()
    fake.error = _quota_error()
    response = client.get(URL, {"q": "lofi"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "youtube_quota_exceeded"
    assert KEY not in response.content.decode()
    calls = len(fake.requests)
    assert (
        client.get(URL, {"q": "another query"}).json()["error"]["code"] == "youtube_quota_exceeded"
    )
    assert len(fake.requests) == calls


@override_settings(YOUTUBE_API_KEY=KEY)
def test_other_upstream_failures_are_reported_as_a_failed_search(fake: FakeYouTube) -> None:
    fake.error = HTTPError(youtube_search.SEARCH_URL, 400, "Bad Request", {}, io.BytesIO(b"{}"))  # type: ignore[arg-type]
    response = _student().get(URL, {"q": "lofi"})
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "youtube_search_failed"


@override_settings(YOUTUBE_API_KEY=KEY)
def test_each_student_is_rate_limited(fake: FakeYouTube, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(youtube_search, "USER_RATE_LIMIT", 2)
    client = _student()
    assert client.get(URL, {"q": "one"}).status_code == 200
    assert client.get(URL, {"q": "two"}).status_code == 200
    limited = client.get(URL, {"q": "three"})
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "youtube_search_rate_limited"
    # A cached query costs no quota, so it is still answered.
    assert client.get(URL, {"q": "one"}).status_code == 200


@override_settings(YOUTUBE_API_KEY=KEY)
def test_search_rejects_empty_queries_and_anonymous_requests(fake: FakeYouTube) -> None:
    assert _student().get(URL, {"q": "   "}).status_code == 400
    assert _student().get(URL).status_code == 400
    assert APIClient().get(URL, {"q": "lofi"}).status_code in {401, 403}
    assert fake.requests == []
