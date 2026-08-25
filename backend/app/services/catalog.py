"""Catalog service: image storage rules and characteristic canonicalization."""
import os
from hashlib import sha256
from math import isfinite
from io import BytesIO
from pathlib import Path
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.models import PartType
from app.services.revision import create_revision

ALLOWED_IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg"}


def images_dir() -> Path:
    default = Path(__file__).resolve().parents[2] / "data" / "images"
    return Path(os.environ.get("IMAGES_DIR", default))


def save_image(content_type: str, part_type_id: int, data: bytes,
               *, revision_no: int | None = None) -> str:
    """Store immutable image bytes under a content-and-revision-unique leaf."""
    ext = ALLOWED_IMAGE_TYPES.get(content_type)
    if ext is None:
        raise ValueError("Unsupported image type; use PNG or JPEG")
    try:
        image = Image.open(BytesIO(data)); image.verify()
    except (UnidentifiedImageError, OSError):
        raise ValueError("Image bytes do not match the declared PNG or JPEG type")
    if image.format != {"image/png": "PNG", "image/jpeg": "JPEG"}[content_type]:
        raise ValueError("Image bytes do not match the declared PNG or JPEG type")
    root = images_dir()
    root.mkdir(parents=True, exist_ok=True)
    version = f"r{revision_no}-" if revision_no is not None else ""
    name = f"{part_type_id}-{version}{sha256(data).hexdigest()}{ext}"
    destination = root / name
    try:
        with destination.open("xb") as stored:
            stored.write(data)
    except FileExistsError:
        if destination.read_bytes() != data:
            raise ValueError("Image storage collision")
    return name


def record_catalog_mutation(db: Session, part_type: PartType,
                            user_id: int | None) -> None:
    """Revision trigger: every catalog mutation snapshots a new immutable revision."""
    create_revision(db, part_type, user_id)


def canonicalize_characteristic(
        measurement_method: str | None, tol_type: str, nominal: float | None,
        tol_plus: float | None, tol_minus: float | None,
        min_limit: float | None,
        max_limit: float | None) -> dict[str, float | str | None]:
    """Validate a definition and return its canonical persisted values."""
    if measurement_method is None or not measurement_method.strip():
        raise ValueError("measurement_method must not be blank")
    if nominal is None or not isfinite(nominal):
        raise ValueError("Characteristic nominal must be finite")
    if tol_type == "SYMMETRIC":
        if tol_plus is None or not isfinite(tol_plus) or tol_plus < 0:
            raise ValueError("SYMMETRIC requires a finite non-negative tol_plus")
        if tol_minus is None:
            tol_minus = tol_plus
        if not isfinite(tol_minus) or tol_minus < 0:
            raise ValueError("SYMMETRIC tol_minus must be finite and non-negative")
        minimum = nominal - tol_minus
        maximum = nominal + tol_plus
        if not isfinite(minimum) or not isfinite(maximum):
            raise ValueError("SYMMETRIC derived limits must be finite")
        return {
            "measurement_method": measurement_method.strip(),
            "nominal": nominal,
            "tol_plus": tol_plus,
            "tol_minus": tol_minus,
            "min_limit": minimum,
            "max_limit": maximum,
        }
    if tol_type != "LIMITS":
        raise ValueError("Unknown tolerance type")
    if (min_limit is None or max_limit is None
            or not isfinite(min_limit) or not isfinite(max_limit)):
        raise ValueError("LIMITS requires finite nominal, min_limit, and max_limit")
    if not min_limit <= nominal <= max_limit:
        raise ValueError("LIMITS requires min_limit <= nominal <= max_limit")
    return {
        "measurement_method": measurement_method.strip(),
        "nominal": nominal,
        "tol_plus": None,
        "tol_minus": None,
        "min_limit": min_limit,
        "max_limit": max_limit,
    }
