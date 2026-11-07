import pytest

from apps.accounts.services import _coarse_device_label


@pytest.mark.parametrize(
    ("user_agent", "expected"),
    [
        ("Mozilla/5.0 Chrome/126", "Chrome on Computer"),
        ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile Safari/604.1", "Safari on iPhone"),
        ("Mozilla/5.0 (iPad; CPU OS 18_0) Mobile Safari/604.1", "Safari on iPad"),
        ("Mozilla/5.0 (iPad; CPU OS 18_0) CriOS/130 Mobile Safari/604.1", "Chrome on iPad"),
        ("Mozilla/5.0 (iPhone) FxiOS/130 Mobile Safari/604.1", "Firefox on iPhone"),
        ("Mozilla/5.0 (Linux; Android 15) Chrome/130 Mobile Safari/537", "Chrome on Android phone"),
        ("Mozilla/5.0 (Linux; Android 15) Chrome/130 Safari/537", "Chrome on Android tablet"),
        ("Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/18 Safari/605", "Safari on Mac"),
        ("Mozilla/5.0 (Windows NT 10.0) Chrome/130 Edg/130", "Edge on Windows computer"),
        (
            "Mozilla/5.0 (Android 15) Chrome/130 Mobile SamsungBrowser/26",
            "Samsung Internet on Android phone",
        ),
        ("", "Browser on Computer"),
    ],
)
def test_coarse_device_label(user_agent: str, expected: str) -> None:
    assert _coarse_device_label(user_agent) == expected
