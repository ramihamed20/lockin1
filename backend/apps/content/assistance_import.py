"""Atomic, subject-scoped imports of short, reviewed companion cards."""

import hashlib
import json
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from django.core import signing
from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.audit.services import record_audit
from apps.education.models import EducationNode
from platform_core.api.serializers import StrictSerializer

from .models import LearningObject, LearningObjectVersion, StudyAssistanceIdea
from .study_assistance import AssistanceRuleError, scope_page_count, validate_page
from .study_assistance_views import AssistanceConflictError


class CardSerializer(StrictSerializer):
    key = serializers.RegexField(r"^[A-Za-z0-9_-]{1,80}$")
    page = serializers.IntegerField(min_value=1, allow_null=True)
    kind = serializers.ChoiceField(choices=StudyAssistanceIdea.Kind.choices)
    teaser = serializers.CharField(max_length=100)
    question = serializers.CharField(max_length=160)
    explanation = serializers.CharField(max_length=600)
    followup_question = serializers.CharField(
        max_length=160, required=False, default="", allow_blank=True
    )
    followup_answer = serializers.CharField(
        max_length=280, required=False, default="", allow_blank=True
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if bool(attrs["followup_question"]) != bool(attrs["followup_answer"]):
            raise serializers.ValidationError("Provide both follow-up fields, or neither.")
        return attrs


class SheetSerializer(StrictSerializer):
    sheet_id = serializers.UUIDField()
    source_version_id = serializers.UUIDField()
    cards = CardSerializer(many=True, allow_empty=False, max_length=200)  # type: ignore[call-arg]

    def validate_cards(self, cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len({card["key"] for card in cards}) != len(cards):
            raise serializers.ValidationError("Card keys must be unique within a sheet.")
        return cards


class ImportSerializer(StrictSerializer):
    schema_version = serializers.ChoiceField(choices=[1])
    subject_id = serializers.UUIDField()
    edition = serializers.ChoiceField(choices=["university", "lockin"])
    view = serializers.ChoiceField(choices=["study", "summary"])
    sheets = SheetSerializer(many=True, allow_empty=False, max_length=100)  # type: ignore[call-arg]

    def validate_sheets(self, sheets: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len({s["sheet_id"] for s in sheets}) != len(sheets):
            raise serializers.ValidationError("Each sheet may appear only once.")
        if sum(len(s["cards"]) for s in sheets) > 2000:
            raise serializers.ValidationError("Import at most 2000 cards at a time.")
        return sheets


def subject_for(sheet: LearningObject) -> EducationNode:
    if sheet.current_version is None:
        raise ValidationError("The sheet has no current version.")
    node = sheet.current_version.academic_node
    while node.kind != EducationNode.Kind.SUBJECT and node.parent is not None:
        node = node.parent
    if node.kind != EducationNode.Kind.SUBJECT:
        raise ValidationError("The sheet must belong to one subject.")
    return node


def manifest(anchor: LearningObject, edition: str, view: str) -> dict[str, Any]:
    subject = subject_for(anchor)
    rows = (
        LearningObject.objects.filter(
            current_version__academic_node__path__startswith=subject.path,
            current_version__content_type="pdf",
            archived_at__isnull=True,
        )
        .select_related("current_version")
        .order_by("position", "id")
    )
    sheets = []
    for sheet in rows:
        if sheet.current_version is None:
            continue
        try:
            count = scope_page_count(version=sheet.current_version, edition=edition, view=view)
        except AssistanceRuleError:
            continue
        sheets.append(
            {
                "sheet_id": str(sheet.id),
                "source_version_id": str(sheet.current_version_id),
                "title": sheet.current_version.title,
                "page_count": count,
            }
        )
        if len(sheets) > 100:
            raise ValidationError("Select a smaller subject branch (at most 100 sheets).")
    return {
        "subject_id": str(subject.id),
        "subject_title": subject.title,
        "edition": edition,
        "view": view,
        "sheets": sheets,
    }


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


@transaction.atomic
def import_cards(
    *, actor: User, anchor_id: UUID, raw: Any, publish: bool = False, token: str = ""
) -> dict[str, Any]:
    serializer = ImportSerializer(data=raw)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    # Every writer locks LearningObject before its assistance rows, as manual editing does.
    ids = sorted({anchor_id, *(s["sheet_id"] for s in data["sheets"])}, key=str)
    locked = {
        s.id: s
        for s in LearningObject.objects.select_for_update().filter(id__in=ids).order_by("id")
    }
    if len(locked) != len(ids):
        raise ValidationError("One or more sheets are unavailable.")
    anchor = locked[anchor_id]
    if not anchor.current_version_id:
        raise ValidationError("The anchor sheet has no current version.")
    subject = subject_for(anchor)
    if data["subject_id"] != subject.id:
        raise ValidationError("This JSON belongs to a different subject.")
    changes: list[
        tuple[StudyAssistanceIdea | None, UUID, LearningObjectVersion, dict[str, Any], bool]
    ] = []
    preview: list[dict[str, Any]] = []
    snapshot: list[Any] = []
    for imported in data["sheets"]:
        sheet = locked[imported["sheet_id"]]
        version = sheet.current_version
        if version is None:
            raise AssistanceConflictError("The sheet has no current version.")
        if sheet.archived_at or sheet.current_version_id != imported["source_version_id"]:
            raise AssistanceConflictError("A sheet version changed. Download a fresh prompt.")
        if version.content_type != "pdf" or subject_for(sheet).id != subject.id:
            raise ValidationError("All sheets must belong to the same subject.")
        try:
            count = scope_page_count(version=version, edition=data["edition"], view=data["view"])
        except AssistanceRuleError as exc:
            raise ValidationError(str(exc)) from exc
        existing = {
            r.id: r
            for r in StudyAssistanceIdea.objects.filter(
                source_version=version, edition=data["edition"], view=data["view"]
            )
        }
        snapshot.append(
            [
                str(sheet.id),
                str(sheet.current_version_id),
                count,
                sorted((str(r.id), r.revision) for r in existing.values()),
            ]
        )
        new_ids = set()
        for index, card in enumerate(imported["cards"]):
            try:
                validate_page(card["page"], count)
            except AssistanceRuleError as exc:
                raise ValidationError(f"{version.title}, card {card['key']}: {exc}") from exc
            identity = uuid5(
                NAMESPACE_URL,
                f"lockin:companion:{sheet.id}:{sheet.current_version_id}:{data['edition']}:{data['view']}:{card['key']}",
            )
            fields = {k: v for k, v in card.items() if k != "key"}
            fields.update(position=index, is_published=publish)
            old = existing.get(identity)
            changed = old is None or any(getattr(old, k) != v for k, v in fields.items())
            new_ids.add(identity)
            changes.append((old, identity, version, fields, changed))
        if len(set(existing) | new_ids) > 200:
            raise ValidationError(
                "A sheet may contain at most 200 cards for this edition and view."
            )
        preview.append(
            {
                "sheet_id": str(sheet.id),
                "title": version.title,
                "count": len(imported["cards"]),
                "cards": imported["cards"],
            }
        )
    payload_hash = digest(
        {"data": data, "publish": publish, "actor": str(actor.id), "anchor": str(anchor_id)}
    )
    stamp = digest(snapshot)
    changed_count = sum(changed for *_, changed in changes)
    if not token:
        return {
            "preview_token": signing.dumps(
                {"payload": payload_hash, "snapshot": stamp}, salt="companion-import"
            ),
            "sheets": preview,
            "count": len(changes),
            "changed_count": changed_count,
            "published": publish,
        }
    try:
        confirmed = signing.loads(token, salt="companion-import", max_age=900)
    except signing.BadSignature as exc:
        raise AssistanceConflictError("Preview expired. Validate the file again.") from exc
    if confirmed.get("payload") != payload_hash or (
        changed_count and confirmed.get("snapshot") != stamp
    ):
        raise AssistanceConflictError(
            "Content changed after preview. Validate again before saving."
        )
    for old, identity, version, fields, changed in changes:
        if not changed:
            continue
        if old:
            for key, value in fields.items():
                setattr(old, key, value)
            old.revision += 1
            old.save()
        else:
            StudyAssistanceIdea.objects.create(
                id=identity,
                source_version=version,
                edition=data["edition"],
                view=data["view"],
                **fields,
            )
    if changed_count:
        record_audit(
            actor=actor,
            action="content.study_assistance_imported",
            domain="content",
            target_type="education_node",
            target_id=str(subject.id),
            source="content_studio",
            reason="Reviewed companion JSON import",
            new_state={"cards": len(changes), "changed": changed_count, "published": publish},
        )
    return {"imported": len(changes), "changed_count": changed_count, "published": publish}
