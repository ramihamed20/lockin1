from __future__ import annotations

from typing import Any
from uuid import UUID

from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from platform_core.api.exceptions import RequestRejected
from platform_core.api.serializers import StrictSerializer

from .admin_views import _ContentPermissionView
from .models import CatalogSubject, PracticeSet, PracticeSlide
from .practice_sets import (
    ANSWER_MAX_LENGTH,
    HOTSPOT_SHAPES,
    TITLE_MAX_LENGTH,
    PracticeError,
    add_slides,
    add_slides_from_archive,
    admin_sets,
    check_attempt,
    create_set,
    delete_set,
    delete_slide,
    duplicate_set,
    max_slides_per_set,
    most_missed,
    move_slide,
    ordered_slides,
    progress_by_slide,
    published_sets,
    reorder_slides,
    replace_slide_image,
    reveal_hint,
    set_answers_in_order,
    set_slide_answer,
    set_slide_hotspot,
    set_stats,
    slide_state,
    update_set,
    visible_set,
)

MAX_FILES_PER_REQUEST = 50


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _rejected(error: PracticeError) -> RequestRejected:
    return RequestRejected(str(error), code=error.code)


def _image_url(slide: PracticeSlide) -> str:
    return f"/api/v1/files/{slide.managed_file_id}/view"


# --- Students ---------------------------------------------------------------


class PracticeCheckSerializer(StrictSerializer):
    answer = serializers.CharField(
        allow_blank=True, trim_whitespace=False, max_length=ANSWER_MAX_LENGTH * 2
    )


class PracticeDirectoryView(APIView):
    """Subjects of the student's cohort that have a published set, with those sets."""

    def get(self, request: Request) -> Response:
        user = _user(request)
        subjects: dict[UUID, dict[str, Any]] = {}
        listed = list(published_sets(user))
        stats = set_stats(user=user, sets=listed)
        for practice_set in listed:
            subject = practice_set.subject
            entry = subjects.setdefault(
                subject.id,
                {
                    "slug": subject.material_slug,
                    "title": subject.title,
                    "sets": [],
                    "slideCount": 0,
                },
            )
            slide_count = int(getattr(practice_set, "slide_count", 0))
            entry["sets"].append(
                {
                    "id": str(practice_set.id),
                    "title": practice_set.title,
                    "slideCount": slide_count,
                    "stats": stats[practice_set.id],
                }
            )
            entry["slideCount"] += slide_count
        return Response({"results": list(subjects.values())})


def _hotspot(slide: PracticeSlide) -> dict[str, Any] | None:
    if slide.hotspot_x is None or slide.hotspot_y is None or not slide.hotspot_shape:
        return None
    return {"x": slide.hotspot_x, "y": slide.hotspot_y, "shape": slide.hotspot_shape}


def _open_slide(
    request: Request, set_id: UUID, slide_id: UUID
) -> tuple[User, PracticeSet, PracticeSlide]:
    user = _user(request)
    practice_set = visible_set(user=user, set_id=set_id)
    if practice_set is None:
        raise NotFound("Practice set not found.")
    slide = practice_set.slides.filter(id=slide_id).first()
    if slide is None:
        raise NotFound("Slide not found.")
    return user, practice_set, slide


class PracticeSetView(APIView):
    """One set: its images in order with where the student stands, never its answers."""

    def get(self, request: Request, set_id: UUID) -> Response:
        user = _user(request)
        practice_set = visible_set(user=user, set_id=set_id)
        if practice_set is None:
            raise NotFound("Practice set not found.")
        now = timezone.now()
        progress = progress_by_slide(user=user, practice_set=practice_set)
        return Response(
            {
                "id": str(practice_set.id),
                "title": practice_set.title,
                "preview": not practice_set.is_published,
                "subject": {
                    "slug": practice_set.subject.material_slug,
                    "title": practice_set.subject.title,
                },
                "slides": [
                    {
                        "id": str(slide.id),
                        "position": index,
                        "image_url": _image_url(slide),
                        "hotspot": _hotspot(slide),
                        "state": slide_state(progress.get(slide.id), now),
                    }
                    for index, slide in enumerate(ordered_slides(practice_set), start=1)
                ],
                "stats": set_stats(user=user, sets=[practice_set])[practice_set.id],
                "most_missed": [
                    {
                        "id": str(slide.id),
                        "position": slide.position,
                        "image_url": _image_url(slide),
                        "expected": slide.answer,
                        "misses": misses,
                    }
                    for slide, misses in most_missed(user=user, practice_set=practice_set)
                ],
            }
        )


class PracticeCheckView(APIView):
    """Grade one typed answer. The expected name is revealed only now, after the try."""

    def post(self, request: Request, set_id: UUID, slide_id: UUID) -> Response:
        user, practice_set, slide = _open_slide(request, set_id, slide_id)
        serializer = PracticeCheckSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = check_attempt(
            user=user,
            practice_set=practice_set,
            slide=slide,
            typed=serializer.validated_data["answer"],
        )
        return Response(
            {
                "correct": result.correct,
                "expected": result.expected,
                "near_miss": result.near_miss,
                "hinted": result.hinted,
                "xp_awarded": result.xp_awarded,
                "set_xp_awarded": result.set_xp_awarded,
            }
        )


class PracticeHintView(APIView):
    """The first letter of the name. It costs XP on this try and never shows the rest."""

    def post(self, request: Request, set_id: UUID, slide_id: UUID) -> Response:
        user, practice_set, slide = _open_slide(request, set_id, slide_id)
        return Response(
            {"first_letter": reveal_hint(user=user, practice_set=practice_set, slide=slide)}
        )


# --- Administrators ---------------------------------------------------------


class AdminPracticeSetCreateSerializer(StrictSerializer):
    title = serializers.CharField(max_length=TITLE_MAX_LENGTH * 2, trim_whitespace=True)


class AdminPracticeSetUpdateSerializer(StrictSerializer):
    title = serializers.CharField(
        max_length=TITLE_MAX_LENGTH * 2, trim_whitespace=True, required=False
    )
    is_published = serializers.BooleanField(required=False)


class HotspotSerializer(StrictSerializer):
    x = serializers.FloatField(min_value=0, max_value=1)
    y = serializers.FloatField(min_value=0, max_value=1)
    shape = serializers.ChoiceField(choices=HOTSPOT_SHAPES)


class AdminPracticeSlideUpdateSerializer(StrictSerializer):
    answer = serializers.CharField(
        allow_blank=True, trim_whitespace=True, max_length=ANSWER_MAX_LENGTH * 2, required=False
    )
    hotspot = HotspotSerializer(allow_null=True, required=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if not attrs:
            raise serializers.ValidationError("Send an answer or a mark.")
        return attrs


class AdminPracticeMoveSerializer(StrictSerializer):
    position = serializers.IntegerField(min_value=1, max_value=500)


class AdminPracticeDuplicateSerializer(StrictSerializer):
    title = serializers.CharField(
        max_length=TITLE_MAX_LENGTH * 2, trim_whitespace=True, required=False
    )


class AdminPracticeReorderSerializer(StrictSerializer):
    ids = serializers.ListField(child=serializers.UUIDField(), max_length=500)


class AdminPracticeAnswersSerializer(StrictSerializer):
    answers = serializers.ListField(
        child=serializers.CharField(
            allow_blank=True, allow_null=True, max_length=ANSWER_MAX_LENGTH * 2
        ),
        max_length=500,
    )


def _set_payload(practice_set: PracticeSet) -> dict[str, Any]:
    return {
        "id": str(practice_set.id),
        "title": practice_set.title,
        "is_published": practice_set.is_published,
        "slide_count": int(getattr(practice_set, "slide_count", 0)),
        "answered_count": int(getattr(practice_set, "answered_count", 0)),
        "created_at": practice_set.created_at.isoformat(),
        "updated_at": practice_set.updated_at.isoformat(),
    }


def _slide_payload(slide: PracticeSlide, position: int) -> dict[str, Any]:
    return {
        "id": str(slide.id),
        "position": position,
        "answer": slide.answer,
        "image_url": _image_url(slide),
        "file_name": slide.managed_file.original_name,
        "hotspot": _hotspot(slide),
    }


def _detail_payload(practice_set: PracticeSet) -> dict[str, Any]:
    practice_set = admin_sets(practice_set.subject).get(id=practice_set.id)
    slides = ordered_slides(practice_set)
    return {
        "set": _set_payload(practice_set),
        "subject": {
            "id": str(practice_set.subject_id),
            "title": practice_set.subject.title,
            "slug": practice_set.subject.material_slug,
        },
        "slides": [_slide_payload(slide, index) for index, slide in enumerate(slides, start=1)],
        "limits": {"max_slides": max_slides_per_set()},
    }


def _subject(subject_id: UUID) -> CatalogSubject:
    subject = CatalogSubject.objects.filter(id=subject_id, is_active=True).first()
    if subject is None:
        raise NotFound("Subject not found.")
    return subject


def _set(set_id: UUID) -> PracticeSet:
    practice_set = PracticeSet.objects.select_related("subject").filter(id=set_id).first()
    if practice_set is None:
        raise NotFound("Practice set not found.")
    return practice_set


def _slide(set_id: UUID, slide_id: UUID) -> PracticeSlide:
    slide = (
        PracticeSlide.objects.select_related("managed_file", "practice_set__subject")
        .filter(id=slide_id, practice_set_id=set_id)
        .first()
    )
    if slide is None:
        raise NotFound("Slide not found.")
    return slide


class AdminPracticeSetListView(_ContentPermissionView):
    def get(self, request: Request, subject_id: UUID) -> Response:
        subject = _subject(subject_id)
        return Response(
            {
                "subject": {"id": str(subject.id), "title": subject.title},
                "results": [_set_payload(item) for item in admin_sets(subject)],
            }
        )

    def post(self, request: Request, subject_id: UUID) -> Response:
        subject = _subject(subject_id)
        serializer = AdminPracticeSetCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            practice_set = create_set(
                subject=subject, title=serializer.validated_data["title"], actor=_user(request)
            )
        except PracticeError as error:
            raise _rejected(error) from error
        return Response(_detail_payload(practice_set), status=status.HTTP_201_CREATED)


class AdminPracticeSetDetailView(_ContentPermissionView):
    def get(self, request: Request, set_id: UUID) -> Response:
        return Response(_detail_payload(_set(set_id)))

    def patch(self, request: Request, set_id: UUID) -> Response:
        practice_set = _set(set_id)
        serializer = AdminPracticeSetUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            update_set(
                practice_set=practice_set,
                title=data.get("title"),
                is_published=data.get("is_published"),
            )
        except PracticeError as error:
            raise _rejected(error) from error
        return Response(_detail_payload(_set(set_id)))

    def delete(self, request: Request, set_id: UUID) -> Response:
        delete_set(_set(set_id))
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminPracticeSlideCollectionView(_ContentPermissionView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request: Request, set_id: UUID) -> Response:
        practice_set = _set(set_id)
        archive = request.FILES.get("archive")
        uploads = request.FILES.getlist("files")
        if archive is not None:
            if uploads:
                raise RequestRejected(
                    "Send either a ZIP or images, not both.", code="practice_invalid"
                )
            try:
                outcome = add_slides_from_archive(
                    practice_set=practice_set, archive=archive, owner=_user(request)
                )
            except PracticeError as error:
                raise _rejected(error) from error
        else:
            if not uploads:
                raise RequestRejected("Choose at least one image.", code="practice_invalid")
            if len(uploads) > MAX_FILES_PER_REQUEST:
                raise RequestRejected(
                    f"Add up to {MAX_FILES_PER_REQUEST} images at a time.", code="practice_invalid"
                )
            outcome = add_slides(practice_set=practice_set, uploads=uploads, owner=_user(request))
        payload = _detail_payload(_set(set_id))
        payload["rejected"] = [
            {"name": name, "message": message} for name, message in outcome.rejected
        ]
        payload["added"] = len(outcome.added)
        return Response(
            payload, status=status.HTTP_201_CREATED if outcome.added else status.HTTP_200_OK
        )


class AdminPracticeSlideDetailView(_ContentPermissionView):
    def patch(self, request: Request, set_id: UUID, slide_id: UUID) -> Response:
        slide = _slide(set_id, slide_id)
        serializer = AdminPracticeSlideUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            if "answer" in data:
                slide = set_slide_answer(slide=slide, answer=data["answer"])
            if "hotspot" in data:
                mark = data["hotspot"]
                set_slide_hotspot(
                    slide=slide,
                    x=mark["x"] if mark else None,
                    y=mark["y"] if mark else None,
                    shape=mark["shape"] if mark else "",
                )
        except PracticeError as error:
            raise _rejected(error) from error
        return Response(_detail_payload(_set(set_id)))

    def delete(self, request: Request, set_id: UUID, slide_id: UUID) -> Response:
        delete_slide(_slide(set_id, slide_id))
        return Response(_detail_payload(_set(set_id)))


class AdminPracticeReorderView(_ContentPermissionView):
    def post(self, request: Request, set_id: UUID) -> Response:
        practice_set = _set(set_id)
        serializer = AdminPracticeReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            reorder_slides(practice_set=practice_set, ordered_ids=serializer.validated_data["ids"])
        except PracticeError as error:
            raise _rejected(error) from error
        return Response(_detail_payload(_set(set_id)))


class AdminPracticeAnswersView(_ContentPermissionView):
    """Bulk answers by position, for a pasted list. Blank entries keep the current answer."""

    def post(self, request: Request, set_id: UUID) -> Response:
        practice_set = _set(set_id)
        serializer = AdminPracticeAnswersSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            changed = set_answers_in_order(
                practice_set=practice_set,
                answers=[item or "" for item in serializer.validated_data["answers"]],
            )
        except PracticeError as error:
            raise _rejected(error) from error
        payload = _detail_payload(_set(set_id))
        payload["changed"] = changed
        return Response(payload)


class AdminPracticeSlideMoveView(_ContentPermissionView):
    def post(self, request: Request, set_id: UUID, slide_id: UUID) -> Response:
        slide = _slide(set_id, slide_id)
        serializer = AdminPracticeMoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            move_slide(
                practice_set=slide.practice_set,
                slide=slide,
                position=serializer.validated_data["position"],
            )
        except PracticeError as error:
            raise _rejected(error) from error
        return Response(_detail_payload(_set(set_id)))


class AdminPracticeSlideImageView(_ContentPermissionView):
    """Swap one slide's picture; its name, position and mark stay."""

    parser_classes = [MultiPartParser, FormParser]

    def post(self, request: Request, set_id: UUID, slide_id: UUID) -> Response:
        slide = _slide(set_id, slide_id)
        upload = request.FILES.get("file")
        if upload is None:
            raise RequestRejected("Choose an image.", code="practice_invalid")
        try:
            replace_slide_image(slide=slide, upload=upload, owner=_user(request))
        except PracticeError as error:
            raise _rejected(error) from error
        return Response(_detail_payload(_set(set_id)))


class AdminPracticeDuplicateView(_ContentPermissionView):
    """A draft copy of a set, with its own copy of every image."""

    def post(self, request: Request, set_id: UUID) -> Response:
        source = _set(set_id)
        serializer = AdminPracticeDuplicateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            copy = duplicate_set(
                source=source, actor=_user(request), title=serializer.validated_data.get("title")
            )
        except PracticeError as error:
            raise _rejected(error) from error
        return Response(_detail_payload(_set(copy.id)), status=status.HTTP_201_CREATED)
