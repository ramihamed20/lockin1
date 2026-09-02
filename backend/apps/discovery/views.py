from rest_framework.exceptions import ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .result_service import global_search


class SearchView(APIView):
    """Student-facing, normalized search results for global type-ahead."""

    def get(self, request: Request) -> Response:
        query = request.query_params.get("q", "")[:120]
        kinds = tuple(filter(None, request.query_params.get("kinds", "").split(",")))
        content_types = tuple(
            filter(None, request.query_params.get("content_types", "").split(","))
        )
        academic_path = request.query_params.get("academic_path") or None
        raw_limit = (
            request.query_params.get("limit") or request.query_params.get("page_size") or "12"
        )
        try:
            limit = int(raw_limit)
        except ValueError as error:
            raise ValidationError({"limit": "Enter a whole number."}) from error
        if not isinstance(request.user, User):
            # The project default permission already handles this. This guard
            # keeps the user-specific review query robust if permissions are
            # ever composed differently for this view.
            return Response({"count": 0, "next": None, "previous": None, "results": []})

        results = global_search(
            user=request.user,
            query=query,
            resource_kinds=kinds,
            content_types=content_types,
            academic_path=academic_path,
            limit=limit,
        )
        return Response(
            {
                "count": len(results),
                "next": None,
                "previous": None,
                "results": results,
            }
        )
