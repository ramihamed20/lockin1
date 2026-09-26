"""Read a short video's duration from its container, with no decoder installed.

Uploads are checked here before they are stored: the file must really be an
MP4 or WebM container, carry a video track, and state how long it is. Only the
container's own bookkeeping is read (MP4 ``moov``/``mvhd``, WebM ``Info`` and
``Tracks``), a few kilobytes wherever they sit in the file, so a 100 MB upload
costs almost nothing to check. A file whose structure cannot be followed is
reported as unreadable instead of being guessed at.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Protocol

# Enough for any real moov atom of a short clip; a larger one is not a clip.
_MAX_MOOV_BYTES = 16 * 1024 * 1024
_MAX_EBML_HEADER_BYTES = 4096
_MAX_WEBM_SCAN_BYTES = 8 * 1024 * 1024


class Seekable(Protocol):
    def seek(self, offset: int, whence: int = ..., /) -> object: ...
    def tell(self) -> int: ...
    def read(self, size: int = ..., /) -> bytes: ...


class MediaProbeError(ValueError):
    """The container cannot be read, or it is not a playable video."""


@dataclass(frozen=True)
class VideoProbe:
    duration_ms: int


def probe_video(stream: Seekable, content_type: str) -> VideoProbe:
    stream.seek(0, 2)
    size = stream.tell()
    stream.seek(0)
    try:
        if content_type == "video/mp4":
            return _probe_mp4(stream, size)
        if content_type == "video/webm":
            return _probe_webm(stream, size)
    except (struct.error, IndexError, OverflowError) as error:
        raise MediaProbeError("The video file is damaged or incomplete.") from error
    finally:
        stream.seek(0)
    raise MediaProbeError("Only MP4 and WebM videos can be checked.")


# ------------------------------------------------------------------- MP4


def _boxes(data: bytes, start: int = 0, end: int | None = None):  # type: ignore[no-untyped-def]
    """(type, payload start, payload end) for each box in ``data[start:end]``."""

    end = len(data) if end is None else end
    offset = start
    while offset + 8 <= end:
        size, kind = struct.unpack(">I4s", data[offset : offset + 8])
        header = 8
        if size == 1:
            size = struct.unpack(">Q", data[offset + 8 : offset + 16])[0]
            header = 16
        elif size == 0:
            size = end - offset
        if size < header or offset + size > end:
            raise MediaProbeError("The video file is damaged or incomplete.")
        yield kind, offset + header, offset + size
        offset += size


def _read_top_level_moov(stream: Seekable, size: int) -> bytes:
    offset = 0
    while offset + 8 <= size:
        stream.seek(offset)
        header = stream.read(16)
        box_size, kind = struct.unpack(">I4s", header[:8])
        header_size = 8
        if box_size == 1:
            box_size = struct.unpack(">Q", header[8:16])[0]
            header_size = 16
        elif box_size == 0:
            box_size = size - offset
        if box_size < header_size or offset + box_size > size:
            raise MediaProbeError("The video file is damaged or incomplete.")
        if kind == b"moov":
            if box_size > _MAX_MOOV_BYTES:
                raise MediaProbeError("The video's index is too large for a short loop.")
            stream.seek(offset + header_size)
            return stream.read(box_size - header_size)
        offset += box_size
    raise MediaProbeError(
        "The video has no playable index (moov). Re-export it as a standard MP4 (H.264)."
    )


def _probe_mp4(stream: Seekable, size: int) -> VideoProbe:
    moov = _read_top_level_moov(stream, size)
    timescale = duration = 0
    fragment_duration = 0
    has_video = False
    for kind, start, end in _boxes(moov):
        if kind == b"mvhd":
            version = moov[start]
            if version == 1:
                timescale, duration = struct.unpack(">IQ", moov[start + 20 : start + 32])
            else:
                timescale, duration = struct.unpack(">II", moov[start + 12 : start + 20])
        elif kind == b"mvex":
            for sub, sub_start, _sub_end in _boxes(moov, start, end):
                if sub == b"mehd":
                    fmt = ">Q" if moov[sub_start] == 1 else ">I"
                    width = 8 if moov[sub_start] == 1 else 4
                    fragment_duration = struct.unpack(
                        fmt, moov[sub_start + 4 : sub_start + 4 + width]
                    )[0]
        elif kind == b"trak":
            has_video = has_video or _trak_is_video(moov, start, end)
    if not has_video:
        raise MediaProbeError("The file has no video track.")
    # Fragmented MP4 leaves mvhd's duration at 0 (or all ones) and states it in mehd.
    if duration in (0, 0xFFFFFFFF, 0xFFFFFFFFFFFFFFFF):
        duration = fragment_duration
    if not timescale or not duration:
        raise MediaProbeError("The video does not state its length. Re-export it as MP4 or WebM.")
    return VideoProbe(duration_ms=round(duration * 1000 / timescale))


def _trak_is_video(data: bytes, start: int, end: int) -> bool:
    for kind, box_start, box_end in _boxes(data, start, end):
        if kind == b"mdia":
            for sub, sub_start, _sub_end in _boxes(data, box_start, box_end):
                # hdlr: version/flags (4), pre_defined (4), handler_type (4)
                if sub == b"hdlr" and data[sub_start + 8 : sub_start + 12] == b"vide":
                    return True
    return False


# ------------------------------------------------------------------ WebM

_EBML = 0x1A45DFA3
_DOCTYPE = 0x4282
_SEGMENT = 0x18538067
_INFO = 0x1549A966
_TIMECODE_SCALE = 0x2AD7B1
_DURATION = 0x4489
_TRACKS = 0x1654AE6B
_TRACK_ENTRY = 0xAE
_TRACK_TYPE = 0x83
_CLUSTER = 0x1F43B675
_UNKNOWN = -1


def _vint(data: bytes, offset: int, *, keep_marker: bool) -> tuple[int, int]:
    first = data[offset]
    length = 1
    mask = 0x80
    while length <= 8 and not first & mask:
        mask >>= 1
        length += 1
    if length > 8:
        raise MediaProbeError("The video file is damaged or incomplete.")
    value = first if keep_marker else first & (mask - 1)
    all_ones = value == mask - 1 and not keep_marker
    for index in range(1, length):
        byte = data[offset + index]
        value = (value << 8) | byte
        all_ones = all_ones and byte == 0xFF
    return (_UNKNOWN if all_ones else value), offset + length


def _elements(data: bytes, start: int, end: int):  # type: ignore[no-untyped-def]
    offset = start
    while offset < end:
        element_id, offset = _vint(data, offset, keep_marker=True)
        size, offset = _vint(data, offset, keep_marker=False)
        stop = end if size == _UNKNOWN else offset + size
        yield element_id, offset, min(stop, end), size == _UNKNOWN
        if size == _UNKNOWN:
            return
        offset = stop


def _uint(data: bytes, start: int, end: int) -> int:
    return int.from_bytes(data[start:end], "big") if end > start else 0


def _probe_webm(stream: Seekable, size: int) -> VideoProbe:
    data = stream.read(min(size, _MAX_WEBM_SCAN_BYTES))
    elements = _elements(data, 0, len(data))
    element_id, start, end, _unknown = next(elements)
    if element_id != _EBML or end - start > _MAX_EBML_HEADER_BYTES:
        raise MediaProbeError("The file is not a WebM video.")
    doc_type = next(
        (data[s:e] for i, s, e, _u in _elements(data, start, end) if i == _DOCTYPE), b""
    )
    if doc_type.rstrip(b"\x00") not in (b"webm", b"matroska"):
        raise MediaProbeError("The file is not a WebM video.")
    segment = next(((s, e) for i, s, e, _u in elements if i == _SEGMENT), None)
    if segment is None:
        raise MediaProbeError("The video file is damaged or incomplete.")
    scale = 1_000_000
    duration: float | None = None
    has_video = False
    for element_id, start, end, _unknown in _elements(data, *segment):
        if element_id == _INFO:
            for child, child_start, child_end, _u in _elements(data, start, end):
                if child == _TIMECODE_SCALE:
                    scale = _uint(data, child_start, child_end) or scale
                elif child == _DURATION:
                    width = child_end - child_start
                    if width == 4:
                        duration = struct.unpack(">f", data[child_start:child_end])[0]
                    elif width == 8:
                        duration = struct.unpack(">d", data[child_start:child_end])[0]
        elif element_id == _TRACKS:
            for entry, entry_start, entry_end, _u in _elements(data, start, end):
                if entry != _TRACK_ENTRY:
                    continue
                for field, field_start, field_end, _v in _elements(data, entry_start, entry_end):
                    if field == _TRACK_TYPE and _uint(data, field_start, field_end) == 1:
                        has_video = True
        elif element_id == _CLUSTER:
            break
    if not has_video:
        raise MediaProbeError("The file has no video track.")
    if not duration or duration <= 0:
        raise MediaProbeError(
            "The WebM does not state its length (common for screen recordings). "
            "Re-export it, or upload an MP4."
        )
    return VideoProbe(duration_ms=round(duration * scale / 1_000_000))
