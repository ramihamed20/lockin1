from rest_framework.generics import ListAPIView

from .models import SearchEntry
from .selectors import search
from .serializers import SearchEntrySerializer


class SearchView(ListAPIView[SearchEntry]):
    serializer_class = SearchEntrySerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        request = self.request
        query = request.query_params.get("q", "")[:120]
        kinds = tuple(filter(None, request.query_params.get("kinds", "").split(",")))
        content_types = tuple(
            filter(None, request.query_params.get("content_types", "").split(","))
        )
        academic_path = request.query_params.get("academic_path") or None
        return search(
            query=query,
            resource_kinds=kinds,
            content_types=content_types,
            academic_path=academic_path,
        )
