"""Database engine/session wiring and fail-closed SQLite migrations."""
import json
import os
import sqlite3
import time
from math import isfinite
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from app.models import Base

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///data/app.db")
PREREQUISITE_VERSION = 2
FINAL_VERSION = 3

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class MigrationError(RuntimeError):
    """Database activation could not complete safely."""


class MigrationBlocked(MigrationError):
    """Legacy rows require correction before strict schema activation."""


class UnsupportedDatabaseVersion(MigrationError):
    """The database version is not understood by this application."""


class MigrationLocked(MigrationError):
    """Another process already owns the exclusive migration lock."""


def _version(connection) -> int:
    return int(connection.exec_driver_sql("PRAGMA user_version").scalar_one())


def _table_names(connection) -> set[str]:
    return set(connection.exec_driver_sql(
        "SELECT name FROM sqlite_master "
        "WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).scalars())


def _columns(connection, table: str) -> set[str]:
    return {row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table})")}


def _require_legacy_schema(connection) -> None:
    tables = _table_names(connection)
    required = {"characteristics", "measurements"}
    if not required.issubset(tables):
        missing = ", ".join(sorted(required - tables))
        raise MigrationError(f"Unknown version-0 schema; missing tables: {missing}")


def _migrate_zero_to_one(target: Engine) -> None:
    with target.begin() as connection:
        _require_legacy_schema(connection)
        if "measurement_method" not in _columns(connection, "characteristics"):
            connection.exec_driver_sql(
                "ALTER TABLE characteristics ADD COLUMN measurement_method VARCHAR(500)"
            )
        if "measurement_method_snapshot" not in _columns(connection, "measurements"):
            connection.exec_driver_sql(
                "ALTER TABLE measurements "
                "ADD COLUMN measurement_method_snapshot VARCHAR(500)"
            )
        connection.exec_driver_sql("PRAGMA user_version = 1")


def _preflight_v2(target: Engine) -> None:
    diagnostics: list[str] = []
    with target.connect() as connection:
        _require_legacy_schema(connection)
        for table, column in (
            ("characteristics", "measurement_method"),
            ("measurements", "measurement_method_snapshot"),
        ):
            if column not in _columns(connection, table):
                raise MigrationError(
                    f"Unknown version-1 schema; {table}.{column} is missing"
                )
        characteristics = connection.exec_driver_sql(
            """SELECT id,tol_type,nominal,tol_plus,min_limit,max_limit,
                      measurement_method FROM characteristics ORDER BY id"""
        ).mappings()
        for row in characteristics:
            prefix = f"characteristics.id={row['id']}: "
            method = row["measurement_method"]
            if method is None or not method.strip():
                diagnostics.append(prefix + "measurement_method is required")
            nominal = row["nominal"]
            if row["tol_type"] == "SYMMETRIC":
                tolerance = row["tol_plus"]
                values = (nominal, tolerance)
                if any(value is None or not isfinite(value) for value in values):
                    diagnostics.append(prefix + "finite nominal and tol_plus are required")
                elif tolerance < 0 or not all(isfinite(value) for value in (
                        nominal - tolerance, nominal + tolerance)):
                    diagnostics.append(prefix + "SYMMETRIC bounds are invalid")
            elif row["tol_type"] == "LIMITS":
                if nominal is None:
                    diagnostics.append(prefix + "LIMITS nominal is required")
                values = (nominal, row["min_limit"], row["max_limit"])
                if all(value is not None and isfinite(value) for value in values):
                    if not row["min_limit"] <= nominal <= row["max_limit"]:
                        diagnostics.append(prefix + "LIMITS range must contain nominal")
                elif nominal is not None:
                    diagnostics.append(prefix + "finite LIMITS values are required")
            else:
                diagnostics.append(prefix + f"unknown tol_type {row['tol_type']!r}")

        measurements = connection.exec_driver_sql(
            """SELECT id,nominal_snapshot,lower_limit_snapshot,upper_limit_snapshot,
                      status,disposition_by,disposition_at,disposition_note
               FROM measurements ORDER BY id"""
        ).mappings()
        for row in measurements:
            prefix = f"measurements.id={row['id']}: "
            snapshots = (
                row["nominal_snapshot"], row["lower_limit_snapshot"],
                row["upper_limit_snapshot"],
            )
            if any(value is None or not isfinite(value) for value in snapshots):
                diagnostics.append(prefix + "canonical numeric snapshots are required")
            if row["status"] in ("DEVIATION_ACCEPTED", "REJECTED") and (
                    row["disposition_by"] is None or row["disposition_at"] is None
                    or row["disposition_note"] is None
                    or not row["disposition_note"].strip()):
                diagnostics.append(prefix + "resolved disposition audit is incomplete")
    if diagnostics:
        raise MigrationBlocked("Migration to version 2 blocked:\n" + "\n".join(diagnostics))


def _backup_before_v2(target: Engine) -> Path:
    database = target.url.database
    if not database or database == ":memory:":
        raise MigrationError("Version-2 activation requires a file-backed SQLite database")
    source_path = Path(database)
    backup_path = source_path.with_suffix(source_path.suffix + ".pre-v2.bak")
    if backup_path.exists():
        return backup_path
    temporary = backup_path.with_suffix(backup_path.suffix + ".tmp")
    with sqlite3.connect(source_path) as source, sqlite3.connect(temporary) as backup:
        source.backup(backup)
    os.replace(temporary, backup_path)
    return backup_path


CHARACTERISTICS_V2 = """
CREATE TABLE characteristics_v2 (
    id INTEGER NOT NULL PRIMARY KEY, part_type_id INTEGER NOT NULL,
    code VARCHAR(40) NOT NULL, name VARCHAR(120), unit VARCHAR(20),
    measurement_method VARCHAR(500) NOT NULL, tol_type VARCHAR(9) NOT NULL,
    nominal FLOAT NOT NULL, tol_plus FLOAT, min_limit FLOAT NOT NULL,
    max_limit FLOAT NOT NULL, sort_order INTEGER NOT NULL, active BOOLEAN NOT NULL,
    UNIQUE (part_type_id, code),
    CONSTRAINT ck_characteristic_measurement_method_nonblank
        CHECK (length(trim(measurement_method)) > 0),
    CONSTRAINT ck_characteristic_canonical_values_finite CHECK (
        nominal BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308 AND
        min_limit BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308 AND
        max_limit BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308),
    CONSTRAINT ck_characteristic_canonical_range
        CHECK (min_limit <= nominal AND nominal <= max_limit),
    FOREIGN KEY(part_type_id) REFERENCES part_types (id)
)
"""

MEASUREMENTS_V2 = """
CREATE TABLE measurements_v2 (
    id INTEGER NOT NULL PRIMARY KEY, inspection_id INTEGER NOT NULL,
    characteristic_id INTEGER NOT NULL, actual_value FLOAT NOT NULL,
    nominal_snapshot FLOAT NOT NULL, min_limit_snapshot FLOAT NOT NULL,
    max_limit_snapshot FLOAT NOT NULL, measurement_method_snapshot VARCHAR(500),
    deviation FLOAT, status VARCHAR(18) NOT NULL, disposition_by INTEGER,
    disposition_at DATETIME, disposition_note VARCHAR(500), created_at DATETIME NOT NULL,
    UNIQUE (inspection_id, characteristic_id),
    CONSTRAINT ck_measurement_snapshot_values_finite CHECK (
        nominal_snapshot BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308 AND
        min_limit_snapshot BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308 AND
        max_limit_snapshot BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308),
    FOREIGN KEY(inspection_id) REFERENCES inspections (id),
    FOREIGN KEY(characteristic_id) REFERENCES characteristics (id),
    FOREIGN KEY(disposition_by) REFERENCES users (id)
)
"""

DEVIATIONS_V2 = """
CREATE TABLE deviations (
    id INTEGER NOT NULL PRIMARY KEY, measurement_id INTEGER NOT NULL,
    origin VARCHAR(6) NOT NULL, status VARCHAR(8) NOT NULL,
    description VARCHAR(500), created_by INTEGER, created_at DATETIME NOT NULL,
    resolution_text VARCHAR(500), resolved_by INTEGER, resolved_at DATETIME,
    CONSTRAINT ck_deviation_manual_description CHECK (
        origin != 'MANUAL' OR (description IS NOT NULL AND length(trim(description)) > 0)),
    CONSTRAINT ck_deviation_pending_unresolved CHECK (
        status != 'PENDING' OR
        (resolution_text IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)),
    CONSTRAINT ck_deviation_resolution_audit CHECK (
        status = 'PENDING' OR
        (resolution_text IS NOT NULL AND length(trim(resolution_text)) > 0 AND
         resolved_by IS NOT NULL AND resolved_at IS NOT NULL)),
    FOREIGN KEY(measurement_id) REFERENCES measurements (id),
    FOREIGN KEY(created_by) REFERENCES users (id),
    FOREIGN KEY(resolved_by) REFERENCES users (id)
)
"""


def _activate_v2(target: Engine) -> None:
    connection = target.connect().execution_options(isolation_level="AUTOCOMMIT")
    try:
        connection.exec_driver_sql("PRAGMA foreign_keys = OFF")
        connection.exec_driver_sql("BEGIN EXCLUSIVE")
        connection.exec_driver_sql(CHARACTERISTICS_V2)
        connection.exec_driver_sql(MEASUREMENTS_V2)
        connection.exec_driver_sql(
            """INSERT INTO characteristics_v2
               SELECT id,part_type_id,code,name,unit,trim(measurement_method),tol_type,
                      nominal,tol_plus,
                      CASE WHEN tol_type='SYMMETRIC' THEN nominal-tol_plus ELSE min_limit END,
                      CASE WHEN tol_type='SYMMETRIC' THEN nominal+tol_plus ELSE max_limit END,
                      sort_order,active FROM characteristics"""
        )
        connection.exec_driver_sql(
            """INSERT INTO measurements_v2
               SELECT id,inspection_id,characteristic_id,actual_value,nominal_snapshot,
                      lower_limit_snapshot,upper_limit_snapshot,
                      measurement_method_snapshot,deviation,status,disposition_by,
                      disposition_at,disposition_note,created_at FROM measurements"""
        )
        connection.exec_driver_sql("DROP TABLE measurements")
        connection.exec_driver_sql("DROP TABLE characteristics")
        connection.exec_driver_sql("ALTER TABLE characteristics_v2 RENAME TO characteristics")
        connection.exec_driver_sql("ALTER TABLE measurements_v2 RENAME TO measurements")
        connection.exec_driver_sql(
            "CREATE INDEX ix_characteristics_part_type_id ON characteristics (part_type_id)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX ix_measurements_inspection_id ON measurements (inspection_id)"
        )
        connection.exec_driver_sql(DEVIATIONS_V2)
        connection.exec_driver_sql(
            "CREATE INDEX ix_deviations_measurement_id ON deviations (measurement_id)"
        )
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX uq_deviation_auto_measurement ON deviations (measurement_id) "
            "WHERE origin = 'AUTO'"
        )
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX uq_deviation_pending_manual_measurement "
            "ON deviations (measurement_id) WHERE origin = 'MANUAL' AND status = 'PENDING'"
        )
        connection.exec_driver_sql(
            """INSERT INTO deviations
               (measurement_id,origin,status,description,created_by,created_at,
                resolution_text,resolved_by,resolved_at)
               SELECT id,'AUTO',
                      CASE status WHEN 'DEVIATION_ACCEPTED' THEN 'ACCEPTED'
                                  WHEN 'REJECTED' THEN 'REJECTED' ELSE 'PENDING' END,
                      NULL,NULL,created_at,
                      CASE WHEN status IN ('DEVIATION_ACCEPTED','REJECTED')
                           THEN disposition_note END,
                      CASE WHEN status IN ('DEVIATION_ACCEPTED','REJECTED')
                           THEN disposition_by END,
                      CASE WHEN status IN ('DEVIATION_ACCEPTED','REJECTED')
                           THEN disposition_at END
               FROM measurements
               WHERE status IN ('PENDING','DEVIATION_ACCEPTED','REJECTED')"""
        )
        connection.exec_driver_sql("PRAGMA user_version = 2")
        connection.exec_driver_sql("COMMIT")
    except BaseException:
        connection.exec_driver_sql("ROLLBACK")
        raise
    finally:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON")
        connection.close()


def run_prerequisite_migrations(target: Engine) -> None:
    """Advance a supported file-backed SQLite database to schema version 2."""
    if target.dialect.name != "sqlite":
        raise MigrationError("Only SQLite databases are supported")
    with target.connect() as connection:
        current = _version(connection)
        tables = _table_names(connection)
    if current == 0 and not tables:
        Base.metadata.create_all(target)
        with target.begin() as connection:
            connection.exec_driver_sql("PRAGMA user_version = 2")
        return
    if current not in (0, 1, 2):
        raise UnsupportedDatabaseVersion(f"Unsupported database version: {current}")
    if current == 2:
        return
    if current == 0:
        _migrate_zero_to_one(target)
    _preflight_v2(target)
    _backup_before_v2(target)
    _activate_v2(target)


PREREQUISITE_COLUMNS = {
    "users": ("id", "username", "password_hash", "role", "active", "created_at"),
    "auth_sessions": ("token", "user_id", "expires_at", "created_at"),
    "part_types": (
        "id", "code", "name", "description", "image_path", "active", "created_at",
    ),
    "characteristics": (
        "id", "part_type_id", "code", "name", "unit", "measurement_method",
        "tol_type", "nominal", "tol_plus", "min_limit", "max_limit", "sort_order",
        "active",
    ),
    "balloons": ("id", "part_type_id", "number", "characteristic_id", "x", "y"),
    "pieces": ("id", "part_type_id", "serial", "created_at"),
    "inspections": (
        "id", "piece_id", "inspector_id", "selected_characteristic_ids", "status",
        "started_at", "completed_at", "annulled_at", "annulled_by", "annulment_reason",
    ),
    "measurements": (
        "id", "inspection_id", "characteristic_id", "actual_value",
        "nominal_snapshot", "min_limit_snapshot", "max_limit_snapshot",
        "measurement_method_snapshot", "deviation", "status", "disposition_by",
        "disposition_at", "disposition_note", "created_at",
    ),
    "deviations": (
        "id", "measurement_id", "origin", "status", "description", "created_by",
        "created_at", "resolution_text", "resolved_by", "resolved_at",
    ),
}
FINAL_COLUMNS = {
    name: tuple(column.name for column in table.columns)
    for name, table in Base.metadata.tables.items()
}
FINAL_INDEXES = {
    index.name
    for table in Base.metadata.tables.values()
    for index in table.indexes
    if index.name
}
AUDIT_TRIGGERS = {
    "deviation_audit_events_no_update",
    "deviation_audit_events_no_delete",
}


def _column_fingerprint(connection) -> dict[str, tuple[str, ...]]:
    return {
        table: tuple(row[1] for row in connection.exec_driver_sql(
            f'PRAGMA table_info("{table}")'
        ))
        for table in sorted(_table_names(connection))
    }


def _require_fingerprint(connection, expected, label: str) -> None:
    actual = _column_fingerprint(connection)
    if actual != expected:
        missing = sorted(set(expected) - set(actual))
        extra = sorted(set(actual) - set(expected))
        changed = sorted(
            table for table in set(actual) & set(expected)
            if actual[table] != expected[table]
        )
        raise MigrationBlocked(
            f"{label} schema fingerprint mismatch; missing={missing}, "
            f"extra={extra}, changed={changed}"
        )


def _require_final_fingerprint(connection) -> None:
    _require_fingerprint(connection, FINAL_COLUMNS, "final")
    indexes = set(connection.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='index' "
        "AND name NOT LIKE 'sqlite_autoindex_%'"
    ).scalars())
    triggers = set(connection.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='trigger'"
    ).scalars())
    if indexes != FINAL_INDEXES or triggers != AUDIT_TRIGGERS:
        raise MigrationBlocked(
            "final schema fingerprint mismatch; "
            f"indexes={sorted(indexes)}, triggers={sorted(triggers)}"
        )


def _backup_locked_database(connection, target: Engine) -> Path:
    database = target.url.database
    if not database or database == ":memory:":
        raise MigrationError("Version-3 activation requires a file-backed SQLite database")
    source_path = Path(database)
    stamp = time.time_ns()
    backup_path = source_path.with_name(
        f"{source_path.name}.pre-v3.{stamp}.bak"
    )
    temporary = backup_path.with_suffix(backup_path.suffix + ".tmp")
    raw_source = connection.connection.driver_connection
    snapshot = sqlite3.connect(":memory:")
    destination = sqlite3.connect(temporary)
    try:
        snapshot.deserialize(raw_source.serialize())
        snapshot.backup(destination)
        if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise MigrationError("Pre-v3 backup failed integrity_check")
        if destination.execute("PRAGMA user_version").fetchone()[0] != 2:
            raise MigrationError("Pre-v3 backup has an unexpected user_version")
    finally:
        destination.close()
        snapshot.close()
    os.replace(temporary, backup_path)
    backups = sorted(source_path.parent.glob(f"{source_path.name}.pre-v3.*.bak"))
    for obsolete in backups[:-5]:
        obsolete.unlink()
    return backup_path


def _rows(connection, table: str) -> list[dict]:
    return [dict(row) for row in connection.exec_driver_sql(
        f'SELECT * FROM "{table}" ORDER BY id'
    ).mappings()]


def _preflight_v3(connection) -> dict[str, list[dict]]:
    diagnostics: list[str] = []
    state = {table: _rows(connection, table) for table in (
        "part_types", "characteristics", "balloons", "pieces", "inspections",
        "measurements", "deviations",
    )}
    for table, rowid, parent, fkid in connection.exec_driver_sql(
            "PRAGMA foreign_key_check"):
        diagnostics.append(
            f"{table} rowid={rowid}: broken foreign key to {parent} (fkid={fkid})"
        )
    for row in state["part_types"]:
        if not row["name"].strip():
            diagnostics.append(f"part_types.id={row['id']}: part_number is blank")
        if not row["description"].strip():
            diagnostics.append(f"part_types.id={row['id']}: part_description is blank")
    parts = {row["id"] for row in state["part_types"]}
    characteristics = {row["id"]: row for row in state["characteristics"]}
    pieces = {row["id"]: row for row in state["pieces"]}
    for row in state["characteristics"]:
        if not row["code"].strip():
            diagnostics.append(f"characteristics.id={row['id']}: control_plan is blank")
    for row in state["balloons"]:
        characteristic = characteristics.get(row["characteristic_id"])
        if characteristic and characteristic["part_type_id"] != row["part_type_id"]:
            diagnostics.append(
                f"balloons.id={row['id']}: characteristic belongs to another part"
            )
    for row in state["inspections"]:
        piece = pieces.get(row["piece_id"])
        if piece and piece["part_type_id"] not in parts:
            diagnostics.append(f"inspections.id={row['id']}: part revision is not derivable")
    for row in state["deviations"]:
        if row["status"] in ("ACCEPTED", "REJECTED") and (
                row["resolved_by"] is None or row["resolved_at"] is None
                or not (row["resolution_text"] or "").strip()):
            diagnostics.append(
                f"deviations.id={row['id']}: resolved audit is not derivable"
            )
    if diagnostics:
        raise MigrationBlocked("Migration to version 3 blocked:\n" + "\n".join(diagnostics))
    return state


def _revision_definitions(state) -> dict[int, str]:
    characteristics = {}
    balloons = {row["characteristic_id"]: row for row in state["balloons"]}
    for row in state["characteristics"]:
        balloon = balloons.get(row["id"])
        characteristics.setdefault(row["part_type_id"], []).append({
            "id": row["id"], "control_plan": row["code"], "name": row["name"],
            "unit": row["unit"], "measurement_method": row["measurement_method"],
            "tol_type": row["tol_type"], "nominal": row["nominal"],
            "tol_plus": row["tol_plus"], "tol_minus": None,
            "min_limit": row["min_limit"], "max_limit": row["max_limit"],
            "sort_order": row["sort_order"], "active": bool(row["active"]),
            "balloon": None if balloon is None else {"x": balloon["x"], "y": balloon["y"]},
        })
    return {
        row["id"]: json.dumps({
            "part_number": row["name"], "part_description": row["description"],
            "legacy_code": row["code"], "image_path": row["image_path"],
            "active": bool(row["active"]),
            "characteristics": characteristics.get(row["id"], []),
        }, sort_keys=True, separators=(",", ":"))
        for row in state["part_types"]
    }


def _insert_rows(connection, table: str, rows: list[dict]) -> None:
    if not rows:
        return
    columns = tuple(rows[0])
    placeholders = ",".join("?" for _ in columns)
    connection.exec_driver_sql(
        f'INSERT INTO "{table}" ({",".join(columns)}) VALUES ({placeholders})',
        [tuple(row[column] for column in columns) for row in rows],
    )


def _activate_v3(connection, state) -> None:
    definitions = _revision_definitions(state)
    pieces = {row["id"]: row for row in state["pieces"]}
    resolved = [row for row in state["deviations"] if row["status"] != "PENDING"]
    approved = [{
        "id": row["id"], "code": f"LEGACY-{row['id']}",
        "description": row["resolution_text"].strip(), "active": 0,
        "created_at": row["resolved_at"],
    } for row in resolved if row["status"] == "ACCEPTED"]
    approved_by_deviation = {row["id"]: item for row, item in zip(
        (row for row in resolved if row["status"] == "ACCEPTED"), approved
    )}
    revisions = [{
        "id": row["id"], "part_type_id": row["id"], "revision_no": 1,
        "definition_json": definitions[row["id"]], "created_by": None,
        "created_at": row["created_at"],
    } for row in state["part_types"]]
    transformed = {
        "part_types": [{
            "id": row["id"], "part_number": row["name"],
            "part_description": row["description"], "legacy_code": row["code"],
            "revision_no": 1, "image_path": row["image_path"],
            "active": row["active"], "created_at": row["created_at"],
        } for row in state["part_types"]],
        "characteristics": [{**row, "control_plan": row["code"], "tol_minus": None}
                            for row in state["characteristics"]],
        "balloons": [{key: row[key] for key in (
            "id", "part_type_id", "characteristic_id", "x", "y"
        )} for row in state["balloons"]],
        "pieces": [{key: row[key] for key in ("id", "part_type_id", "created_at")}
                   for row in state["pieces"]],
        "approved_deviations": approved,
        "part_revisions": revisions,
        "inspections": [{**row, "part_revision_id": pieces[row["piece_id"]]["part_type_id"]}
                        for row in state["inspections"]],
        "measurements": state["measurements"],
    }
    for row in transformed["characteristics"]:
        row.pop("code")
    deviations = []
    audits = []
    for row in state["deviations"]:
        approved_row = approved_by_deviation.get(row["id"])
        deviation = {key: row[key] for key in (
            "id", "measurement_id", "origin", "status", "description", "created_by",
            "created_at", "resolved_by", "resolved_at",
        )}
        deviation.update({
            "approved_deviation_id": approved_row["id"] if approved_row else None,
            "approved_deviation_code_snapshot": approved_row["code"] if approved_row else None,
            "approved_deviation_description_snapshot": (
                approved_row["description"] if approved_row else None
            ),
            "rejection_reason": (
                row["resolution_text"].strip() if row["status"] == "REJECTED" else None
            ),
        })
        deviations.append(deviation)
        if row["status"] != "PENDING":
            audits.append({
                "id": row["id"], "deviation_id": row["id"], "action": row["status"],
                "actor_id": row["resolved_by"],
                "approved_deviation_id": deviation["approved_deviation_id"],
                "approved_deviation_code_snapshot": deviation[
                    "approved_deviation_code_snapshot"
                ],
                "approved_deviation_description_snapshot": deviation[
                    "approved_deviation_description_snapshot"
                ],
                "rejection_reason": deviation["rejection_reason"],
                "created_at": row["resolved_at"],
            })
    transformed["deviations"] = deviations
    transformed["deviation_audit_events"] = audits
    for table in (
        "deviations", "measurements", "inspections", "balloons", "characteristics",
        "pieces", "part_types",
    ):
        connection.exec_driver_sql(f'DROP TABLE "{table}"')
    Base.metadata.create_all(connection)
    for table in (
        "part_types", "characteristics", "balloons", "pieces", "approved_deviations",
        "part_revisions", "inspections", "measurements", "deviations",
        "deviation_audit_events",
    ):
        _insert_rows(connection, table, transformed.get(table, []))
    _create_audit_triggers(connection)


def _create_audit_triggers(connection) -> None:
    connection.exec_driver_sql(
        "CREATE TRIGGER deviation_audit_events_no_update "
        "BEFORE UPDATE ON deviation_audit_events BEGIN "
        "SELECT RAISE(ABORT, 'deviation audit events are append-only'); END"
    )
    connection.exec_driver_sql(
        "CREATE TRIGGER deviation_audit_events_no_delete "
        "BEFORE DELETE ON deviation_audit_events BEGIN "
        "SELECT RAISE(ABORT, 'deviation audit events are append-only'); END"
    )


def _initialize_fresh_database(connection) -> None:
    """Create the final canonical schema for a brand-new empty database.

    Runs inside the already-acquired exclusive transaction so initialization is
    atomic and concurrent attempts remain serialized.
    """
    Base.metadata.create_all(connection)
    _create_audit_triggers(connection)
    connection.exec_driver_sql(f"PRAGMA user_version = {FINAL_VERSION}")
    _require_final_fingerprint(connection)


def run_migrations(target: Engine) -> None:
    """Validate final schema or atomically migrate exact prerequisite version 2 to 3."""
    # Steps 0-2: validate the engine, open the activation connection, and disable
    # FK enforcement while retaining explicit foreign_key_check verification.
    if target.dialect.name != "sqlite":
        raise MigrationError("Only SQLite databases are supported")
    connection = target.connect().execution_options(isolation_level="AUTOCOMMIT")
    began = False
    try:
        connection.exec_driver_sql("PRAGMA foreign_keys = OFF")
        # Steps 3-4: take the only exclusive lock and read the locked version.
        try:
            connection.exec_driver_sql("BEGIN EXCLUSIVE")
            began = True
        except OperationalError as exc:
            if "locked" in str(exc).lower():
                raise MigrationLocked("Database migration is already in progress") from exc
            raise
        current = _version(connection)
        # Step 5: an already-final database is accepted only by exact fingerprint.
        if current == FINAL_VERSION:
            _require_final_fingerprint(connection)
            connection.exec_driver_sql("COMMIT")
            began = False
            return
        # Step 5b: a brand-new empty database initializes straight to the final
        # canonical schema; there is no legacy data to migrate.
        if current == 0 and not _table_names(connection):
            _initialize_fresh_database(connection)
            connection.exec_driver_sql("COMMIT")
            began = False
            return
        # Steps 6-7: require the exact prerequisite version and schema fingerprint.
        if current != PREREQUISITE_VERSION:
            raise UnsupportedDatabaseVersion(
                f"Unsupported database version; expected 2, actual {current}"
            )
        _require_fingerprint(connection, PREREQUISITE_COLUMNS, "version-2")
        # Steps 8-9: snapshot, integrity-check, publish, and retain five backups.
        _backup_locked_database(connection, target)
        # Step 10: collect all row-level derivability diagnostics before rebuilds.
        state = _preflight_v3(connection)
        # Steps 11-12: rebuild canonical tables, backfill revision 1, and add triggers.
        _activate_v3(connection, state)
        # Steps 13-14: verify references/fingerprint, set F, and commit atomically.
        violations = list(connection.exec_driver_sql("PRAGMA foreign_key_check"))
        if violations:
            raise MigrationBlocked(f"Final foreign-key check failed: {violations}")
        connection.exec_driver_sql(f"PRAGMA user_version = {FINAL_VERSION}")
        _require_final_fingerprint(connection)
        connection.exec_driver_sql("COMMIT")
        began = False
    except BaseException:
        if began:
            connection.exec_driver_sql("ROLLBACK")
        raise
    finally:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON")
        connection.close()


def init_db() -> None:
    if DATABASE_URL.startswith("sqlite:///") and ":memory:" not in DATABASE_URL:
        path = DATABASE_URL.removeprefix("sqlite:///")
        if path:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    run_migrations(engine)
