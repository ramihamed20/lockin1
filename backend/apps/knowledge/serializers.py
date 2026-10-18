import json
import math
import re
from typing import Any

from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer

MAX_BYTES = 1024 * 1024


def text(value: Any, limit: int) -> str:
    if not isinstance(value, str) or len(value) > limit or "\x00" in value:
        raise serializers.ValidationError("Invalid text content.")
    return value


def number(value: Any, low: float = -10000, high: float = 10000) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise serializers.ValidationError("Invalid coordinate.")
    if not math.isfinite(value) or not low <= value <= high:
        raise serializers.ValidationError("Coordinate out of bounds.")
    return float(value)


def identifier(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", value):
        raise serializers.ValidationError("Invalid drawing identifier.")
    return value


def validate_content(value: Any, kind: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise serializers.ValidationError("Invalid document content.")
    try:
        size = len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())
    except (UnicodeEncodeError, TypeError, ValueError) as error:
        raise serializers.ValidationError("Invalid document text encoding.") from error
    if size > MAX_BYTES:
        raise serializers.ValidationError("Document exceeds the 1 MB limit.")
    allowed = (
        {"text", "paper", "strokes", "suggestions", "concept_ids"}
        if kind == "summary"
        else {
            "nodes",
            "edges",
            "viewport",
            "concept_ids",
        }
    )
    if set(value) - allowed:
        raise serializers.ValidationError("Unsupported document fields.")
    concepts = value.get("concept_ids", [])
    if not isinstance(concepts, list) or len(concepts) > 100:
        raise serializers.ValidationError("Invalid concept links.")
    for item in concepts:
        serializers.UUIDField().run_validation(item)
    if kind == "summary":
        text(value.get("text", ""), 100000)
        if value.get("paper", "ruled") not in ("ruled", "blank", "grid", "dotted"):
            raise serializers.ValidationError("Unsupported paper.")
        suggestions = value.get("suggestions", [])
        if not isinstance(suggestions, list) or len(suggestions) > 100:
            raise serializers.ValidationError("Too many suggestions.")
        for item in suggestions:
            text(item, 10000)
        strokes = value.get("strokes", [])
        if not isinstance(strokes, list) or len(strokes) > 500:
            raise serializers.ValidationError("Too many strokes.")
        point_count = 0
        for stroke in strokes:
            if not isinstance(stroke, dict) or set(stroke) - {
                "id",
                "color",
                "width",
                "tool",
                "points",
            }:
                raise serializers.ValidationError("Invalid stroke.")
            identifier(stroke.get("id"))
            color(stroke.get("color"))
            number(stroke.get("width"), 1, 24)
            if stroke.get("tool") not in ("pen", "highlighter"):
                raise serializers.ValidationError("Invalid drawing tool.")
            points = stroke.get("points")
            if not isinstance(points, list) or not 1 <= len(points) <= 10000:
                raise serializers.ValidationError("Invalid stroke points.")
            point_count += len(points)
            for point in points:
                if not isinstance(point, list) or len(point) != 3:
                    raise serializers.ValidationError("Invalid stroke point.")
                number(point[0], 0, 1000)
                number(point[1], 0, 1400)
                number(point[2], 0, 1)
        if point_count > 100000:
            raise serializers.ValidationError("Too many drawing points.")
    else:
        nodes, edges = value.get("nodes", []), value.get("edges", [])
        if not isinstance(nodes, list) or len(nodes) > 300:
            raise serializers.ValidationError("Too many map nodes.")
        ids = set()
        for node in nodes:
            if not isinstance(node, dict) or set(node) - {
                "id",
                "text",
                "x",
                "y",
                "width",
                "height",
                "shape",
                "color",
                "concept_id",
                "group",
            }:
                raise serializers.ValidationError("Invalid map node.")
            node_id = identifier(node.get("id"))
            if node_id in ids:
                raise serializers.ValidationError("Duplicate node.")
            ids.add(node_id)
            text(node.get("text", ""), 2000)
            text(node.get("group", ""), 80)
            color(node.get("color", "#8067ca"))
            for key in ("x", "y"):
                number(node.get(key, 0))
            number(node.get("width", 180), 60, 1000)
            number(node.get("height", 90), 40, 1000)
            if node.get("shape", "rectangle") not in ("rectangle", "circle", "section"):
                raise serializers.ValidationError("Invalid node shape.")
            if node.get("concept_id"):
                serializers.UUIDField().run_validation(node["concept_id"])
        if not isinstance(edges, list) or len(edges) > 600:
            raise serializers.ValidationError("Too many map connections.")
        edge_ids = set()
        for edge in edges:
            if not isinstance(edge, dict) or set(edge) - {"id", "from", "to", "label", "style"}:
                raise serializers.ValidationError("Invalid connection.")
            edge_id = identifier(edge.get("id"))
            if edge_id in edge_ids or edge.get("from") not in ids or edge.get("to") not in ids:
                raise serializers.ValidationError("Invalid connection endpoints.")
            edge_ids.add(edge_id)
            text(edge.get("label", ""), 500)
            if edge.get("style", "solid") not in ("solid", "dashed"):
                raise serializers.ValidationError("Invalid line style.")
        viewport = value.get("viewport", {"x": 0, "y": 0, "zoom": 1})
        if not isinstance(viewport, dict) or set(viewport) - {"x", "y", "zoom"}:
            raise serializers.ValidationError("Invalid viewport.")
        number(viewport.get("x", 0))
        number(viewport.get("y", 0))
        number(viewport.get("zoom", 1), 0.25, 3)
    return value


def color(value: Any) -> None:

    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise serializers.ValidationError("Invalid color.")


class ArtifactWriteSerializer(StrictSerializer):
    account_id = serializers.UUIDField()
    mutation_id = serializers.UUIDField()
    expected_revision = serializers.IntegerField(min_value=0)
    source_version_id = serializers.UUIDField()
    source_file_id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=["summary", "map"])
    title = serializers.CharField(max_length=220)
    page_start = serializers.IntegerField(min_value=1, max_value=10000)
    page_end = serializers.IntegerField(min_value=1, max_value=10000)
    content = serializers.JSONField()
    deleted = serializers.BooleanField(default=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if attrs["page_end"] < attrs["page_start"]:
            raise serializers.ValidationError("Invalid page range.")
        validate_content(attrs["content"], attrs["kind"])
        return attrs


class AttemptWriteSerializer(StrictSerializer):
    account_id = serializers.UUIDField()
    question_id = serializers.UUIDField()
    question_revision = serializers.IntegerField(min_value=1)
    answer = serializers.CharField(max_length=10000)
    self_rating = serializers.ChoiceField(
        choices=["", "needs_review", "partial", "understood"],
        default="",
    )
