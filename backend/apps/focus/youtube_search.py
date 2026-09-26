"""Paper Workspace YouTube search, through the YouTube Data API v3.

The API key stays on the server: it travels in the ``X-Goog-Api-Key`` header
(never a URL, so it cannot reach an access log or an exception message) and no
payload built here contains it. The client only ever receives video ids,
titles, channel names and an ``i.ytimg.com`` thumbnail derived from the id.

A search costs 100 of the project's 10,000 daily quota units, so results are
cached per normalized query, each student is rate limited, and a quota refusal
pauses every search for a while instead of retrying into the same wall.
"""

import hashlib
import html
import json
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.cache import cache

SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
MAX_QUERY_LENGTH = 100
MAX_RESULTS = 8
# Asked for a few more than are shown, so filtering out videos that cannot be
# embedded still leaves a full list.
CANDIDATES = 12
RESULT_TTL_SECONDS = 6 * 60 * 60
QUOTA_COOLDOWN_SECONDS = 15 * 60
USER_RATE_LIMIT = 20
USER_RATE_WINDOW_SECONDS = 10 * 60
QUOTA_REASONS = frozenset(
    {"quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"}
)
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_CACHE_PREFIX = "focus:youtube-search:v1"
_COOLDOWN_KEY = f"{_CACHE_PREFIX}:quota-cooldown"


class YouTubeSearchError(Exception):
    """Base for every reason a search produced no results list."""


class YouTubeSearchUnavailable(YouTubeSearchError):
    """No API key is configured on this deployment."""


class YouTubeQuotaExceeded(YouTubeSearchError):
    """YouTube refused the request for quota; searches pause for a while."""


class YouTubeSearchRateLimited(YouTubeSearchError):
    """This student searched too often in the current window."""


class YouTubeSearchFailed(YouTubeSearchError):
    """YouTube could not be reached or answered with something unusable."""


def normalize_query(value: object) -> str:
    return " ".join(str(value or "").split())[:MAX_QUERY_LENGTH]


def _cache_key(query: str) -> str:
    digest = hashlib.sha256(query.casefold().encode("utf-8")).hexdigest()
    return f"{_CACHE_PREFIX}:results:{digest}"


def _get(url: str, params: dict[str, str]) -> dict[str, Any]:
    request = Request(  # noqa: S310 - both URLs are fixed Google API origins above.
        f"{url}?{urlencode(params)}",
        headers={"Accept": "application/json", "X-Goog-Api-Key": settings.YOUTUBE_API_KEY},
        method="GET",
    )
    try:
        with urlopen(  # noqa: S310 - fixed Google API origin with the configured key.
            request, timeout=int(getattr(settings, "YOUTUBE_HTTP_TIMEOUT_SECONDS", 5))
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if _is_quota_error(error):
            raise YouTubeQuotaExceeded() from None
        raise YouTubeSearchFailed() from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise YouTubeSearchFailed() from None
    if not isinstance(payload, dict):
        raise YouTubeSearchFailed()
    return payload


def _is_quota_error(error: HTTPError) -> bool:
    if error.code == 429:
        return True
    if error.code != 403:
        return False
    try:
        body = json.loads(error.read().decode("utf-8"))
        reasons = {item.get("reason") for item in body["error"]["errors"]}
    except (ValueError, KeyError, TypeError, AttributeError, OSError):
        return False
    return bool(reasons & QUOTA_REASONS)


def _search_candidates(query: str) -> list[dict[str, str]]:
    payload = _get(
        SEARCH_URL,
        {
            "part": "snippet",
            "q": query,
            "type": "video",
            # Only videos their owners allow on other sites, and only ones
            # that play outside youtube.com.
            "videoEmbeddable": "true",
            "videoSyndicated": "true",
            "safeSearch": "moderate",
            "maxResults": str(CANDIDATES),
            "fields": "items(id/videoId,snippet(title,channelTitle,liveBroadcastContent))",
        },
    )
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in payload.get("items") or []:
        if not isinstance(item, dict):
            continue
        video_id = str((item.get("id") or {}).get("videoId") or "")
        snippet = item.get("snippet") or {}
        if not VIDEO_ID.fullmatch(video_id) or video_id in seen:
            continue
        # A scheduled premiere has nothing to play yet.
        if snippet.get("liveBroadcastContent") == "upcoming":
            continue
        seen.add(video_id)
        results.append(
            {
                "video_id": video_id,
                # The API returns HTML-escaped text ("&#39;", "&amp;").
                "title": html.unescape(str(snippet.get("title") or "")).strip()[:200],
                "channel_title": html.unescape(str(snippet.get("channelTitle") or "")).strip()[
                    :120
                ],
                # Derived from the validated id, so the host is always the one
                # the Content-Security-Policy admits.
                "thumbnail": f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
            }
        )
    return results


def _embeddable_ids(ids: list[str]) -> set[str] | None:
    """The ids that really play in an embed, or None when that cannot be checked.

    ``videoEmbeddable`` on the search is a coarse filter; this one-unit lookup
    also drops private and age-restricted videos, which refuse to play embedded.
    """

    try:
        payload = _get(
            VIDEOS_URL,
            {
                "part": "status,contentDetails",
                "id": ",".join(ids),
                "maxResults": str(len(ids)),
                "fields": (
                    "items(id,status(embeddable,privacyStatus),"
                    "contentDetails/contentRating/ytRating)"
                ),
            },
        )
    except YouTubeSearchError:
        return None
    playable: set[str] = set()
    for item in payload.get("items") or []:
        if not isinstance(item, dict):
            continue
        status = item.get("status") or {}
        rating = ((item.get("contentDetails") or {}).get("contentRating") or {}).get("ytRating")
        if (
            status.get("embeddable") is True
            and status.get("privacyStatus") == "public"
            and rating != "ytAgeRestricted"
        ):
            playable.add(str(item.get("id") or ""))
    return playable


def _check_rate_limit(user_id: object) -> None:
    key = f"{_CACHE_PREFIX}:rate:{user_id}"
    if cache.add(key, 1, USER_RATE_WINDOW_SECONDS):
        return
    try:
        count = cache.incr(key)
    except ValueError:
        # The window expired between add() and incr().
        cache.set(key, 1, USER_RATE_WINDOW_SECONDS)
        return
    if count > USER_RATE_LIMIT:
        raise YouTubeSearchRateLimited()


def search_videos(*, query: str, user_id: object) -> list[dict[str, str]]:
    """Up to MAX_RESULTS embeddable videos for ``query`` (already normalized)."""

    if not settings.YOUTUBE_API_KEY:
        raise YouTubeSearchUnavailable()
    key = _cache_key(query)
    cached = cache.get(key)
    if isinstance(cached, list):
        return cached
    if cache.get(_COOLDOWN_KEY):
        raise YouTubeQuotaExceeded()
    _check_rate_limit(user_id)
    try:
        candidates = _search_candidates(query)
    except YouTubeQuotaExceeded:
        cache.set(_COOLDOWN_KEY, True, QUOTA_COOLDOWN_SECONDS)
        raise
    if candidates:
        playable = _embeddable_ids([item["video_id"] for item in candidates])
        if playable is not None:
            candidates = [item for item in candidates if item["video_id"] in playable]
    results = candidates[:MAX_RESULTS]
    cache.set(key, results, RESULT_TTL_SECONDS)
    return results
