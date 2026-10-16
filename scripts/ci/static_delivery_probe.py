"""Check hashed-asset compression and decoded integrity on a local CI edge.

Only explicit loopback HTTP(S) origins are accepted; redirects are never followed.
The insecure TLS option is for a locally generated CI certificate only.
"""

from __future__ import annotations

import argparse
import gzip
import http.client
import io
import json
import re
import ssl
from urllib.parse import urlsplit

MAX_BODY = 8 * 1024 * 1024
ASSET = re.compile(r"/assets/index-[A-Za-z0-9_-]+\.(?:js|css)")
WORKER = re.compile(r"/assets/pdf\.worker\.min-[A-Za-z0-9_-]+\.mjs")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--worker", required=True)
    parser.add_argument("--host", default="lockin.example.test")
    parser.add_argument("--insecure-local-tls", action="store_true")
    args = parser.parse_args()
    origin = urlsplit(args.url)
    if (
        origin.scheme not in {"http", "https"}
        or origin.hostname not in {"127.0.0.1", "::1"}
        or origin.username is not None
        or origin.password is not None
        or origin.path not in {"", "/"}
        or origin.query
        or origin.fragment
        or origin.port is None
        or not 1024 <= origin.port <= 65535
    ):
        parser.error("Use an explicit unprivileged loopback origin")
    if WORKER.fullmatch(args.worker) is None:
        parser.error("Expected the emitted hashed PDF worker path")
    if re.fullmatch(r"[A-Za-z0-9.-]+", args.host) is None:
        parser.error("Expected a plain synthetic Host name")
    context = ssl.create_default_context()
    if args.insecure_local_tls:
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

    def get(path: str, encoding: str, *, via: bool = False) -> tuple[bytes, dict[str, str]]:
        connection = (
            http.client.HTTPSConnection(origin.hostname, origin.port, timeout=10, context=context)
            if origin.scheme == "https"
            else http.client.HTTPConnection(origin.hostname, origin.port, timeout=10)
        )
        headers = {"Host": args.host, "Accept-Encoding": encoding}
        if via:
            headers["Via"] = "1.1 local-ci-proxy"
        try:
            connection.request("GET", path, headers=headers)
            response = connection.getresponse()
            body = response.read(MAX_BODY + 1)
            if response.status != 200 or len(body) > MAX_BODY:
                raise AssertionError(f"{path}: expected bounded HTTP 200, got {response.status}")
            return body, {name.lower(): value for name, value in response.getheaders()}
        finally:
            connection.close()

    html, _ = get("/", "identity")
    assets = sorted(set(ASSET.findall(html.decode("utf8"))))
    if not any(path.endswith(".js") for path in assets) or not any(
        path.endswith(".css") for path in assets
    ):
        raise AssertionError("Ordinary application JS/CSS were not found in index.html")
    assets.append(args.worker)
    results = []
    for path in assets:
        original, identity_headers = get(path, "identity")
        if (
            len(original) < 1024
            or identity_headers.get("content-encoding", "identity") != "identity"
        ):
            raise AssertionError(f"{path}: expected an uncompressed representative asset")
        expected_type = "text/css" if path.endswith(".css") else "application/javascript"
        if not identity_headers.get("content-type", "").startswith(expected_type):
            raise AssertionError(f"{path}: wrong MIME type")
        for encoding, via in (("gzip", False), ("gzip", True), ("gzip;q=0", False)):
            body, headers = get(path, encoding, via=via)
            if encoding == "gzip":
                if headers.get("content-encoding") != "gzip":
                    raise AssertionError(f"{path}: gzip negotiation failed (Via={via})")
                with gzip.GzipFile(fileobj=io.BytesIO(body)) as stream:
                    decoded = stream.read(MAX_BODY + 1)
                if decoded != original or len(body) >= len(original):
                    raise AssertionError(f"{path}: gzip corrupted or failed to reduce the asset")
            elif body != original or headers.get("content-encoding", "identity") != "identity":
                raise AssertionError(f"{path}: gzip;q=0 was not respected")
            if "accept-encoding" not in headers.get("vary", "").lower().replace(" ", "").split(","):
                raise AssertionError(f"{path}: encoding Vary is missing")
            if headers.get("cache-control") != identity_headers.get("cache-control"):
                raise AssertionError(f"{path}: cache policy changed with encoding")
            if headers.get("content-type") != identity_headers.get("content-type"):
                raise AssertionError(f"{path}: MIME type changed with encoding")
            results.append({"path": path, "encoding": encoding, "via": via, "bytes": len(body)})
    print(json.dumps({"staticDelivery": "passed", "checks": results}))


if __name__ == "__main__":
    main()
