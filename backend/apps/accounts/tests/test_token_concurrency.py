from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from datetime import timedelta
from threading import Barrier, BrokenBarrierError

import pytest
from django.db import close_old_connections, connection

from apps.accounts.models import OneTimeToken
from apps.accounts.services import issue_token
from apps.accounts.tests.helpers import create_user


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_concurrent_first_tokens_leave_only_one_usable_link() -> None:
    user = create_user(email="parallel-tokens@example.com")
    after_revocation = Barrier(2)

    def issue(_: int) -> str:
        close_old_connections()

        def pause_after_revocation(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            if sql.startswith('UPDATE "accounts_onetimetoken"'):
                # Force both issuers to revoke the initially empty token set
                # before inserting. With an account lock they cannot reach
                # this point together; the first issuer continues on timeout.
                with suppress(BrokenBarrierError):
                    after_revocation.wait(timeout=1)
            return result

        try:
            with connection.execute_wrapper(pause_after_revocation):
                return issue_token(
                    user=user,
                    kind=OneTimeToken.Kind.PASSWORD_RESET,
                    lifetime=timedelta(hours=1),
                ).raw_token
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        issued = list(pool.map(issue, range(2)))
    assert len(set(issued)) == 2
    assert OneTimeToken.objects.filter(user=user).count() == 2
    assert OneTimeToken.objects.filter(user=user, used_at__isnull=True).count() == 1
