from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1] / "public" / "assets"


def export_variants(source: Path, widths: tuple[int, ...]) -> None:
    with Image.open(source) as original:
        image = original.convert("RGBA") if original.mode in {"RGBA", "LA", "P"} else original.convert("RGB")
        for width in widths:
            resized = image.copy()
            resized.thumbnail((width, width * 2), Image.Resampling.LANCZOS)
            stem = source.with_suffix("")
            resized.save(stem.with_name(f"{stem.name}-{width}.webp"), "WEBP", quality=78, method=6)
            resized.save(stem.with_name(f"{stem.name}-{width}.avif"), "AVIF", quality=62)


for theme in sorted((ROOT / "themes").glob("*.png")):
    export_variants(theme, (320, 640))

export_variants(ROOT / "store-hero-treasure.png", (480, 960))
export_variants(ROOT / "mascot-study.png", (320, 640))
