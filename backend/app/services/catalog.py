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


def validate_characteristic(tol_type, nominal, tol_plus, min_limit, max_limit) -> None:
    """Dual-format rule (design Data Model): raise ValueError on invalid combos."""
    if tol_type == "SYMMETRIC":
        if nominal is None or tol_plus is None:
            raise ValueError("SYMMETRIC requires nominal and tol_plus")
    else:
        if min_limit is None and max_limit is None:
            raise ValueError("LIMITS requires at least one limit")
        if min_limit is not None and max_limit is not None and min_limit > max_limit:
            raise ValueError("min_limit must not exceed max_limit")
