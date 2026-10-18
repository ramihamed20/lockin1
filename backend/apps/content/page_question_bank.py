"""Page-addressed banks, shared by standard and custom Active Study runs."""

from typing import Any

MAX_CHECKPOINT_QUESTIONS = 20
MAX_CUSTOM_QUESTIONS = 30
MAX_CUSTOM_PAGES = 10
# What a page bank holds for each page. Older banks written with 20 stay valid:
# selection simply uses the first QUESTIONS_PER_PAGE of each page.
QUESTIONS_PER_PAGE = 15
LEGACY_QUESTIONS_PER_PAGE = 20


def custom_page_ranges(start: int, end: int, size: int) -> list[dict[str, int]]:
    limit = min(MAX_CUSTOM_PAGES, end - start + 1)
    if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= limit:
        raise ValueError(f"Choose between 1 and {limit} pages per test.")
    return [
        {"part": index + 1, "start_page": page, "end_page": min(end, page + size - 1)}
        for index, page in enumerate(range(start, end + 1, size))
    ]


def select_page_questions(
    payload: dict[str, Any], start: int, end: int, count: int
) -> list[dict[str, Any]]:
    """Select up to the requested count, without inventing missing page questions."""
    pages = [item for item in payload["pages"] if start <= item["page"] <= end]
    usable = sum(min(QUESTIONS_PER_PAGE, len(item["questions"])) for item in pages)
    if (
        not pages
        or isinstance(count, bool)
        or not isinstance(count, int)
        or count < 1
        or count > len(pages) * QUESTIONS_PER_PAGE
        or usable < 1
    ):
        raise ValueError("There are not enough questions for these pages.")
    count = min(count, usable)
    # When fewer questions than pages were requested, spread them over the range.
    if count < len(pages):
        pages = [pages[index * len(pages) // count] for index in range(count)]
    selected = []
    for position in range(min(QUESTIONS_PER_PAGE, max(len(page["questions"]) for page in pages))):
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
