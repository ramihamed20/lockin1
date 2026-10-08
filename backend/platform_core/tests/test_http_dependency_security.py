"""Offline regressions for HTTP dependency advisories; no sockets are opened."""

import http.client
import io
import ssl
import zlib
from unittest.mock import Mock

import pytest
from urllib3._base_connection import ProxyConfig
from urllib3.connection import HTTPSConnection
from urllib3.exceptions import HTTPError
from urllib3.response import DeflateDecoder, HTTPResponse


class _MeasuredStream(io.BytesIO):
    largest_line = 0

    def readline(self, size=-1):
        line = super().readline(size)
        self.largest_line = max(self.largest_line, len(line))
        return line


class _MemorySocket:
    def __init__(self, data):
        self.stream = _MeasuredStream(data)

    def makefile(self, *args, **kwargs):
        return self.stream


def _chunked_response(body, *, encoding=None):
    headers = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n"
    if encoding:
        headers += f"Content-Encoding: {encoding}\r\n".encode()
    socket = _MemorySocket(headers + b"\r\n" + body)
    parsed = http.client.HTTPResponse(socket, method="GET")
    parsed.begin()
    response = HTTPResponse(
        body=parsed,
        headers=dict(parsed.headers.items()),
        original_response=parsed,
        preload_content=False,
    )
    return response, socket.stream


def test_invalid_chunk_header_is_rejected_before_buffering_the_entire_line() -> None:
    # A small, in-memory malicious header proves the read budget without an OOM.
    response, stream = _chunked_response(b"X" * 80_000 + b"\r\n")
    with pytest.raises(HTTPError):
        list(response.read_chunked(amt=16))
    assert stream.largest_line <= 65_537


def test_deflate_stream_with_trailing_bytes_finishes_with_bounded_decoder_calls(
    monkeypatch,
) -> None:
    plaintext = b"synthetic-response" * 32
    encoded = zlib.compress(plaintext) + b"trailing-bytes"
    body = f"{len(encoded):x}\r\n".encode() + encoded + b"\r\n0\r\n\r\n"
    response, _ = _chunked_response(body, encoding="deflate")
    original = DeflateDecoder.decompress
    calls = 0

    def bounded_decode(self, *args, **kwargs):
        nonlocal calls
        calls += 1
        # Stop the vulnerable implementation locally instead of hanging pytest.
        assert calls <= 64, "Deflate decoding stopped making progress after EOF"
        return original(self, *args, **kwargs)

    monkeypatch.setattr(DeflateDecoder, "decompress", bounded_decode)
    assert b"".join(response.stream(amt=17, decode_content=True)) == plaintext


def test_target_tls_policy_cannot_disable_or_mutate_https_proxy_verification(monkeypatch) -> None:
    proxy_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    proxy_context.check_hostname = False
    assert proxy_context.verify_mode == ssl.CERT_REQUIRED
    connection = HTTPSConnection(
        "origin.example.test",
        cert_reqs="CERT_NONE",
        proxy_config=ProxyConfig(
            ssl_context=proxy_context,
            use_forwarding_for_https=False,
            assert_hostname=False,
            assert_fingerprint=None,
        ),
    )
    modes = []
    wrapped = Mock()

    def wrap_without_network(**kwargs):
        modes.append(kwargs["ssl_context"].verify_mode)
        return wrapped

    monkeypatch.setattr("urllib3.connection.ssl_wrap_socket", wrap_without_network)
    assert connection._connect_tls_proxy("proxy.example.test", Mock()) is wrapped
    assert modes == [ssl.CERT_REQUIRED]
    assert proxy_context.verify_mode == ssl.CERT_REQUIRED
    assert connection.cert_reqs == "CERT_NONE"
