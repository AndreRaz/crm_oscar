"""Trusted report-root publication and startup reconciliation tests."""
import errno
import os
from types import SimpleNamespace

import pytest
from fastapi import FastAPI


def report_leaf(index: int = 1) -> str:
    return f"report_{index:032x}.pdf"


@pytest.fixture()
def report_root(tmp_path):
    from app.services.report_management import ReportRoot

    root = ReportRoot.open(tmp_path)
    try:
        yield root
    finally:
        root.close()


@pytest.mark.parametrize(
    "leaf",
    (
        "../report_00000000000000000000000000000001.pdf",
        "/tmp/report_00000000000000000000000000000001.pdf",
        "nested/report_00000000000000000000000000000001.pdf",
        "report_00000000000000000000000000000001.pdf\0ignored",
        "operator-file.pdf",
    ),
)
def test_create_report_rejects_untrusted_leaf_without_writing(report_root, tmp_path, leaf):
    with pytest.raises(ValueError):
        report_root.create_report(leaf, b"%PDF-confined")

    assert list(tmp_path.iterdir()) == []


def test_symlink_root_fails_closed_at_open(tmp_path):
    from app.services.report_management import ReportRoot

    real_root = tmp_path / "real"
    real_root.mkdir()
    symlink_root = tmp_path / "reports"
    symlink_root.symlink_to(real_root, target_is_directory=True)

    with pytest.raises(RuntimeError, match="trusted reports root"):
        ReportRoot.open(symlink_root)


def test_unavailable_dirfd_primitives_fail_at_open_and_publication(tmp_path, monkeypatch):
    import app.services.report_management as report_management

    root = report_management.ReportRoot.open(tmp_path)
    monkeypatch.setattr(report_management, "_supports_required_primitives", lambda: False)
    try:
        with pytest.raises(RuntimeError, match="required dirfd primitives"):
            root.create_report(report_leaf(), b"%PDF-no-fallback")
    finally:
        root.close()

    with pytest.raises(RuntimeError, match="required dirfd primitives"):
        report_management.ReportRoot.open(tmp_path)


def test_nonexistent_destination_publishes_fsynced_bytes(report_root, tmp_path):
    payload = b"%PDF-new-report"

    published = report_root.create_report(report_leaf(), payload)

    assert published.leaf == report_leaf()
    assert (tmp_path / report_leaf()).read_bytes() == payload
    assert not any(path.name.startswith(".tmp_") for path in tmp_path.iterdir())


def test_existing_regular_file_is_eexist_and_untouched(report_root, tmp_path):
    final = tmp_path / report_leaf()
    final.write_bytes(b"existing-evidence")

    with pytest.raises(FileExistsError) as captured:
        report_root.create_report(report_leaf(), b"replacement")

    assert captured.value.errno == errno.EEXIST
    assert final.read_bytes() == b"existing-evidence"
    assert not any(path.name.startswith(".tmp_") for path in tmp_path.iterdir())


def test_existing_symlink_destination_is_eexist_without_following(report_root, tmp_path):
    target = tmp_path / "operator-evidence"
    target.write_bytes(b"outside-report")
    final = tmp_path / report_leaf()
    final.symlink_to(target)

    with pytest.raises(FileExistsError) as captured:
        report_root.create_report(report_leaf(), b"replacement")

    assert captured.value.errno == errno.EEXIST
    assert final.is_symlink()
    assert target.read_bytes() == b"outside-report"
    assert not any(path.name.startswith(".tmp_") for path in tmp_path.iterdir())


@pytest.mark.parametrize("failure_point", ("write", "temp_fsync"))
def test_temp_write_or_fsync_failure_removes_temp_and_publishes_nothing(
        report_root, tmp_path, monkeypatch, failure_point):
    import app.services.report_management as report_management

    if failure_point == "write":
        monkeypatch.setattr(
            report_management,
            "_write_all",
            lambda *_: (_ for _ in ()).throw(OSError(errno.EIO, "write failed")),
        )
    else:
        original_fsync = report_management._fsync
        calls = 0

        def fail_first_fsync(fd):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise OSError(errno.EIO, "temp fsync failed")
            return original_fsync(fd)

        monkeypatch.setattr(report_management, "_fsync", fail_first_fsync)

    with pytest.raises(OSError, match="failed"):
        report_root.create_report(report_leaf(), b"%PDF-partial")

    assert not (tmp_path / report_leaf()).exists()
    assert list(tmp_path.iterdir()) == []


def test_temp_unlink_failure_after_publication_warns_and_keeps_final(
        report_root, tmp_path, monkeypatch, caplog):
    import app.services.report_management as report_management

    original_unlink = report_management._unlink

    def fail_temp_unlink(leaf, *, dir_fd):
        if leaf.startswith(".tmp_"):
            raise OSError(errno.EACCES, "temp cleanup denied")
        return original_unlink(leaf, dir_fd=dir_fd)

    monkeypatch.setattr(report_management, "_unlink", fail_temp_unlink)

    published = report_root.create_report(report_leaf(), b"%PDF-durable")

    assert published.leaf == report_leaf()
    assert (tmp_path / report_leaf()).read_bytes() == b"%PDF-durable"
    assert any(path.name.startswith(".tmp_") for path in tmp_path.iterdir())
    assert "temporary report" in caplog.text


def test_root_fsync_failure_removes_only_new_final_and_surfaces_runtime_error(
        report_root, tmp_path, monkeypatch):
    import app.services.report_management as report_management

    original_fsync = report_management._fsync
    calls = []

    def fail_publication_directory_fsync(fd):
        calls.append(fd)
        if len(calls) == 2:
            raise OSError(errno.EIO, "directory fsync failed")
        return original_fsync(fd)

    operator_file = tmp_path / "operator-note.txt"
    operator_file.write_text("preserve")
    monkeypatch.setattr(report_management, "_fsync", fail_publication_directory_fsync)

    with pytest.raises(RuntimeError, match="reports root fsync failed"):
        report_root.create_report(report_leaf(), b"%PDF-rollback")

    assert calls[1:] == [report_root.fd, report_root.fd]
    assert not (tmp_path / report_leaf()).exists()
    assert operator_file.read_text() == "preserve"


def test_remove_published_accepts_only_its_just_published_token_and_fsyncs(
        report_root, tmp_path, monkeypatch):
    import app.services.report_management as report_management

    first = report_root.create_report(report_leaf(1), b"first")
    second = report_root.create_report(report_leaf(2), b"second")
    fsync_calls = []
    original_fsync = report_management._fsync

    def record_fsync(fd):
        fsync_calls.append(fd)
        return original_fsync(fd)

    monkeypatch.setattr(report_management, "_fsync", record_fsync)

    report_root.remove_published(second)

    assert (tmp_path / first.leaf).read_bytes() == b"first"
    assert not (tmp_path / second.leaf).exists()
    assert fsync_calls == [report_root.fd]
    with pytest.raises(ValueError, match="active publication"):
        report_root.remove_published(second)
    with pytest.raises(TypeError, match="publication token"):
        report_root.remove_published(first.leaf)


def test_reconciliation_removes_temp_and_untracked_server_final_only(
        report_root, tmp_path):
    from app.services.report_management import reconcile_reports_root

    tracked = tmp_path / report_leaf(1)
    untracked = tmp_path / report_leaf(2)
    temporary = tmp_path / ".tmp_crash-orphan"
    operator_file = tmp_path / "operator-note.txt"
    for path, content in (
        (tracked, b"tracked"),
        (untracked, b"orphan"),
        (temporary, b"partial"),
        (operator_file, b"operator"),
    ):
        path.write_bytes(content)

    reconcile_reports_root(report_root, {tracked.name})

    assert tracked.read_bytes() == b"tracked"
    assert operator_file.read_bytes() == b"operator"
    assert not untracked.exists()
    assert not temporary.exists()


def test_reconciliation_is_idempotent_and_preserves_metadata_reference(
        report_root, tmp_path):
    from app.services.report_management import reconcile_reports_root

    tracked = tmp_path / report_leaf(1)
    tracked.write_bytes(b"immutable-report")
    (tmp_path / ".tmp_once").write_bytes(b"partial")

    reconcile_reports_root(report_root, [tracked.name])
    reconcile_reports_root(report_root, [tracked.name])

    assert {path.name: path.read_bytes() for path in tmp_path.iterdir()} == {
        tracked.name: b"immutable-report",
    }


@pytest.mark.parametrize("failure_point", ("unlink", "fsync"))
def test_reconciliation_cleanup_or_fsync_failure_fails_closed(
        report_root, tmp_path, monkeypatch, failure_point):
    import app.services.report_management as report_management

    orphan = tmp_path / report_leaf(2)
    orphan.write_bytes(b"orphan")
    if failure_point == "unlink":
        monkeypatch.setattr(
            report_management,
            "_unlink",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(
                OSError(errno.EACCES, "cleanup denied")
            ),
        )
    else:
        monkeypatch.setattr(
            report_management,
            "_fsync",
            lambda *_: (_ for _ in ()).throw(OSError(errno.EIO, "fsync denied")),
        )

    with pytest.raises(RuntimeError, match="reconciliation failed"):
        report_management.reconcile_reports_root(report_root, set())


def test_report_root_operations_never_reopen_configured_root_by_path(
        report_root, tmp_path, monkeypatch):
    import app.services.report_management as report_management

    original_open = report_management.os.open
    open_calls = []

    def require_dirfd_open(path, flags, mode=0o777, *, dir_fd=None):
        open_calls.append((path, dir_fd))
        if dir_fd is None:
            raise AssertionError("configured root was reopened by path")
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(report_management.os, "open", require_dirfd_open)

    published = report_root.create_report(report_leaf(), b"%PDF-dirfd")
    report_management.reconcile_reports_root(report_root, {published.leaf})
    report_root.remove_published(published)

    assert open_calls
    assert all(dir_fd == report_root.fd for _, dir_fd in open_calls)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_lifespan_retains_reconciled_root_fd_until_shutdown(
        tmp_path, monkeypatch):
    import app.main as main

    tracked = tmp_path / report_leaf(1)
    tracked.write_bytes(b"tracked")
    (tmp_path / report_leaf(2)).write_bytes(b"untracked")
    (tmp_path / ".tmp_startup").write_bytes(b"partial")
    session = SimpleNamespace(
        scalars=lambda _statement: [tracked.name],
        close=lambda: None,
    )
    monkeypatch.setenv("REPORTS_DIR", str(tmp_path))
    monkeypatch.setattr(main, "init_db", lambda: None)
    monkeypatch.setattr(main, "SessionLocal", lambda: session)
    monkeypatch.setattr(main, "seed_admin", lambda _db: None)
    test_app = FastAPI()

    async with main.lifespan(test_app):
        retained_fd = test_app.state.report_root.fd
        assert os.fstat(retained_fd).st_ino == tmp_path.stat().st_ino
        assert tracked.read_bytes() == b"tracked"
        assert {path.name for path in tmp_path.iterdir()} == {tracked.name}

    with pytest.raises(OSError, match="Bad file descriptor"):
        os.fstat(retained_fd)


@pytest.mark.asyncio
async def test_lifespan_closes_root_when_database_startup_fails(tmp_path, monkeypatch):
    import app.main as main
    from app.services.report_management import ReportRoot

    opened_root = ReportRoot.open(tmp_path)
    session = SimpleNamespace(close=lambda: None)
    monkeypatch.setattr(main, "init_db", lambda: None)
    monkeypatch.setattr(main.ReportRoot, "open", lambda _path: opened_root)
    monkeypatch.setattr(main, "SessionLocal", lambda: session)
    monkeypatch.setattr(
        main,
        "seed_admin",
        lambda _db: (_ for _ in ()).throw(RuntimeError("database startup failed")),
    )

    with pytest.raises(RuntimeError, match="database startup failed"):
        async with main.lifespan(FastAPI()):
            pytest.fail("startup failure must not accept requests")

    with pytest.raises(RuntimeError, match="closed"):
        _ = opened_root.fd
