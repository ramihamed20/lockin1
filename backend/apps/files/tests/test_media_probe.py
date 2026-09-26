import io
from pathlib import Path
from uuid import uuid4

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.accounts.tests.helpers import create_user
from apps.files.media_probe import MediaProbeError, probe_video
from apps.files.models import ManagedFile
from apps.files.services import FileValidationError, create_managed_file

from .video_fixtures import mp4, webm


@pytest.mark.parametrize(
    "data",
    [
        mp4(20),
        mp4(20, version=1),
        mp4(20, moov_last=True),
        mp4(20, fragmented=True),
    ],
    ids=["mp4", "mp4-v1-header", "mp4-index-at-end", "fragmented-mp4"],
)
def test_mp4_durations_are_read_from_the_container(data: bytes) -> None:
    assert probe_video(io.BytesIO(data), "video/mp4").duration_ms == 20_000


def test_webm_duration_uses_the_timecode_scale() -> None:
    assert probe_video(io.BytesIO(webm(12.5)), "video/webm").duration_ms == 12_500


@pytest.mark.parametrize(
    ("data", "content_type", "message"),
    [
        (mp4(20, handler=b"soun"), "video/mp4", "no video track"),
        (mp4(20)[:40], "video/mp4", "damaged or incomplete"),
        (b"\x00\x00\x00\x18ftypmp42" + bytes(64), "video/mp4", "no playable index"),
        (webm(None), "video/webm", "does not state its length"),
        (webm(20, track_type=2), "video/webm", "no video track"),
        (webm(20, doc_type=b"nope"), "video/webm", "not a WebM video"),
        (webm(20)[:30], "video/webm", "damaged or incomplete"),
    ],
    ids=[
        "audio-only",
        "truncated",
        "no-moov",
        "webm-without-duration",
        "webm-audio-only",
        "not-webm",
        "webm-truncated",
    ],
)
def test_broken_or_unsuitable_videos_explain_themselves(
    data: bytes, content_type: str, message: str
) -> None:
    with pytest.raises(MediaProbeError, match=message):
        probe_video(io.BytesIO(data), content_type)


def _upload(data: bytes, name: str = "rain.mp4", content_type: str = "video/mp4") -> ManagedFile:
    return create_managed_file(
        owner=create_user(email=f"{uuid4().hex[:10]}@example.com"),
        upload=SimpleUploadedFile(name, data, content_type=content_type),
        kind=ManagedFile.Kind.WORKSPACE_MEDIA,
    )


@pytest.mark.django_db
def test_a_valid_short_clip_is_stored_once_with_its_duration() -> None:
    stored = _upload(mp4(20))
    assert stored.duration_ms == 20_000
    assert stored.size_bytes == len(mp4(20))
    assert ManagedFile.objects.count() == 1
    webm_file = _upload(webm(8), name="night.webm", content_type="video/webm")
    assert webm_file.duration_ms == 8_000


@pytest.mark.django_db
@override_settings(LOFI_VIDEO_MAX_SECONDS=300, LOFI_VIDEO_MIN_SECONDS=2)
def test_clip_length_limits_give_specific_messages() -> None:
    with pytest.raises(FileValidationError, match=r"10\.0 min long; the limit is 5 min"):
        _upload(mp4(600))
    with pytest.raises(FileValidationError, match=r"1\.0 s long; a loop must be at least 2 s"):
        _upload(mp4(1))
    with pytest.raises(FileValidationError, match="damaged or incomplete"):
        _upload(mp4(20)[:40])
    assert ManagedFile.objects.count() == 0


@pytest.mark.django_db
@override_settings(PAPER_WORKSPACE_MEDIA_MAX_BYTES=1024 * 1024)
def test_oversized_clips_state_the_limit() -> None:
    with pytest.raises(FileValidationError, match="the limit is 1 MB"):
        _upload(mp4(20, payload=2 * 1024 * 1024))


@pytest.mark.django_db
def test_images_are_not_probed_and_keep_no_duration() -> None:
    png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + bytes(32)
    cover = _upload(png, name="cover.png", content_type="image/png")
    assert cover.duration_ms is None


def test_a_real_encoded_clip_is_read_correctly() -> None:
    # A 2 s VP8 WebM written by a real encoder (ffmpeg), not a hand-built container.
    path = Path(__file__).parent / "fixtures" / "lofi-loop.webm"
    assert probe_video(io.BytesIO(path.read_bytes()), "video/webm").duration_ms == 2_000
