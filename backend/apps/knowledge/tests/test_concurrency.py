from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from django.db import close_old_connections

from apps.knowledge.models import StudentArtifact
from apps.knowledge.serializers import ArtifactWriteSerializer
from apps.knowledge.services import KnowledgeConflict, save_artifact

from .test_api import body


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_first_save_serializes_even_before_artifact_row_exists(setup, settings):
    settings.KNOWLEDGE_ENABLED = True
    document, user, *_ = setup
    identifier = uuid4()
    barrier = Barrier(2)

    def save(index):
        close_old_connections()
        serializer = ArtifactWriteSerializer(data=body(document, title=f"writer-{index}"))
        assert serializer.is_valid()
        barrier.wait(timeout=10)
        try:
            save_artifact(user, document, identifier, serializer.validated_data)
            return "saved"
        except KnowledgeConflict:
            return "conflict"
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, [1, 2]))
    assert sorted(results) == ["conflict", "saved"]
    assert StudentArtifact.objects.filter(pk=identifier).count() == 1
    assert StudentArtifact.objects.get(pk=identifier).revision == 1


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("same_retry", [True, False])
def test_parallel_revision_updates_and_lost_ack_retries(setup, settings, same_retry):
    settings.KNOWLEDGE_ENABLED = True
    document, user, *_ = setup
    identifier = uuid4()
    first = ArtifactWriteSerializer(data=body(document))
    assert first.is_valid()
    save_artifact(user, document, identifier, first.validated_data)
    barrier = Barrier(2)
    mutation = str(uuid4())

    def update(index):
        close_old_connections()
        serializer = ArtifactWriteSerializer(
            data=body(
                document,
                expected_revision=1,
                mutation_id=mutation if same_retry else str(uuid4()),
                title="retry" if same_retry else f"writer-{index}",
            )
        )
        assert serializer.is_valid()
        barrier.wait(timeout=10)
        try:
            return ("saved", save_artifact(user, document, identifier, serializer.validated_data))
        except KnowledgeConflict:
            return ("conflict", None)
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(update, [1, 2]))
    assert StudentArtifact.objects.get(pk=identifier).revision == 2
    if same_retry:
        assert results[0] == results[1]
        assert results[0][0] == "saved"
    else:
        assert sorted(item[0] for item in results) == ["conflict", "saved"]
