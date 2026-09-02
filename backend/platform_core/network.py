from __future__ import annotations

from ipaddress import IPv4Address, IPv4Network, IPv6Address, IPv6Network, ip_address, ip_network
from typing import Protocol

from django.conf import settings


class RequestWithMeta(Protocol):
    META: dict[str, object]


IPAddress = IPv4Address | IPv6Address
IPNetwork = IPv4Network | IPv6Network


def _parse_address(value: object) -> IPAddress | None:
    try:
        return ip_address(str(value).strip())
    except ValueError:
        return None


def _trusted_proxy_networks() -> tuple[IPNetwork, ...]:
    networks: list[IPNetwork] = []
    for value in getattr(settings, "TRUSTED_PROXY_CIDRS", []):
        try:
            networks.append(ip_network(str(value), strict=False))
        except ValueError:
            continue
    return tuple(networks)


def _is_trusted_proxy(address: IPAddress, networks: tuple[IPNetwork, ...]) -> bool:
    return any(address.version == network.version and address in network for network in networks)


def client_ip(request: RequestWithMeta) -> str:
    """Resolve a client address only through an explicitly trusted proxy chain.

    Direct clients cannot influence the result with forwarded headers. When the
    immediate peer is trusted, the chain is walked from right to left and the
    first untrusted address is authoritative. Malformed or oversized headers
    fail closed to the socket peer.
    """

    peer = _parse_address(request.META.get("REMOTE_ADDR", ""))
    if peer is None:
        return "unknown"
    networks = _trusted_proxy_networks()
    if not networks or not _is_trusted_proxy(peer, networks):
        return peer.compressed

    raw_forwarded = str(request.META.get("HTTP_X_FORWARDED_FOR", ""))
    if not raw_forwarded or len(raw_forwarded) > 1024:
        return peer.compressed
    values = [value.strip() for value in raw_forwarded.split(",")]
    if not values or len(values) > 20:
        return peer.compressed
    forwarded = [_parse_address(value) for value in values]
    if any(address is None for address in forwarded):
        return peer.compressed

    valid_forwarded = [address for address in forwarded if address is not None]
    chain = [*valid_forwarded, peer]
    for address in reversed(chain):
        if not _is_trusted_proxy(address, networks):
            return address.compressed
    return valid_forwarded[0].compressed if valid_forwarded else peer.compressed
