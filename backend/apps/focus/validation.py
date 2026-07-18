import json
import math
import re
from collections.abc import Mapping, Sequence
from decimal import Decimal
from typing import Any
from uuid import UUID

from .models import FocusWorkspaceSnapshot

FOCUS_TOOLS = frozenset(
    {
        "pen",
        "pencil",
        "highlighter",
        "line",
        "arrow",
        "rectangle",
        "circle",
        "text",
        "sticky-note",
    }
)
WORKSPACE_TOOLS = FOCUS_TOOLS | {"eraser"}
STROKE_TOOLS = frozenset({"pen", "pencil", "highlighter"})
SHAPE_TOOLS = frozenset({"line", "arrow", "rectangle", "circle"})
TEXT_TOOLS = frozenset({"text", "sticky-note"})
POINTER_KINDS = frozenset({"pen", "touch", "mouse", "unknown"})
COLOR_PATTERN = re.compile(r"#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?")
MAX_ANNOTATION_PAYLOAD_BYTES = 128 * 1024
MAX_WORKSPACE_STATE_BYTES = 8 * 1024
MAX_STROKE_SAMPLES = 2048
MAX_OPEN_TABS = 8


class FocusValidationError(ValueError):
    pass


def _number(value: object, *, label: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise FocusValidationError(f"{label} must be a number.")
    parsed = float(value)
    if not math.isfinite(parsed) or not minimum <= parsed <= maximum:
        raise FocusValidationError(f"{label} is outside the supported range.")
    return parsed


def _point(value: object, *, label: str) -> dict[str, float]:
    if not isinstance(value, Mapping) or set(value) != {"x", "y"}:
        raise FocusValidationError(f"{label} must contain normalized x and y values.")
    return {
        "x": _number(value["x"], label=f"{label}.x", minimum=0, maximum=1),
        "y": _number(value["y"], label=f"{label}.y", minimum=0, maximum=1),
    }


def validate_bounds(value: object) -> dict[str, float]:
    required = {"x", "y", "width", "height"}
    if not isinstance(value, Mapping) or set(value) != required:
        raise FocusValidationError("Annotation bounds must contain x, y, width, and height.")
    bounds = {
        key: _number(value[key], label=f"bounds.{key}", minimum=0, maximum=1) for key in required
    }
    if bounds["x"] + bounds["width"] > 1.001 or bounds["y"] + bounds["height"] > 1.001:
        raise FocusValidationError("Annotation bounds must stay inside the normalized page.")
    return bounds


def validate_payload(*, tool: str, value: object) -> dict[str, Any]:
    if tool not in FOCUS_TOOLS:
        raise FocusValidationError("The annotation tool is not supported.")
    if not isinstance(value, Mapping):
        raise FocusValidationError("Annotation payload must be an object.")
    payload = dict(value)
    if len(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()) > (
        MAX_ANNOTATION_PAYLOAD_BYTES
    ):
        raise FocusValidationError("Annotation payload is too large.")

    if tool in STROKE_TOOLS:
        if set(payload) != {"kind", "samples"} or payload.get("kind") != "stroke":
            raise FocusValidationError("A drawing annotation requires stroke samples.")
        samples = payload["samples"]
        if (
            not isinstance(samples, Sequence)
            or isinstance(samples, (str, bytes))
            or not 2 <= len(samples) <= MAX_STROKE_SAMPLES
        ):
            raise FocusValidationError("A stroke requires between 2 and 2048 samples.")
        normalized: list[dict[str, object]] = []
        required = {"x", "y", "pointer", "pressure", "tiltX", "tiltY", "timestamp"}
        for index, sample in enumerate(samples):
            if not isinstance(sample, Mapping) or set(sample) != required:
                raise FocusValidationError(f"Stroke sample {index} has an invalid shape.")
            pointer = sample["pointer"]
            if pointer not in POINTER_KINDS:
                raise FocusValidationError(f"Stroke sample {index} has an invalid pointer type.")
            normalized.append(
                {
                    "x": _number(sample["x"], label="sample.x", minimum=0, maximum=1),
                    "y": _number(sample["y"], label="sample.y", minimum=0, maximum=1),
                    "pointer": pointer,
                    "pressure": _number(
                        sample["pressure"], label="sample.pressure", minimum=0, maximum=1
                    ),
                    "tiltX": _number(
                        sample["tiltX"], label="sample.tiltX", minimum=-90, maximum=90
                    ),
                    "tiltY": _number(
                        sample["tiltY"], label="sample.tiltY", minimum=-90, maximum=90
                    ),
                    "timestamp": _number(
                        sample["timestamp"],
                        label="sample.timestamp",
                        minimum=0,
                        maximum=9_999_999_999_999,
                    ),
                }
            )
        return {"kind": "stroke", "samples": normalized}

    if tool in SHAPE_TOOLS:
        if set(payload) != {"kind", "start", "end"} or payload.get("kind") != "shape":
            raise FocusValidationError("A shape annotation requires start and end points.")
        return {
            "kind": "shape",
            "start": _point(payload["start"], label="shape.start"),
            "end": _point(payload["end"], label="shape.end"),
        }

    expected_kind = "sticky-note" if tool == "sticky-note" else "text"
    if set(payload) != {"kind", "value"} or payload.get("kind") != expected_kind:
        raise FocusValidationError("A note annotation requires the expected text payload.")
    text = payload["value"]
    if not isinstance(text, str) or not text.strip() or len(text) > 4000:
        raise FocusValidationError("Annotation text must contain 1 to 4000 characters.")
    return {"kind": expected_kind, "value": text.strip()}


def validate_color(value: str) -> str:
    if COLOR_PATTERN.fullmatch(value) is None:
        raise FocusValidationError("Annotation color must be a six or eight digit hex color.")
    return value.lower()


def validate_workspace_state(
    *,
    current_page: int,
    page_count: int | None,
    zoom: object,
    sidebar: str,
    active_tool: str,
    layout: object,
    open_tabs: object,
) -> tuple[dict[str, Any], list[str]]:
    if current_page < 1 or (page_count is not None and current_page > page_count):
        raise FocusValidationError("The current page is outside the document.")
    _number(zoom, label="zoom", minimum=0.5, maximum=4)
    if sidebar not in FocusWorkspaceSnapshot.Sidebar.values:
        raise FocusValidationError("The workspace sidebar is not supported.")
    if active_tool and active_tool not in WORKSPACE_TOOLS:
        raise FocusValidationError("The active Focus tool is not supported.")
    if not isinstance(layout, Mapping):
        raise FocusValidationError("Workspace layout must be an object.")
    allowed_layout = {"toolbar_collapsed", "notes_width", "reading_direction"}
    if set(layout) - allowed_layout:
        raise FocusValidationError("Workspace layout contains unsupported fields.")
    normalized_layout = dict(layout)
    if "toolbar_collapsed" in normalized_layout and not isinstance(
        normalized_layout["toolbar_collapsed"], bool
    ):
        raise FocusValidationError("toolbar_collapsed must be a boolean.")
    if "notes_width" in normalized_layout:
        _number(
            normalized_layout["notes_width"],
            label="notes_width",
            minimum=240,
            maximum=640,
        )
    if normalized_layout.get("reading_direction") not in {None, "vertical"}:
        raise FocusValidationError("Only vertical reading is currently supported.")
    if (
        not isinstance(open_tabs, list)
        or len(open_tabs) > MAX_OPEN_TABS
        or any(not isinstance(item, str) for item in open_tabs)
    ):
        raise FocusValidationError("Open tabs must be a bounded list of document version IDs.")
    try:
        normalized_tabs = [str(UUID(item)) for item in open_tabs]
    except ValueError as error:
        raise FocusValidationError("Open tabs contain an invalid document version ID.") from error
    serialized = json.dumps(
        {"layout": normalized_layout, "open_tabs": normalized_tabs},
        separators=(",", ":"),
    ).encode()
    if len(serialized) > MAX_WORKSPACE_STATE_BYTES:
        raise FocusValidationError("Workspace state is too large.")
    return normalized_layout, normalized_tabs
