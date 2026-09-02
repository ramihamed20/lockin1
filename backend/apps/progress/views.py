from uuid import UUID

from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.generics import ListAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.content.models import LearningObject

from .models import Bookmark, LearningProgress
from .selectors import bookmarks_for_user, learning_dashboard, resumable_progress
from .serializers import (
    BookmarkCreateSerializer,
    BookmarkSerializer,
    LearningProgressSerializer,
    LearningProgressUpdateSerializer,
    LessonCompleteSerializer,
)
from .services import (
    ProgressConflictError,
    ProgressRuleError,
    complete_lesson,
    remove_bookmark,
    remove_catalog_bookmark,
    set_bookmark,
    set_catalog_bookmark,
    update_learning_progress,
)


class ProgressConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "revision_conflict"


class ProgressRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "progress_rule_rejected"


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


class BookmarkListView(ListAPIView[Bookmark]):
    serializer_class = BookmarkSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        return bookmarks_for_user(user=_user(self.request))

    def post(self, request: Request) -> Response:
        serializer = BookmarkCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            if "learning_object_id" in data:
                bookmark, created = set_bookmark(
                    user=_user(request),
                    learning_object_id=data["learning_object_id"],
                )
            else:
                bookmark, created = set_catalog_bookmark(
                    user=_user(request),
                    material_slug=str(data["catalog_material_slug"]),
                    material_title=str(data["catalog_material_title"]),
                    sheet_slug=str(data["catalog_sheet_slug"]),
                    sheet_title=str(data["catalog_sheet_title"]),
                    position=dict(data["position"]),
                )
        except LearningObject.DoesNotExist as error:
            raise ProgressRejected("This learning object is not available.") from error
        except ProgressRuleError as error:
            raise ProgressRejected(str(error)) from error
        return Response(
            BookmarkSerializer(bookmark).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class BookmarkDetailView(APIView):
    def delete(self, request: Request, learning_object_id: UUID) -> Response:
        remove_bookmark(user=_user(request), learning_object_id=learning_object_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CatalogBookmarkDetailView(APIView):
    def get(self, request: Request, material_slug: str, sheet_slug: str) -> Response:
        bookmark = Bookmark.objects.filter(
            user=_user(request),
            learning_object__isnull=True,
            catalog_material_slug=material_slug,
            catalog_sheet_slug=sheet_slug,
        ).first()
        if bookmark is None:
            return Response({"detail": "Bookmark not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(BookmarkSerializer(bookmark).data)

    def delete(self, request: Request, material_slug: str, sheet_slug: str) -> Response:
        remove_catalog_bookmark(
            user=_user(request),
            material_slug=material_slug,
            sheet_slug=sheet_slug,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class ResumeListView(ListAPIView[LearningProgress]):
    serializer_class = LearningProgressSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        return resumable_progress(user=_user(self.request))


class LearningProgressDetailView(APIView):
    def get(self, request: Request, learning_object_id: UUID) -> Response:
        progress = LearningProgress.objects.filter(
            user=_user(request), learning_object_id=learning_object_id
        ).first()
        if progress is None:
            return Response(
                {
                    "learning_object_id": learning_object_id,
                    "status": "in_progress",
                    "completion_percent": 0,
                    "position": {},
                    "revision": 0,
                }
            )
        return Response(LearningProgressSerializer(progress).data)

    def put(self, request: Request, learning_object_id: UUID) -> Response:
        serializer = LearningProgressUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            progress = update_learning_progress(
                user=_user(request),
                learning_object_id=learning_object_id,
                expected_revision=int(data["expected_revision"]),
                status=str(data["status"]),
                completion_percent=int(data["completion_percent"]),
                position=dict(data["position"]),
            )
        except ProgressConflictError as error:
            raise ProgressConflict(str(error)) from error
        except ProgressRuleError as error:
            raise ProgressRejected(str(error)) from error
        return Response(LearningProgressSerializer(progress).data)


class LessonCompleteView(APIView):
    def post(self, request: Request, lesson_id: UUID) -> Response:
        serializer = LessonCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            progress = complete_lesson(
                user=_user(request),
                lesson_id=lesson_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
            )
        except ProgressConflictError as error:
            raise ProgressConflict(str(error)) from error
        except ProgressRuleError as error:
            raise ProgressRejected(str(error)) from error
        return Response(
            {
                "lesson_id": progress.lesson_id,
                "completed_at": progress.completed_at,
                "revision": progress.revision,
            }
        )


class LearningDashboardView(APIView):
    def get(self, request: Request) -> Response:
        return Response(learning_dashboard(user=_user(request)))
