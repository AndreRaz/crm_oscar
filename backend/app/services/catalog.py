"""Catalog service: image storage rules (design ADR — local uploads dir)."""
import os
from pathlib import Path

ALLOWED_IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg"}


def images_dir() -> Path:
    default = Path(__file__).resolve().parents[2] / "data" / "images"
    return Path(os.environ.get("IMAGES_DIR", default))


def save_image(content_type: str, part_type_id: int, data: bytes) -> str:
    """Store one image per part type; returns the stored file name."""
    ext = ALLOWED_IMAGE_TYPES.get(content_type)
    if ext is None:
        raise ValueError("Unsupported image type; use PNG or JPEG")
    root = images_dir()
    root.mkdir(parents=True, exist_ok=True)
    name = f"{part_type_id}{ext}"
    (root / name).write_bytes(data)
    return name
