from typing import NoReturn
from uuid import UUID

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound, PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .context import CommunityContextError, resolve_context
from .models import Comment, CommunitySpace, Discussion, LearningContextType
from .pagination import CommentCursorPagination, DiscussionCursorPagination, SpaceCursorPagination
from .policies import can_manage_space
from .selectors import discussion_comments, discussion_for_user, visible_discussions, visible_spaces
from .serializers import (
    CommentEditSerializer,
    CommentSerializer,
    CommentWriteSerializer,
    DiscussionEditSerializer,
    DiscussionSerializer,
    DiscussionWriteSerializer,
    RevisionSerializer,
    SpaceMemberWriteSerializer,
    SpaceSerializer,
    SpaceWriteSerializer,
)
from .services import (
    CommunityConflictError,
    CommunityRateLimitError,
    CommunityRuleError,
    create_comment,
    create_discussion,
    create_space,
    delete_own_comment,
    delete_own_discussion,
    edit_comment,
    edit_discussion,
    revoke_space_member,
    set_space_member,
)


class CommunityRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "community_rule_rejected"


class CommunityConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "community_revision_conflict"


class CommunityThrottled(APIException):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    default_code = "community_rate_limited"


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _raise_service(error: Exception) -> NoReturn:
    if isinstance(error, CommunityConflictError):
        raise CommunityConflict(str(error)) from error
    if isinstance(error, CommunityRateLimitError):
        raise CommunityThrottled(str(error)) from error
    if isinstance(error, CommunityRuleError):
        message = str(error)
        if message.startswith("You cannot"):
            raise PermissionDenied(message) from error
        raise CommunityRejected(message) from error
    raise error


class DiscussionListView(APIView):
    def get(self, request: Request) -> Response:
        raw_context_type = request.query_params.get("context_type")
        raw_context_id = request.query_params.get("context_id")
        raw_space_id = request.query_params.get("space_id")
        if bool(raw_context_type) != bool(raw_context_id):
            raise CommunityRejected("Context type and identifier must be provided together.")
        context_id = None
        if raw_context_id:
            try:
                context_id = UUID(raw_context_id)
            except ValueError as error:
                raise CommunityRejected("Learning context identifier is invalid.") from error
            if raw_context_type not in LearningContextType.values:
                raise CommunityRejected("Unsupported learning context.")
            try:
                resolve_context(
                    user=_user(request),
                    context_type=str(raw_context_type),
                    context_id=context_id,
                )
            except CommunityContextError as error:
                raise NotFound(str(error)) from error
        space_id = None
        if raw_space_id:
            try:
                space_id = UUID(raw_space_id)
            except ValueError as error:
                raise CommunityRejected("Creator space identifier is invalid.") from error
        try:
            queryset = visible_discussions(
                user=_user(request),
                context_type=raw_context_type,
                context_id=context_id,
                space_id=space_id,
            )
        except CommunitySpace.DoesNotExist as error:
            raise NotFound("Creator space not found.") from error
        paginator = DiscussionCursorPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return paginator.get_paginated_response(
            DiscussionSerializer(page, many=True, context={"request": request}).data
        )

    def post(self, request: Request) -> Response:
        serializer = DiscussionWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            discussion = create_discussion(
                actor=_user(request),
                context_type=str(data["context_type"]),
                context_id=data["context_id"],
                space_id=data.get("space_id"),
                title=str(data["title"]),
                body=str(data["body"]),
                client_request_id=data["client_request_id"],
            )
        except (CommunityRuleError, CommunityConflictError, CommunityRateLimitError) as error:
            _raise_service(error)
        return Response(
            DiscussionSerializer(discussion, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class DiscussionDetailView(APIView):
    def get(self, request: Request, discussion_id: UUID) -> Response:
        try:
            discussion = discussion_for_user(user=_user(request), discussion_id=discussion_id)
        except Discussion.DoesNotExist as error:
            raise NotFound("Discussion not found.") from error
        return Response(DiscussionSerializer(discussion, context={"request": request}).data)

    def patch(self, request: Request, discussion_id: UUID) -> Response:
        serializer = DiscussionEditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            discussion = edit_discussion(
                actor=_user(request),
                discussion_id=discussion_id,
                expected_revision=int(data["expected_revision"]),
                title=str(data["title"]),
                body=str(data["body"]),
            )
        except (Discussion.DoesNotExist, CommunityRuleError, CommunityConflictError) as error:
            if isinstance(error, Discussion.DoesNotExist):
                raise NotFound("Discussion not found.") from error
            _raise_service(error)
        return Response(DiscussionSerializer(discussion, context={"request": request}).data)

    def delete(self, request: Request, discussion_id: UUID) -> Response:
        serializer = RevisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            discussion = delete_own_discussion(
                actor=_user(request),
                discussion_id=discussion_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
            )
        except (Discussion.DoesNotExist, CommunityRuleError, CommunityConflictError) as error:
            if isinstance(error, Discussion.DoesNotExist):
                raise NotFound("Discussion not found.") from error
            _raise_service(error)
        return Response(DiscussionSerializer(discussion, context={"request": request}).data)


class CommentListView(APIView):
    def get(self, request: Request, discussion_id: UUID) -> Response:
        try:
            discussion = discussion_for_user(user=_user(request), discussion_id=discussion_id)
            queryset = discussion_comments(user=_user(request), discussion=discussion)
        except Discussion.DoesNotExist as error:
            raise NotFound("Discussion not found.") from error
        paginator = CommentCursorPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return paginator.get_paginated_response(
            CommentSerializer(page, many=True, context={"request": request}).data
        )

    def post(self, request: Request, discussion_id: UUID) -> Response:
        serializer = CommentWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            comment = create_comment(
                actor=_user(request),
                discussion_id=discussion_id,
                parent_id=data.get("parent_id"),
                body=str(data["body"]),
                client_request_id=data["client_request_id"],
            )
        except (CommunityRuleError, CommunityConflictError, CommunityRateLimitError) as error:
            _raise_service(error)
        return Response(
            CommentSerializer(comment, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class CommentDetailView(APIView):
    def patch(self, request: Request, comment_id: UUID) -> Response:
        serializer = CommentEditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            comment = edit_comment(
                actor=_user(request),
                comment_id=comment_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
                body=str(serializer.validated_data["body"]),
            )
        except (Comment.DoesNotExist, CommunityRuleError, CommunityConflictError) as error:
            if isinstance(error, Comment.DoesNotExist):
                raise NotFound("Reply not found.") from error
            _raise_service(error)
        return Response(CommentSerializer(comment, context={"request": request}).data)

    def delete(self, request: Request, comment_id: UUID) -> Response:
        serializer = RevisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            comment = delete_own_comment(
                actor=_user(request),
                comment_id=comment_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
            )
        except (Comment.DoesNotExist, CommunityRuleError, CommunityConflictError) as error:
            if isinstance(error, Comment.DoesNotExist):
                raise NotFound("Reply not found.") from error
            _raise_service(error)
        return Response(CommentSerializer(comment, context={"request": request}).data)


class SpaceListView(APIView):
    def get(self, request: Request) -> Response:
        paginator = SpaceCursorPagination()
        page = paginator.paginate_queryset(visible_spaces(user=_user(request)), request, view=self)
        return paginator.get_paginated_response(
            SpaceSerializer(page, many=True, context={"request": request}).data
        )

    def post(self, request: Request) -> Response:
        serializer = SpaceWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            space = create_space(
                actor=_user(request),
                context_type=str(data["context_type"]),
                context_id=data["context_id"],
                title=str(data["title"]),
                description=str(data.get("description", "")),
            )
        except CommunityRuleError as error:
            _raise_service(error)
        return Response(
            SpaceSerializer(space, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class SpaceDetailView(APIView):
    def get(self, request: Request, space_id: UUID) -> Response:
        space = get_object_or_404(visible_spaces(user=_user(request)), id=space_id)
        return Response(SpaceSerializer(space, context={"request": request}).data)


class SpaceMemberListView(APIView):
    def post(self, request: Request, space_id: UUID) -> Response:
        serializer = SpaceMemberWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        space = get_object_or_404(CommunitySpace, id=space_id)
        if not can_manage_space(user=_user(request), space=space):
            raise PermissionDenied("You cannot manage this creator space.")
        identity = serializer.validated_data
        user_id = identity.get("user_id")
        target = get_object_or_404(
            User,
            **(
                {"id": user_id, "is_active": True}
                if user_id is not None
                else {"email__iexact": identity["email"], "is_active": True}
            ),
        )
        try:
            membership = set_space_member(
                actor=_user(request),
                space_id=space_id,
                user=target,
                role=str(serializer.validated_data["role"]),
            )
        except (CommunitySpace.DoesNotExist, CommunityRuleError) as error:
            if isinstance(error, CommunitySpace.DoesNotExist):
                raise NotFound("Creator space not found.") from error
            _raise_service(error)
        return Response(
            {"user_id": membership.user_id, "role": membership.role, "status": membership.status},
            status=status.HTTP_201_CREATED,
        )


class SpaceMemberDetailView(APIView):
    def delete(self, request: Request, space_id: UUID, user_id: UUID) -> Response:
        try:
            membership = revoke_space_member(
                actor=_user(request),
                space_id=space_id,
                user_id=user_id,
            )
        except (CommunitySpace.DoesNotExist, CommunityRuleError) as error:
            if isinstance(error, CommunitySpace.DoesNotExist):
                raise NotFound("Creator space not found.") from error
            _raise_service(error)
        return Response(
            {"user_id": membership.user_id, "role": membership.role, "status": membership.status}
        )
