"""File-backed integration coverage for both guarded SQLite migration stages."""
import json
import sqlite3

import pytest
from sqlalchemy import create_engine, event

from app.db import (
    FINAL_VERSION,
    MigrationBlocked,
    MigrationLocked,
    UnsupportedDatabaseVersion,
    run_migrations,
    run_prerequisite_migrations,
)


LEGACY_SCHEMA = """
CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL, active BOOLEAN NOT NULL,
    created_at DATETIME NOT NULL
);
CREATE TABLE auth_sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX ix_auth_sessions_user_id ON auth_sessions(user_id);
CREATE TABLE part_types (
    id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    description TEXT NOT NULL, image_path TEXT, active BOOLEAN NOT NULL,
    created_at DATETIME NOT NULL
);
CREATE TABLE characteristics (
    id INTEGER PRIMARY KEY, part_type_id INTEGER NOT NULL, code TEXT NOT NULL,
    name TEXT, unit TEXT, tol_type TEXT NOT NULL, nominal FLOAT, tol_plus FLOAT,
    min_limit FLOAT, max_limit FLOAT, sort_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT 1, UNIQUE (part_type_id, code)
);
CREATE INDEX ix_characteristics_part_type_id ON characteristics(part_type_id);
CREATE TABLE balloons (
    id INTEGER PRIMARY KEY, part_type_id INTEGER NOT NULL, number INTEGER NOT NULL,
    characteristic_id INTEGER NOT NULL UNIQUE, x FLOAT NOT NULL, y FLOAT NOT NULL,
    UNIQUE(part_type_id, number), FOREIGN KEY(part_type_id) REFERENCES part_types(id),
    FOREIGN KEY(characteristic_id) REFERENCES characteristics(id)
);
CREATE INDEX ix_balloons_part_type_id ON balloons(part_type_id);
CREATE TABLE pieces (
    id INTEGER PRIMARY KEY, part_type_id INTEGER NOT NULL, serial TEXT NOT NULL,
    created_at DATETIME NOT NULL, UNIQUE(part_type_id, serial),
    FOREIGN KEY(part_type_id) REFERENCES part_types(id)
);
CREATE INDEX ix_pieces_part_type_id ON pieces(part_type_id);
CREATE TABLE inspections (
    id INTEGER PRIMARY KEY, piece_id INTEGER NOT NULL, inspector_id INTEGER NOT NULL,
    selected_characteristic_ids TEXT NOT NULL, status TEXT NOT NULL,
    started_at DATETIME NOT NULL, completed_at DATETIME, annulled_at DATETIME,
    annulled_by INTEGER, annulment_reason TEXT,
    FOREIGN KEY(piece_id) REFERENCES pieces(id),
    FOREIGN KEY(inspector_id) REFERENCES users(id)
);
CREATE INDEX ix_inspections_piece_id ON inspections(piece_id);
CREATE TABLE measurements (
    id INTEGER PRIMARY KEY, inspection_id INTEGER NOT NULL,
    characteristic_id INTEGER NOT NULL, actual_value FLOAT NOT NULL,
    nominal_snapshot FLOAT, lower_limit_snapshot FLOAT,
    upper_limit_snapshot FLOAT, deviation FLOAT, status TEXT NOT NULL,
    disposition_by INTEGER, disposition_at DATETIME, disposition_note TEXT,
    created_at DATETIME NOT NULL, UNIQUE (inspection_id, characteristic_id)
);
CREATE INDEX ix_measurements_inspection_id ON measurements(inspection_id);
"""


def connect(path):
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    return connection


def engine_for(path):
    return create_engine(f"sqlite:///{path}", connect_args={"timeout": 0.05})


def create_legacy_database(path, *, version=0):
    with connect(path) as db:
        db.executescript(LEGACY_SCHEMA)
        if version == 1:
            db.execute("ALTER TABLE characteristics ADD COLUMN measurement_method TEXT")
            db.execute("ALTER TABLE measurements ADD COLUMN measurement_method_snapshot TEXT")
            db.execute("PRAGMA user_version = 1")


def insert_characteristic(db, row_id, *, tol_type="SYMMETRIC", nominal=10.0,
                          tol_plus=0.5, minimum=None, maximum=None, method="Caliper"):
    columns = (
        "id, part_type_id, code, tol_type, nominal, tol_plus, min_limit, max_limit"
    )
    values = [row_id, 1, f"C{row_id}", tol_type, nominal, tol_plus, minimum, maximum]
    if "measurement_method" in {
            row[1] for row in db.execute("PRAGMA table_info(characteristics)")}:
        columns += ", measurement_method"
        values.append(method)
    db.execute(
        f"INSERT INTO characteristics ({columns}) VALUES ({','.join('?' for _ in values)})",
        values,
    )


def insert_annulled_evidence(db):
    db.execute(
        "INSERT INTO inspections VALUES (1,1,7,'1','REJECTED',?,?,?,?,?)",
        ("2026-01-01", "2026-01-02", "2026-01-03", 7, "Duplicate"),
    )
    db.execute(
        """INSERT INTO measurements
           (id,inspection_id,characteristic_id,actual_value,nominal_snapshot,
            lower_limit_snapshot,upper_limit_snapshot,deviation,status,
            disposition_by,disposition_at,disposition_note,created_at)
           VALUES (1,1,1,11,10,9.5,10.5,1,'REJECTED',7,'2026-01-04',
                   'Scrap part','2026-01-01')"""
    )


def user_version(path):
    with connect(path) as db:
        return db.execute("PRAGMA user_version").fetchone()[0]


def schema_sql(path):
    with connect(path) as db:
        return db.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()


def test_fresh_database_is_created_directly_at_v2(tmp_path):
    path = tmp_path / "fresh.db"

    run_prerequisite_migrations(engine_for(path))

    with connect(path) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 2
        assert db.execute("PRAGMA table_info(characteristics)").fetchall()[5][1] == (
            "measurement_method"
        )
        assert db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='deviations'"
        ).fetchone()[0] == "deviations"


def test_ordered_legacy_migration_derives_bounds_backs_up_and_preserves_evidence(tmp_path):
    path = tmp_path / "legacy.db"
    create_legacy_database(path)
    with connect(path) as db:
        insert_characteristic(db, 1)
        insert_annulled_evidence(db)

    with pytest.raises(MigrationBlocked, match="measurement_method is required"):
        run_prerequisite_migrations(engine_for(path))
    assert user_version(path) == 1
    with connect(path) as db:
        db.execute(
            "UPDATE characteristics SET measurement_method='Caliper' WHERE id=1"
        )
    run_prerequisite_migrations(engine_for(path))

    backup = path.with_suffix(path.suffix + ".pre-v2.bak")
    assert user_version(path) == 2
    assert user_version(backup) == 1
    with connect(path) as db:
        characteristic = db.execute(
            "SELECT measurement_method, min_limit, max_limit FROM characteristics WHERE id=1"
        ).fetchone()
        assert tuple(characteristic) == ("Caliper", 9.5, 10.5)
        inspection = db.execute(
            "SELECT annulled_at, annulment_reason FROM inspections WHERE id=1"
        ).fetchone()
        assert tuple(inspection) == ("2026-01-03", "Duplicate")
        measurement = db.execute(
            """SELECT min_limit_snapshot,max_limit_snapshot,
                      measurement_method_snapshot,status
               FROM measurements WHERE id=1"""
        ).fetchone()
        assert tuple(measurement) == (9.5, 10.5, None, "REJECTED")
        deviation = db.execute(
            """SELECT measurement_id,origin,status,resolution_text,resolved_by,resolved_at
               FROM deviations"""
        ).fetchone()
        assert tuple(deviation) == (
            1, "AUTO", "REJECTED", "Scrap part", 7, "2026-01-04",
        )


@pytest.mark.parametrize(
    "legacy_status,expected_status,resolution",
    [
        ("PENDING", "PENDING", None),
        ("DEVIATION_ACCEPTED", "ACCEPTED", "Use as is"),
        ("REJECTED", "REJECTED", "Scrap part"),
    ],
)
def test_every_legacy_disposition_state_becomes_an_auto_deviation(
        tmp_path, legacy_status, expected_status, resolution):
    path = tmp_path / f"disposition-{legacy_status}.db"
    create_legacy_database(path, version=1)
    with connect(path) as db:
        insert_characteristic(db, 1)
        insert_annulled_evidence(db)
        if legacy_status == "PENDING":
            db.execute(
                """UPDATE measurements SET status=?,disposition_by=NULL,
                          disposition_at=NULL,disposition_note=NULL WHERE id=1""",
                (legacy_status,),
            )
        elif legacy_status == "DEVIATION_ACCEPTED":
            db.execute(
                "UPDATE measurements SET status=?,disposition_note=? WHERE id=1",
                (legacy_status, resolution),
            )

    run_prerequisite_migrations(engine_for(path))

    with connect(path) as db:
        row = db.execute(
            "SELECT origin,status,resolution_text FROM deviations WHERE measurement_id=1"
        ).fetchone()
        assert tuple(row) == ("AUTO", expected_status, resolution)


def test_guarded_activation_reports_every_row_and_leaves_v1_unchanged(tmp_path):
    path = tmp_path / "blocked.db"
    create_legacy_database(path, version=1)
    with connect(path) as db:
        insert_characteristic(
            db, 11, tol_type="LIMITS", nominal=None, tol_plus=None,
            minimum=1.0, maximum=2.0, method="Gauge",
        )
        insert_characteristic(db, 12, method="  ")
    before = schema_sql(path)

    with pytest.raises(MigrationBlocked) as blocked:
        run_prerequisite_migrations(engine_for(path))

    assert "characteristics.id=11: LIMITS nominal is required" in str(blocked.value)
    assert "characteristics.id=12: measurement_method is required" in str(blocked.value)
    assert user_version(path) == 1
    assert schema_sql(path) == before
    assert not path.with_suffix(path.suffix + ".pre-v2.bak").exists()


def test_blocked_v0_can_be_corrected_and_retried_idempotently(tmp_path):
    path = tmp_path / "retry.db"
    create_legacy_database(path)
    with connect(path) as db:
        insert_characteristic(
            db, 21, tol_type="LIMITS", nominal=None, tol_plus=None,
            minimum=1.0, maximum=2.0,
        )

    with pytest.raises(MigrationBlocked):
        run_prerequisite_migrations(engine_for(path))
    assert user_version(path) == 1

    with connect(path) as db:
        db.execute(
            "UPDATE characteristics SET nominal=1.5, measurement_method='Micrometer' WHERE id=21"
        )
    run_prerequisite_migrations(engine_for(path))
    first_schema = schema_sql(path)
    run_prerequisite_migrations(engine_for(path))

    assert user_version(path) == 2
    assert schema_sql(path) == first_schema
    with connect(path) as db:
        assert tuple(db.execute(
            "SELECT nominal,min_limit,max_limit,measurement_method FROM characteristics"
        ).fetchone()) == (1.5, 1.0, 2.0, "Micrometer")


@pytest.mark.parametrize("version", [3, 99])
def test_newer_or_unknown_database_versions_fail_closed(tmp_path, version):
    path = tmp_path / f"version-{version}.db"
    with connect(path) as db:
        db.execute("CREATE TABLE sentinel (value TEXT)")
        db.execute("INSERT INTO sentinel VALUES ('untouched')")
        db.execute(f"PRAGMA user_version = {version}")

    with pytest.raises(UnsupportedDatabaseVersion, match=str(version)):
        run_prerequisite_migrations(engine_for(path))

    assert user_version(path) == version
    with connect(path) as db:
        assert db.execute("SELECT value FROM sentinel").fetchone()[0] == "untouched"


def create_prerequisite_database(path, *, sample=False):
    create_legacy_database(path, version=1)
    if sample:
        with connect(path) as db:
            db.execute(
                "INSERT INTO users VALUES (7,'admin','hash','admin',1,'2026-01-01')"
            )
            db.execute(
                "INSERT INTO part_types VALUES "
                "(1,'LEG-100','PN-100','Bracket','parts/bracket.png',1,'2026-01-01')"
            )
            db.execute("INSERT INTO pieces VALUES (1,1,'SER-001','2026-01-01')")
            insert_characteristic(db, 1)
            db.execute("INSERT INTO balloons VALUES (1,1,42,1,0.25,0.75)")
            insert_annulled_evidence(db)
            db.execute(
                "UPDATE measurements SET status='DEVIATION_ACCEPTED', "
                "disposition_note='Legacy concession' WHERE id=1"
            )
    run_prerequisite_migrations(engine_for(path))
    assert user_version(path) == 2


def columns(db, table):
    return tuple(row[1] for row in db.execute(f"PRAGMA table_info({table})"))


@pytest.mark.parametrize("version", [0, 1, 4, 99])
def test_downstream_migration_rejects_every_non_entry_version_unchanged(
        tmp_path, version):
    path = tmp_path / f"wrong-start-{version}.db"
    with connect(path) as db:
        db.execute("CREATE TABLE sentinel (value TEXT)")
        db.execute("INSERT INTO sentinel VALUES ('untouched')")
        db.execute(f"PRAGMA user_version={version}")
    before = schema_sql(path)

    with pytest.raises(UnsupportedDatabaseVersion, match=f"expected 2.*actual {version}"):
        run_migrations(engine_for(path))

    assert user_version(path) == version
    assert schema_sql(path) == before
    assert not list(tmp_path.glob(f"{path.name}.pre-v3.*.bak"))


def test_partial_version_two_fingerprint_fails_before_backup(tmp_path):
    path = tmp_path / "partial-v2.db"
    with connect(path) as db:
        db.execute("CREATE TABLE part_types (id INTEGER PRIMARY KEY)")
        db.execute("PRAGMA user_version=2")
    before = schema_sql(path)

    with pytest.raises(MigrationBlocked, match="version-2 schema fingerprint"):
        run_migrations(engine_for(path))

    assert user_version(path) == 2
    assert schema_sql(path) == before
    assert not list(tmp_path.glob(f"{path.name}.pre-v3.*.bak"))


def test_partial_final_version_is_not_accepted_as_completed(tmp_path):
    path = tmp_path / "partial-final.db"
    with connect(path) as db:
        db.execute("CREATE TABLE sentinel (value TEXT)")
        db.execute("INSERT INTO sentinel VALUES ('untouched')")
        db.execute(f"PRAGMA user_version={FINAL_VERSION}")
    before = schema_sql(path)

    with pytest.raises(MigrationBlocked, match="final schema fingerprint"):
        run_migrations(engine_for(path))

    assert user_version(path) == FINAL_VERSION
    assert schema_sql(path) == before
    assert not list(tmp_path.glob(f"{path.name}.pre-v3.*.bak"))


def test_v2_to_final_backfills_full_revision_and_removes_physical_legacy_columns(
        tmp_path):
    path = tmp_path / "successful.db"
    create_prerequisite_database(path, sample=True)

    run_migrations(engine_for(path))

    assert user_version(path) == FINAL_VERSION == 3
    with connect(path) as db:
        assert columns(db, "part_types") == (
            "id", "part_number", "part_description", "legacy_code", "revision_no",
            "image_path", "active", "created_at",
        )
        assert "code" not in columns(db, "characteristics")
        assert "control_plan" in columns(db, "characteristics")
        assert "number" not in columns(db, "balloons")
        assert "serial" not in columns(db, "pieces")
        assert tuple(db.execute(
            "SELECT part_number,part_description,legacy_code,revision_no FROM part_types"
        ).fetchone()) == ("PN-100", "Bracket", "LEG-100", 1)
        definition = json.loads(db.execute(
            "SELECT definition_json FROM part_revisions WHERE part_type_id=1"
        ).fetchone()[0])
        assert definition == {
            "active": True,
            "characteristics": [{
                "active": True, "balloon": {"x": 0.25, "y": 0.75},
                "control_plan": "C1", "id": 1, "max_limit": 10.5,
                "measurement_method": "Caliper", "min_limit": 9.5,
                "name": None, "nominal": 10.0, "sort_order": 0,
                "tol_minus": None, "tol_plus": 0.5,
                "tol_type": "SYMMETRIC", "unit": None,
            }],
            "image_path": "parts/bracket.png", "legacy_code": "LEG-100",
            "part_description": "Bracket", "part_number": "PN-100",
        }
        assert db.execute("SELECT part_revision_id FROM inspections").fetchone()[0] == 1
        assert tuple(db.execute(
            "SELECT code,description,active FROM approved_deviations"
        ).fetchone()) == ("LEGACY-1", "Legacy concession", 0)
        assert tuple(db.execute(
            "SELECT approved_deviation_id,approved_deviation_code_snapshot,"
            "approved_deviation_description_snapshot,rejection_reason FROM deviations"
        ).fetchone()) == (1, "LEGACY-1", "Legacy concession", None)
        assert tuple(db.execute(
            "SELECT deviation_id,action,actor_id FROM deviation_audit_events"
        ).fetchone()) == (1, "ACCEPTED", 7)
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []


def test_backup_precedes_preflight_and_corrected_retry_is_atomic_and_idempotent(
        tmp_path):
    path = tmp_path / "retry-v3.db"
    create_prerequisite_database(path, sample=True)
    with connect(path) as db:
        db.execute("UPDATE part_types SET name=' ', description=' ' WHERE id=1")
        db.execute("PRAGMA foreign_keys=OFF")
        db.execute("UPDATE balloons SET characteristic_id=999 WHERE id=1")
    before = schema_sql(path)

    for _ in range(7):
        with pytest.raises(MigrationBlocked) as blocked:
            run_migrations(engine_for(path))
        assert "part_types.id=1: part_number is blank" in str(blocked.value)
        assert "part_types.id=1: part_description is blank" in str(blocked.value)
        assert "balloons rowid=1" in str(blocked.value)
        assert user_version(path) == 2
        assert schema_sql(path) == before

    backups = sorted(tmp_path.glob(f"{path.name}.pre-v3.*.bak"))
    assert len(backups) == 5
    with connect(backups[-1]) as backup:
        assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert backup.execute("PRAGMA user_version").fetchone()[0] == 2

    with connect(path) as db:
        db.execute("UPDATE part_types SET name='PN-100',description='Bracket' WHERE id=1")
        db.execute("UPDATE balloons SET characteristic_id=1 WHERE id=1")
    run_migrations(engine_for(path))
    final_schema = schema_sql(path)
    run_migrations(engine_for(path))

    assert user_version(path) == FINAL_VERSION
    assert schema_sql(path) == final_schema
    assert len(list(tmp_path.glob(f"{path.name}.pre-v3.*.bak"))) == 5


def test_runner_uses_one_exclusive_begin_and_rejects_a_concurrent_lock(tmp_path):
    path = tmp_path / "exclusive.db"
    create_prerequisite_database(path)
    target = engine_for(path)
    statements = []
    event.listen(
        target, "before_cursor_execute",
        lambda _c, _u, statement, _p, _x, _m: statements.append(statement.strip()),
    )

    run_migrations(target)

    assert [sql for sql in statements if sql.upper() == "BEGIN EXCLUSIVE"] == [
        "BEGIN EXCLUSIVE"
    ]

    locked_path = tmp_path / "locked.db"
    create_prerequisite_database(locked_path)
    holder = sqlite3.connect(locked_path, isolation_level=None)
    holder.execute("BEGIN EXCLUSIVE")
    try:
        with pytest.raises(MigrationLocked, match="already in progress"):
            run_migrations(engine_for(locked_path))
    finally:
        holder.rollback()
        holder.close()
    assert user_version(locked_path) == 2
    assert not list(tmp_path.glob(f"{locked_path.name}.pre-v3.*.bak"))


def test_append_only_audit_triggers_survive_file_backup_restore(tmp_path):
    path = tmp_path / "trigger.db"
    restored = tmp_path / "trigger-restored.db"
    create_prerequisite_database(path, sample=True)
    run_migrations(engine_for(path))
    with connect(path) as source, connect(restored) as destination:
        source.backup(destination)

    with connect(restored) as db:
        trigger_names = {row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger'"
        )}
        assert trigger_names == {
            "deviation_audit_events_no_update", "deviation_audit_events_no_delete",
        }
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            db.execute("UPDATE deviation_audit_events SET action='REJECTED' WHERE id=1")
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            db.execute("DELETE FROM deviation_audit_events WHERE id=1")
        assert db.execute(
            "SELECT action FROM deviation_audit_events WHERE id=1"
        ).fetchone()[0] == "ACCEPTED"
