from rest_framework.pagination import CursorPagination


class DiscussionCursorPagination(CursorPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 50
    ordering = ("-last_activity_at", "-id")


class CommentCursorPagination(CursorPagination):
    page_size = 40
    page_size_query_param = "page_size"
    max_page_size = 100
    ordering = ("created_at", "id")


class SpaceCursorPagination(CursorPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 50
    ordering = ("-updated_at", "-id")
