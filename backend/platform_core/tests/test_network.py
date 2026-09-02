from dataclasses import dataclass, field

import pytest

from platform_core.network import client_ip


@dataclass
class Request:
    META: dict[str, object] = field(default_factory=dict)


def test_direct_client_cannot_spoof_forwarded_address(settings) -> None:  # type: ignore[no-untyped-def]
    settings.TRUSTED_PROXY_CIDRS = ["10.0.0.0/8"]
    request = Request({"REMOTE_ADDR": "198.51.100.9", "HTTP_X_FORWARDED_FOR": "203.0.113.44"})

    assert client_ip(request) == "198.51.100.9"


def test_single_trusted_proxy_resolves_the_client(settings) -> None:  # type: ignore[no-untyped-def]
    settings.TRUSTED_PROXY_CIDRS = ["172.28.0.0/24"]
    request = Request({"REMOTE_ADDR": "172.28.0.5", "HTTP_X_FORWARDED_FOR": "198.51.100.9"})

    assert client_ip(request) == "198.51.100.9"


def test_multi_hop_chain_discards_only_known_proxies(settings) -> None:  # type: ignore[no-untyped-def]
    settings.TRUSTED_PROXY_CIDRS = ["10.0.0.0/8", "172.28.0.0/24"]
    request = Request(
        {
            "REMOTE_ADDR": "172.28.0.5",
            "HTTP_X_FORWARDED_FOR": "203.0.113.77, 10.4.3.2",
        }
    )

    assert client_ip(request) == "203.0.113.77"


def test_spoofed_left_entry_cannot_cross_an_untrusted_hop(settings) -> None:  # type: ignore[no-untyped-def]
    settings.TRUSTED_PROXY_CIDRS = ["172.28.0.0/24"]
    request = Request(
        {
            "REMOTE_ADDR": "172.28.0.5",
            "HTTP_X_FORWARDED_FOR": "192.0.2.8, 198.51.100.9",
        }
    )

    assert client_ip(request) == "198.51.100.9"


def test_invalid_peer_and_invalid_proxy_configuration_fail_closed(settings) -> None:  # type: ignore[no-untyped-def]
    settings.TRUSTED_PROXY_CIDRS = ["not-a-network"]

    assert client_ip(Request({"REMOTE_ADDR": "not-an-address"})) == "unknown"
    assert client_ip(Request({"REMOTE_ADDR": "198.51.100.9"})) == "198.51.100.9"


@pytest.mark.parametrize(
    "forwarded",
    [
        "",
        "invalid",
        ",".join(["198.51.100.9"] * 21),
        "x" * 1025,
    ],
)
def test_trusted_proxy_rejects_missing_malformed_or_oversized_chains(
    settings,
    forwarded: str,  # type: ignore[no-untyped-def]
) -> None:
    settings.TRUSTED_PROXY_CIDRS = ["172.28.0.0/24"]
    request = Request({"REMOTE_ADDR": "172.28.0.5", "HTTP_X_FORWARDED_FOR": forwarded})

    assert client_ip(request) == "172.28.0.5"


def test_all_trusted_forwarded_chain_uses_the_leftmost_address(settings) -> None:  # type: ignore[no-untyped-def]
    settings.TRUSTED_PROXY_CIDRS = ["172.28.0.0/24"]
    request = Request(
        {
            "REMOTE_ADDR": "172.28.0.5",
            "HTTP_X_FORWARDED_FOR": "172.28.0.8, 172.28.0.9",
        }
    )

    assert client_ip(request) == "172.28.0.8"
