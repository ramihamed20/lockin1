from contextvars import ContextVar, Token

request_id_context: ContextVar[str | None] = ContextVar("request_id", default=None)
remote_address_context: ContextVar[str | None] = ContextVar("remote_address", default=None)


def set_request_id(value: str) -> Token[str | None]:
    return request_id_context.set(value)


def reset_request_id(token: Token[str | None]) -> None:
    request_id_context.reset(token)


def set_remote_address(value: str | None) -> Token[str | None]:
    return remote_address_context.set(value)


def reset_remote_address(token: Token[str | None]) -> None:
    remote_address_context.reset(token)
