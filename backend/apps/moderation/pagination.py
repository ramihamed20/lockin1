from rest_framework.pagination import CursorPagination


class ReportCursorPagination(CursorPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100
    ordering = ("-created_at", "-id")


class AuditCursorPagination(CursorPagination):
    page_size = 30
    page_size_query_param = "page_size"
    max_page_size = 100
    ordering = ("-created_at", "-id")
