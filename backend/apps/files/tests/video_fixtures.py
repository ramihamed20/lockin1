"""Minimal but structurally real MP4 and WebM containers for upload tests.

They carry exactly what the probe reads (MP4 ``moov``/``mvhd``/``hdlr``, WebM
``Info``/``Tracks``) plus a stand-in media payload, so a test can say "a 20 s
clip" without shipping a video file.
"""

import struct


def _box(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", 8 + len(payload)) + kind + payload


def mp4(
    seconds: float = 20.0,
    *,
    handler: bytes = b"vide",
    version: int = 0,
    moov_last: bool = False,
    fragmented: bool = False,
    payload: int = 256,
) -> bytes:
    timescale = 1000
    duration = 0 if fragmented else round(seconds * timescale)
    if version == 1:
        mvhd = bytes([1, 0, 0, 0]) + struct.pack(">QQIQ", 0, 0, timescale, duration) + bytes(80)
    else:
        mvhd = bytes(4) + struct.pack(">IIII", 0, 0, timescale, duration) + bytes(80)
    hdlr = bytes(4) + bytes(4) + handler + bytes(12) + b"\x00"
    trak = _box(b"trak", _box(b"mdia", _box(b"hdlr", hdlr)))
    moov_payload = _box(b"mvhd", mvhd) + trak
    if fragmented:
        mehd = bytes(4) + struct.pack(">I", round(seconds * timescale))
        moov_payload += _box(b"mvex", _box(b"mehd", mehd))
    ftyp = _box(b"ftyp", b"isom" + bytes(4) + b"isomavc1")
    moov = _box(b"moov", moov_payload)
    mdat = _box(b"mdat", bytes(payload))
    return ftyp + mdat + moov if moov_last else ftyp + moov + mdat


def _element(element_id: int, data: bytes) -> bytes:
    id_bytes = element_id.to_bytes((element_id.bit_length() + 7) // 8, "big")
    return id_bytes + b"\x01" + len(data).to_bytes(7, "big") + data


def webm(
    seconds: float | None = 20.0,
    *,
    track_type: int = 1,
    doc_type: bytes = b"webm",
    payload: int = 256,
) -> bytes:
    header = _element(0x1A45DFA3, _element(0x4282, doc_type))
    info = _element(0x2AD7B1, (1_000_000).to_bytes(3, "big"))
    if seconds is not None:
        info += _element(0x4489, struct.pack(">d", seconds * 1000))
    tracks = _element(0x1654AE6B, _element(0xAE, _element(0x83, bytes([track_type]))))
    cluster = _element(0x1F43B675, bytes(payload))
    return header + _element(0x18538067, _element(0x1549A966, info) + tracks + cluster)
