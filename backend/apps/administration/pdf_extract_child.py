"""Subprocess entry point for bounded PDF text extraction on the Linux worker."""

import json
import re
import resource
import sys
from pathlib import Path

from pypdf import PdfReader
from pypdf.errors import PdfReadError

MAX_PAGE_TEXT = 3_000
MIN_TEXT_CHARACTERS = 40


def main() -> None:
    resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (80, 85))
    with Path(sys.argv[1]).open("rb") as source:
        reader = PdfReader(source, strict=False)
        if reader.is_encrypted or not 1 <= len(reader.pages) <= int(sys.argv[2]):
            raise SystemExit(2)
        sys.stdout.write("[")
        for number, page in enumerate(reader.pages, start=1):
            try:
                text = re.sub(r"\s+", " ", page.extract_text() or "").strip().replace("\x00", "")
            except (PdfReadError, TypeError, ValueError, KeyError, IndexError):
                text = ""
            if number > 1:
                sys.stdout.write(",")
            json.dump(
                {
                    "page": number,
                    "text": text[:MAX_PAGE_TEXT],
                    "needs_visual_review": sum(char.isalnum() for char in text)
                    < MIN_TEXT_CHARACTERS,
                },
                sys.stdout,
                ensure_ascii=True,
            )
        sys.stdout.write("]")


if __name__ == "__main__":
    main()
