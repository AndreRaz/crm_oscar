"""Confined, no-replace report publication through one trusted directory fd."""
from __future__ import annotations

import errno
import hashlib
import logging
import os
import re
import stat
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Characteristic, Deviation, GeneratedReport, Inspection, Measurement, PartType,
    Piece,
)
from app.services.report import render_report_pdf


LOGGER = logging.getLogger(__name__)
SERVER_FILENAME_RE = re.compile(r"^report_[0-9a-f]{32}\.pdf$")
TEMP_FILENAME_PREFIX = ".tmp_"

_fsync = os.fsync
_unlink = os.unlink
_HAS_REQUIRED_PRIMITIVES = (
    hasattr(os, "O_DIRECTORY")
    and hasattr(os, "O_NOFOLLOW")
    and os.open in os.supports_dir_fd
    and os.unlink in os.supports_dir_fd
    and os.link in os.supports_dir_fd
    and os.link in os.supports_follow_symlinks
)


def _supports_required_primitives() -> bool:
    return _HAS_REQUIRED_PRIMITIVES


def _require_primitives() -> None:
    if not _supports_required_primitives():
        raise RuntimeError(
            "Secure report publication requires the required dirfd primitives"
        )


def _validate_server_leaf(leaf: str) -> str:
    if not isinstance(leaf, str):
        raise TypeError("Report leaf must be a string")
    if "\0" in leaf or not SERVER_FILENAME_RE.fullmatch(leaf):
        raise ValueError("Report leaf is not a valid server-generated filename")
    return leaf


def _write_all(fd: int, content: bytes) -> None:
    view = memoryview(content)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            raise OSError(errno.EIO, "report write made no progress")
        view = view[written:]


@dataclass(slots=True)
class PublishedReport:
    """One-shot rollback authority for a final published by a ReportRoot."""

    leaf: str
    _owner: object
    _active: bool = True


@dataclass(frozen=True, slots=True)
class ReportEligibility:
    eligible: bool
    missing_items: list[str]


class ReportIneligibleError(Exception):
    def __init__(self, missing_items: list[str]) -> None:
        self.missing_items = missing_items
        super().__init__("Inspection is not eligible for report generation")


class ReportRoot:
    """A reports directory held open and used only through its trusted fd."""

    def __init__(self, fd: int) -> None:
        self._fd: int | None = fd
        self._identity = object()

    @classmethod
    def open(cls, path: str | Path) -> ReportRoot:
        _require_primitives()
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        flags |= getattr(os, "O_CLOEXEC", 0)
        try:
            fd = os.open(os.fspath(path), flags)
        except OSError as exc:
            raise RuntimeError("Could not open trusted reports root") from exc
        return cls(fd)

    @property
    def fd(self) -> int:
        if self._fd is None:
            raise RuntimeError("Reports root is closed")
        return self._fd

    def __enter__(self) -> ReportRoot:
        return self

    def __exit__(self, *_args) -> None:
        self.close()

    def close(self) -> None:
        if self._fd is not None:
            os.close(self._fd)
            self._fd = None

    def create_report(self, leaf: str, content: bytes) -> PublishedReport:
        """Fsync bytes, hard-link without replacement, then fsync the root."""
        _require_primitives()
        final_leaf = _validate_server_leaf(leaf)
        if not isinstance(content, bytes):
            raise TypeError("Report content must be bytes")
        root_fd = self.fd
        temp_leaf = f"{TEMP_FILENAME_PREFIX}{uuid.uuid4().hex}"
        temp_fd: int | None = None
        try:
            temp_fd = os.open(
                temp_leaf,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                0o600,
                dir_fd=root_fd,
            )
            _write_all(temp_fd, content)
            _fsync(temp_fd)
        except BaseException:
            if temp_fd is not None:
                os.close(temp_fd)
                temp_fd = None
            self._remove_failed_temp(temp_leaf)
            raise
        finally:
            if temp_fd is not None:
                os.close(temp_fd)

        try:
            os.link(
                temp_leaf,
                final_leaf,
                src_dir_fd=root_fd,
                dst_dir_fd=root_fd,
                follow_symlinks=False,
            )
        except BaseException:
            self._remove_failed_temp(temp_leaf)
            raise

        try:
            _unlink(temp_leaf, dir_fd=root_fd)
        except FileNotFoundError:
            pass
        except OSError as exc:
            LOGGER.warning("Could not remove temporary report %s: %s", temp_leaf, exc)

        try:
            _fsync(root_fd)
        except OSError as exc:
            self._rollback_final_after_fsync_failure(final_leaf, exc)

        return PublishedReport(final_leaf, self._identity)

    def _remove_failed_temp(self, temp_leaf: str) -> None:
        try:
            _unlink(temp_leaf, dir_fd=self.fd)
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise RuntimeError("Temporary report cleanup failed") from exc

    def _rollback_final_after_fsync_failure(
            self, final_leaf: str, publication_error: OSError) -> None:
        try:
            _unlink(final_leaf, dir_fd=self.fd)
            _fsync(self.fd)
        except OSError as rollback_error:
            raise RuntimeError(
                "reports root fsync failed and publication rollback failed"
            ) from rollback_error
        raise RuntimeError("reports root fsync failed; publication was rolled back") from (
            publication_error
        )

    def remove_published(self, publication: PublishedReport) -> None:
        """Remove only an active publication token issued by this root."""
        if not isinstance(publication, PublishedReport):
            raise TypeError("Expected a publication token")
        if publication._owner is not self._identity or not publication._active:
            raise ValueError("Expected an active publication from this reports root")
        _unlink(publication.leaf, dir_fd=self.fd)
        try:
            _fsync(self.fd)
        except OSError as exc:
            raise RuntimeError("Reports root fsync failed during publication removal") from exc
        publication._active = False

    def read_report(self, leaf: str) -> bytes:
        """Read one validated regular report without reopening the root by path."""
        final_leaf = _validate_server_leaf(leaf)
        fd = os.open(
            final_leaf,
            os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
            dir_fd=self.fd,
        )
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise RuntimeError("Generated report is not a regular file")
            chunks = []
            while chunk := os.read(fd, 1024 * 1024):
                chunks.append(chunk)
            return b"".join(chunks)
        finally:
            os.close(fd)


def check_eligibility(db: Session, inspection: Inspection) -> ReportEligibility:
    """Return the complete checklist that gates a new report generation."""
    selected_ids = [
        int(value) for value in inspection.selected_characteristic_ids.split(",") if value
    ]
    characteristics = {
        row.id: row for row in db.scalars(select(Characteristic).where(
            Characteristic.id.in_(selected_ids)
        ))
    }
    measured_ids = set(db.scalars(select(Measurement.characteristic_id).where(
        Measurement.inspection_id == inspection.id
    )))
    missing_items = [
        f"Unmeasured characteristic: {characteristics[cid].control_plan}"
        for cid in selected_ids if cid in characteristics and cid not in measured_ids
    ]

    pending_control_plans = db.scalars(
        select(Characteristic.control_plan)
        .join(Measurement, Measurement.characteristic_id == Characteristic.id)
        .join(Deviation, Deviation.measurement_id == Measurement.id)
        .where(
            Measurement.inspection_id == inspection.id,
            Deviation.status == "PENDING",
        )
        .order_by(Characteristic.sort_order, Characteristic.id)
    ).all()
    missing_items.extend(
        f"Pending deviation: {control_plan}"
        for control_plan in pending_control_plans
    )

    piece = db.get(Piece, inspection.piece_id)
    part_type = db.get(PartType, piece.part_type_id) if piece else None
    if part_type is None or not part_type.part_number.strip():
        missing_items.append("Part number is missing")
    if part_type is None or not part_type.part_description.strip():
        missing_items.append("Part description is missing")
    return ReportEligibility(not missing_items, missing_items)


def generate_report(
        db: Session, inspection: Inspection, generated_by: int,
        report_root: ReportRoot) -> GeneratedReport:
    """Publish durable PDF evidence, then persist its metadata row."""
    eligibility = check_eligibility(db, inspection)
    if not eligibility.eligible:
        raise ReportIneligibleError(eligibility.missing_items)

    content = render_report_pdf(db, inspection)
    publication = report_root.create_report(f"report_{uuid.uuid4().hex}.pdf", content)
    report = GeneratedReport(
        inspection_id=inspection.id,
        part_revision_id=inspection.part_revision_id,
        content_hash=hashlib.sha256(content).hexdigest(),
        file_path=publication.leaf,
        generated_by=generated_by,
    )
    try:
        db.add(report)
        db.commit()
        db.refresh(report)
    except BaseException:
        db.rollback()
        report_root.remove_published(publication)
        raise
    return report


def reconcile_reports_root(
        report_root: ReportRoot, referenced_leaves: Iterable[str]) -> None:
    """Remove crash artifacts without touching tracked or operator-owned files."""
    _require_primitives()
    try:
        referenced = {_validate_server_leaf(leaf) for leaf in referenced_leaves}
        for leaf in os.listdir(report_root.fd):
            is_temp = leaf.startswith(TEMP_FILENAME_PREFIX)
            is_untracked_final = (
                SERVER_FILENAME_RE.fullmatch(leaf) is not None and leaf not in referenced
            )
            if is_temp or is_untracked_final:
                _unlink(leaf, dir_fd=report_root.fd)
        _fsync(report_root.fd)
    except (OSError, TypeError, ValueError) as exc:
        raise RuntimeError("Reports root reconciliation failed") from exc
