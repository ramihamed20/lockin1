"""Page-addressed banks, shared by standard and custom Active Study runs."""

from typing import Any

MAX_CHECKPOINT_QUESTIONS = 20


def custom_page_ranges(start: int, end: int, size: int) -> list[dict[str, int]]:
    if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= end - start + 1:
        raise ValueError("Choose a page count between 1 and the eligible sheet page count.")
    return [
        {"part": index + 1, "start_page": page, "end_page": min(end, page + size - 1)}
        for index, page in enumerate(range(start, end + 1, size))
    ]


def select_page_questions(
    payload: dict[str, Any], start: int, end: int, count: int
) -> list[dict[str, Any]]:
    """Stable round-robin selection; source identity survives regrouping and resume."""
    pages = [item for item in payload["pages"] if start <= item["page"] <= end]
    if not pages or sum(len(item["questions"]) for item in pages) < count:
        raise ValueError("There are not enough questions for these pages.")
    # When fewer questions than pages were requested, spread them over the range.
    if count < len(pages):
        pages = [pages[index * len(pages) // count] for index in range(count)]
    selected = []
    for position in range(max(len(page["questions"]) for page in pages)):
        for page in pages:
            if position < len(page["questions"]):
                selected.append(
                    {
                        **page["questions"][position],
                        "source_key": f"page:{page['page']}:question:{position + 1}",
                    }
                )
                if len(selected) == count:
                    return selected
    return selected
