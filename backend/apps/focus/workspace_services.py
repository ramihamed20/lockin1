from decimal import Decimal
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User

from .domain_types import WorkspaceStateInput
from .models import FocusSession, FocusWorkspaceSnapshot
from .validation import FocusValidationError, validate_workspace_state


class FocusWorkspaceConflictError(ValueError):
    pass


@transaction.atomic
def update_workspace_state(
    *,
    user: User,
    session_id: UUID,
    expected_revision: int,
    state: WorkspaceStateInput,
) -> FocusWorkspaceSnapshot:
    try:
        workspace = (
            FocusWorkspaceSnapshot.objects.select_for_update()
            .select_related("session")
            .get(session_id=session_id, user=user)
        )
    except FocusWorkspaceSnapshot.DoesNotExist as error:
        raise FocusValidationError("Focus workspace was not found.") from error
    if workspace.session.status not in {
        FocusSession.Status.ACTIVE,
        FocusSession.Status.PAUSED,
    }:
        raise FocusValidationError("A closed Focus workspace cannot be updated.")
    if workspace.revision != expected_revision:
        raise FocusWorkspaceConflictError("Workspace changed. Reload it and try again.")
    if workspace.page_count is not None and state.page_count not in {
        None,
        workspace.page_count,
    }:
        raise FocusValidationError("The document page count cannot change for this version.")
    page_count = workspace.page_count or state.page_count
    if page_count is not None and not 1 <= page_count <= 10_000:
        raise FocusValidationError("The document page count is outside the supported range.")
    layout, open_tabs = validate_workspace_state(
        current_page=state.current_page,
        page_count=page_count,
        zoom=state.zoom,
        sidebar=state.sidebar,
        active_tool=state.active_tool,
        layout=state.layout,
        open_tabs=state.open_tabs,
    )
    workspace.current_page = state.current_page
    workspace.page_count = page_count
    workspace.zoom = Decimal(state.zoom).quantize(Decimal("0.01"))
    workspace.sidebar = state.sidebar
    workspace.active_tool = state.active_tool
    workspace.layout = layout
    workspace.open_tabs = open_tabs
    workspace.revision += 1
    workspace.save()
    workspace.session.last_activity_at = timezone.now()
    workspace.session.revision += 1
    workspace.session.save(update_fields=("last_activity_at", "revision", "updated_at"))
    return workspace
