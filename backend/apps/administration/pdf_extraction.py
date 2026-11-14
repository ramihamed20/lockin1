"""Bound the CPU, address space, wall time and output of an untrusted PDF parser."""

import hashlib
import json
import subprocess
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TypedDict

from apps.files.models import ManagedFile
from apps.files.services import managed_file_delivery_ready
from platform_core.storage import ManagedObjectUnavailable, open_managed_object

MAX_BYTES = 50 * 1024 * 1024
MAX_REFERENCE_PAGES = 500
MAX_LECTURE_PAGES = 200
EXTRACTOR = Path(__file__).with_name("pdf_extract_child.py")


class ExtractedPage(TypedDict):
    page: int
    text: str
    needs_visual_review: bool


class PDFExtractionError(ValueError):
    pass


@contextmanager
def verified_pdf(file: ManagedFile) -> Iterator[Path]:
    if not managed_file_delivery_ready(file):
        raise PDFExtractionError("The PDF must pass validation and its required scan.")
    if not 0 < file.size_bytes <= MAX_BYTES:
        raise PDFExtractionError("The PDF exceeds the 50 MB processing limit.")
    with TemporaryDirectory(prefix="lockin-automation-") as directory:
        path = Path(directory) / "source.pdf"
        digest = hashlib.sha256()
        size = 0
        try:
            stored = open_managed_object(file.blob)
            try:
                with path.open("wb") as target:
                    for chunk in stored.stream():
                        size += len(chunk)
                        if size > file.size_bytes:
                            raise PDFExtractionError("The stored PDF size changed.")
                        digest.update(chunk)
                        target.write(chunk)
            finally:
                stored.close()
        except (ManagedObjectUnavailable, OSError) as error:
            raise PDFExtractionError("The stored PDF could not be read.") from error
        if size != file.size_bytes or digest.hexdigest() != file.checksum_sha256:
            raise PDFExtractionError("The stored PDF no longer matches its checksum.")
        yield path


def extract_pages(file: ManagedFile, *, max_pages: int) -> list[ExtractedPage]:
    with verified_pdf(file) as path:
        try:
            result = subprocess.run(  # noqa: S603 - fixed Python module and controlled local path
                [sys.executable, "-I", str(EXTRACTOR), str(path), str(max_pages)],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=100,
                check=True,
            )
        except (subprocess.SubprocessError, OSError) as error:
            raise PDFExtractionError(
                "The PDF could not be extracted within the processing limits."
            ) from error
    pages: list[ExtractedPage] = json.loads(result.stdout)
    if len(pages) != file.pdf_page_count:
        raise PDFExtractionError("The PDF page count differs from the uploaded file metadata.")
    return pages


def export_page_images(file: ManagedFile, *, pages: list[int], target: Path) -> list[Path]:
    """Operator-run only. Render selected physical pages into a private directory."""
    import shutil

    renderer = shutil.which("pdftoppm")
    if renderer is None:
        raise PDFExtractionError("Install Poppler on the operator machine to export images.")
    numbers = sorted(set(pages))
    if not 1 <= len(numbers) <= 8 or any(
        not 1 <= page <= (file.pdf_page_count or 0) for page in numbers
    ):
        raise PDFExtractionError("Choose up to eight page numbers within the original PDF.")
    with verified_pdf(file) as path, TemporaryDirectory(prefix="lockin-images-") as directory:
        images = []
        for page in numbers:
            output = Path(directory) / f"page-{page:04d}"
            try:
                subprocess.run(  # noqa: S603 - fixed renderer and validated page numbers
                    [
                        sys.executable,
                        "-I",
                        str(EXTRACTOR),
                        "--render",
                        renderer,
                        str(path),
                        str(page),
                        str(output),
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=15,
                    check=True,
                )
            except (OSError, subprocess.SubprocessError) as error:
                raise PDFExtractionError(f"Page {page} needs manual visual review.") from error
            images.append(output.with_suffix(".png"))
        target.mkdir(mode=0o700, parents=True, exist_ok=False)
        for image in images:
            shutil.copyfile(image, target / image.name)
    return [target / image.name for image in images]
