"""The single Paper Workspace background carries over as the first Lo-Fi scene."""

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from apps.accounts.tests.helpers import create_user

BEFORE = [("focus", "0013_paper_workspace_media"), ("files", "0005_managedfile_duration")]
AFTER = [("focus", "0014_lofi_scenes")]


@pytest.mark.django_db(transaction=True)
def test_published_player_media_becomes_the_first_scene_without_a_copy() -> None:
    admin_id = create_user(email="media-admin@example.com").id
    executor = MigrationExecutor(connection)
    executor.migrate(BEFORE)
    old_apps = executor.loader.project_state(BEFORE).apps
    admin = old_apps.get_model("accounts", "User").objects.get(id=admin_id)
    ManagedFile = old_apps.get_model("files", "ManagedFile")
    PaperWorkspaceMedia = old_apps.get_model("focus", "PaperWorkspaceMedia")
    clip = ManagedFile.objects.create(
        owner=admin,
        kind="workspace_media",
        blob="managed/clip.mp4",
        original_name="clip.mp4",
        content_type="video/mp4",
        size_bytes=1024,
        checksum_sha256="0" * 64,
        validation_status="ready",
        scan_status="not_configured",
    )
    PaperWorkspaceMedia.objects.create(
        id=1, managed_file=clip, enabled=True, focal_x=30, focal_y=70, updated_by=admin
    )

    executor = MigrationExecutor(connection)
    executor.migrate(AFTER)
    new_apps = executor.loader.project_state(AFTER).apps
    LofiScene = new_apps.get_model("focus", "LofiScene")
    scene = LofiScene.objects.get()
    assert (scene.media_file_id, scene.enabled, scene.focal_x, scene.focal_y, scene.position) == (
        clip.id,
        True,
        30,
        70,
        0,
    )
    assert new_apps.get_model("files", "ManagedFile").objects.count() == 1

    # And back again, for a rollback.
    executor = MigrationExecutor(connection)
    executor.migrate(BEFORE)
    restored = executor.loader.project_state(BEFORE).apps.get_model("focus", "PaperWorkspaceMedia")
    assert restored.objects.get(id=1).managed_file_id == clip.id
    MigrationExecutor(connection).migrate(executor.loader.graph.leaf_nodes())
