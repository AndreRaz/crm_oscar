from datetime import datetime, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.models import (
    Base, User, AuthSession, PartType, Characteristic, Balloon, Piece,
    Inspection, Measurement, Deviation, PartRevision, ApprovedDeviation,
    DeviationAuditEvent, GeneratedReport,
)
from app.schemas import (
    ApprovedDeviationIn, ApprovedDeviationOut, DeviationAuditEventOut,
    DeviationOut, DeviationResolutionIn, GeneratedReportOut, ManualDeviationIn,
    PartRevisionOut, PartTypeIn, PartTypeOut, ReportEligibilityOut,
)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def add_part_type(db, code="PT-1"):
    pt = PartType(part_number=code, part_description="Test")
    db.add(pt)
    db.flush()
    revision = PartRevision(
        part_type_id=pt.id,
        revision_no=1,
        definition_json='{"part_number":"PT-1"}',
    )
    db.add(revision)
    db.commit()
    pt.current_revision = revision
    return pt


def add_user(db, username="alice", role="admin"):
    user = User(username=username, role=role, password_hash="x")
    db.add(user)
    db.commit()
    return user


def add_symmetric_characteristic(db, pt):
    ch = Characteristic(part_type_id=pt.id, control_plan="A1", tol_type="SYMMETRIC",
                        measurement_method="Digital caliper", nominal=10.0,
                        tol_plus=0.1, tol_minus=0.1,
                        min_limit=9.9, max_limit=10.1)
    db.add(ch)
    db.commit()
    return ch


def add_measurement(db, code="PT-1"):
    pt = add_part_type(db, code)
    user = add_user(db, f"inspector-{code}", "inspector")
    ch = add_symmetric_characteristic(db, pt)
    piece = Piece(part_type_id=pt.id)
    db.add(piece)
    db.flush()
    inspection = Inspection(
        piece_id=piece.id,
        inspector_id=user.id,
        part_revision_id=pt.current_revision.id,
        selected_characteristic_ids=str(ch.id),
        status="PENDING",
    )
    db.add(inspection)
    db.flush()
    measurement = Measurement(
        inspection_id=inspection.id,
        characteristic_id=ch.id,
        actual_value=10.0,
        nominal_snapshot=10.0,
        min_limit_snapshot=9.9,
        max_limit_snapshot=10.1,
        measurement_method_snapshot=None,
        status="IN_TOLERANCE",
    )
    db.add(measurement)
    db.commit()
    return measurement, user


class TestUserConstraints:
    def test_duplicate_username_rejected(self, db):
        add_user(db, "alice")
        with pytest.raises(IntegrityError):
            db.add(User(username="alice", role="inspector", password_hash="y"))
            db.commit()


class TestCharacteristicConstraints:
    @pytest.mark.parametrize("missing", [
        "measurement_method", "nominal", "min_limit", "max_limit",
    ])
    def test_canonical_fields_are_required(self, db, missing):
        pt = add_part_type(db)
        values = {
            "measurement_method": "Digital caliper",
            "nominal": 10.0,
            "min_limit": 9.9,
            "max_limit": 10.1,
        }
        values[missing] = None
        with pytest.raises(IntegrityError):
            db.add(Characteristic(
                part_type_id=pt.id,
                control_plan="A1",
                tol_type="LIMITS",
                **values,
            ))
            db.commit()

    @pytest.mark.parametrize("method", ["", "   "])
    def test_measurement_method_must_be_nonblank(self, db, method):
        pt = add_part_type(db)
        with pytest.raises(IntegrityError):
            db.add(Characteristic(
                part_type_id=pt.id,
                control_plan="A2",
                tol_type="LIMITS",
                measurement_method=method,
                nominal=10.0,
                min_limit=9.9,
                max_limit=10.1,
            ))
            db.commit()

    @pytest.mark.parametrize("field", ["nominal", "min_limit", "max_limit"])
    @pytest.mark.parametrize("value", [float("inf"), float("-inf"), float("nan")])
    def test_canonical_numbers_must_be_finite(self, db, field, value):
        pt = add_part_type(db)
        values = {"nominal": 10.0, "min_limit": 9.9, "max_limit": 10.1}
        values[field] = value
        with pytest.raises(IntegrityError):
            db.add(Characteristic(
                part_type_id=pt.id,
                control_plan="A3",
                tol_type="LIMITS",
                measurement_method="Digital caliper",
                **values,
            ))
            db.commit()

    @pytest.mark.parametrize("nominal,min_limit,max_limit", [
        (9.8, 9.9, 10.1),
        (10.2, 9.9, 10.1),
    ])
    def test_nominal_must_be_between_limits(self, db, nominal, min_limit, max_limit):
        pt = add_part_type(db)
        with pytest.raises(IntegrityError):
            db.add(Characteristic(
                part_type_id=pt.id,
                control_plan="A4",
                tol_type="LIMITS",
                measurement_method="Digital caliper",
                nominal=nominal,
                min_limit=min_limit,
                max_limit=max_limit,
            ))
            db.commit()

    def test_nominal_may_equal_either_limit(self, db):
        pt = add_part_type(db)
        db.add_all([
            Characteristic(
                part_type_id=pt.id,
                control_plan="LOW",
                tol_type="LIMITS",
                measurement_method="Gauge",
                nominal=9.9,
                min_limit=9.9,
                max_limit=10.1,
            ),
            Characteristic(
                part_type_id=pt.id,
                control_plan="HIGH",
                tol_type="LIMITS",
                measurement_method="Gauge",
                nominal=10.1,
                min_limit=9.9,
                max_limit=10.1,
            ),
        ])
        db.commit()

        assert db.query(Characteristic).count() == 2

    def test_control_plan_unique_per_part_type(self, db):
        pt = add_part_type(db)
        add_symmetric_characteristic(db, pt)
        with pytest.raises(IntegrityError):
            db.add(Characteristic(part_type_id=pt.id, control_plan="A1", tol_type="LIMITS",
                                  measurement_method="Gauge", nominal=0.0,
                                  min_limit=0.0, max_limit=1.0))
            db.commit()


class TestBalloonConstraints:
    def test_one_balloon_per_characteristic(self, db):
        pt = add_part_type(db)
        ch = add_symmetric_characteristic(db, pt)
        db.add(Balloon(part_type_id=pt.id, characteristic_id=ch.id, x=0.1, y=0.2))
        db.commit()
        with pytest.raises(IntegrityError):
            db.add(Balloon(part_type_id=pt.id, characteristic_id=ch.id, x=0.3, y=0.4))
            db.commit()


class TestMeasurementConstraint:
    def test_unique_per_inspection_and_characteristic(self, db):
        pt = add_part_type(db)
        user = add_user(db, "bob", "inspector")
        ch = add_symmetric_characteristic(db, pt)
        piece = Piece(part_type_id=pt.id)
        db.add(piece)
        db.commit()
        insp = Inspection(piece_id=piece.id, inspector_id=user.id,
                          part_revision_id=pt.current_revision.id,
                          selected_characteristic_ids=str(ch.id), status="PENDING")
        db.add(insp)
        db.commit()
        db.add(Measurement(inspection_id=insp.id, characteristic_id=ch.id,
                           actual_value=10.0, nominal_snapshot=10.0,
                           min_limit_snapshot=9.9, max_limit_snapshot=10.1,
                           measurement_method_snapshot="Digital caliper",
                           status="IN_TOLERANCE"))
        db.commit()
        with pytest.raises(IntegrityError):
            db.add(Measurement(inspection_id=insp.id, characteristic_id=ch.id,
                               actual_value=10.1, nominal_snapshot=10.0,
                               min_limit_snapshot=9.9, max_limit_snapshot=10.1,
                               measurement_method_snapshot="Digital caliper",
                               status="PENDING"))
            db.commit()

    @pytest.mark.parametrize("missing", [
        "nominal_snapshot", "min_limit_snapshot", "max_limit_snapshot",
    ])
    def test_canonical_snapshot_numbers_are_required(self, db, missing):
        measurement, _ = add_measurement(db)
        first_inspection = db.get(Inspection, measurement.inspection_id)
        piece = Piece(part_type_id=db.get(Piece, first_inspection.piece_id).part_type_id)
        db.add(piece)
        db.flush()
        inspection = Inspection(
            piece_id=piece.id,
            inspector_id=first_inspection.inspector_id,
            part_revision_id=first_inspection.part_revision_id,
            selected_characteristic_ids=str(measurement.characteristic_id),
            status="PENDING",
        )
        db.add(inspection)
        db.flush()
        values = {
            "nominal_snapshot": 10.0,
            "min_limit_snapshot": 9.9,
            "max_limit_snapshot": 10.1,
        }
        values[missing] = None
        with pytest.raises(IntegrityError):
            db.add(Measurement(
                inspection_id=inspection.id,
                characteristic_id=measurement.characteristic_id,
                actual_value=10.0,
                status="IN_TOLERANCE",
                **values,
            ))
            db.commit()

    def test_legacy_measurement_method_snapshot_may_be_null(self, db):
        measurement, _ = add_measurement(db)

        assert measurement.measurement_method_snapshot is None


class TestDeviationConstraints:
    def test_only_one_auto_deviation_per_measurement(self, db):
        measurement, user = add_measurement(db)
        approved = ApprovedDeviation(code="AD-AUTO", description="Use as-is")
        db.add(approved)
        db.flush()
        db.add(Deviation(
            measurement_id=measurement.id,
            origin="AUTO",
            status="ACCEPTED",
            created_by=user.id,
            approved_deviation_id=approved.id,
            approved_deviation_code_snapshot=approved.code,
            approved_deviation_description_snapshot=approved.description,
            resolved_by=user.id,
            resolved_at=datetime.now(timezone.utc),
        ))
        db.commit()

        with pytest.raises(IntegrityError):
            db.add(Deviation(
                measurement_id=measurement.id,
                origin="AUTO",
                status="PENDING",
                created_by=user.id,
            ))
            db.commit()

    def test_only_one_pending_manual_deviation_per_measurement(self, db):
        measurement, user = add_measurement(db)
        db.add(Deviation(
            measurement_id=measurement.id,
            origin="MANUAL",
            status="PENDING",
            description="Surface finish concern",
            created_by=user.id,
        ))
        db.commit()

        with pytest.raises(IntegrityError):
            db.add(Deviation(
                measurement_id=measurement.id,
                origin="MANUAL",
                status="PENDING",
                description="Second concern",
                created_by=user.id,
            ))
            db.commit()

    def test_resolved_manual_deviations_do_not_block_another_pending_one(self, db):
        measurement, user = add_measurement(db)
        now = datetime.now(timezone.utc)
        approved = ApprovedDeviation(code="AD-MANUAL", description="Use as-is")
        db.add(approved)
        db.flush()
        db.add_all([
            Deviation(
                measurement_id=measurement.id,
                origin="MANUAL",
                status="ACCEPTED",
                description="First concern",
                created_by=user.id,
                approved_deviation_id=approved.id,
                approved_deviation_code_snapshot=approved.code,
                approved_deviation_description_snapshot=approved.description,
                resolved_by=user.id,
                resolved_at=now,
            ),
            Deviation(
                measurement_id=measurement.id,
                origin="MANUAL",
                status="REJECTED",
                description="Second concern",
                created_by=user.id,
                rejection_reason="Rejected after review",
                resolved_by=user.id,
                resolved_at=now,
            ),
            Deviation(
                measurement_id=measurement.id,
                origin="MANUAL",
                status="PENDING",
                description="Current concern",
                created_by=user.id,
            ),
        ])
        db.commit()

        assert db.query(Deviation).count() == 3


class TestDeviationContracts:
    @pytest.mark.parametrize("description", ["", "   "])
    def test_manual_description_must_be_nonblank(self, description):
        with pytest.raises(ValidationError):
            ManualDeviationIn(description=description)

    @pytest.mark.parametrize("reason", ["", "   "])
    def test_rejection_reason_must_be_nonblank(self, reason):
        with pytest.raises(ValidationError):
            DeviationResolutionIn(action="reject", rejection_reason=reason)

    def test_acceptance_contract_uses_catalog_id_and_rejects_free_text(self):
        accepted = DeviationResolutionIn(
            action="accept", approved_deviation_id=7,
        )
        assert accepted.approved_deviation_id == 7
        with pytest.raises(ValidationError):
            DeviationResolutionIn(action="accept", text="Use as-is")

    def test_deviation_output_reads_unified_model(self, db):
        measurement, user = add_measurement(db)
        deviation = Deviation(
            measurement_id=measurement.id,
            origin="MANUAL",
            status="PENDING",
            description="Surface finish concern",
            created_by=user.id,
        )
        db.add(deviation)
        db.commit()
        db.refresh(deviation)

        output = DeviationOut.model_validate(deviation)

        assert output.measurement_id == measurement.id
        assert output.origin == "MANUAL"
        assert output.status == "PENDING"
        assert output.description == "Surface finish concern"
        assert output.created_by == user.id


class TestCanonicalWorkflowSchema:
    def test_canonical_columns_replace_legacy_public_columns(self):
        expected = {
            "part_types": {"part_number", "part_description", "legacy_code", "revision_no"},
            "characteristics": {"control_plan", "tol_minus"},
            "inspections": {"part_revision_id"},
            "deviations": {
                "approved_deviation_id", "approved_deviation_code_snapshot",
                "approved_deviation_description_snapshot", "rejection_reason",
            },
        }

        for table_name, columns in expected.items():
            assert columns <= set(Base.metadata.tables[table_name].columns.keys())

        assert "name" not in Base.metadata.tables["part_types"].columns
        assert "description" not in Base.metadata.tables["part_types"].columns
        assert "code" not in Base.metadata.tables["characteristics"].columns
        assert "number" not in Base.metadata.tables["balloons"].columns
        assert "serial" not in Base.metadata.tables["pieces"].columns

    def test_new_tables_and_restrictive_foreign_keys_exist(self, db):
        expected_tables = {
            "part_revisions", "approved_deviations", "deviation_audit_events",
            "generated_reports",
        }
        assert expected_tables <= set(Base.metadata.tables)

        fk_deletions = {
            (fk.parent.table.name, fk.parent.name, fk.ondelete)
            for table in Base.metadata.tables.values()
            for fk in table.foreign_keys
        }
        assert {
            ("part_revisions", "part_type_id", "RESTRICT"),
            ("part_revisions", "created_by", "RESTRICT"),
            ("inspections", "part_revision_id", "RESTRICT"),
            ("deviations", "approved_deviation_id", "RESTRICT"),
            ("deviation_audit_events", "deviation_id", "RESTRICT"),
            ("deviation_audit_events", "actor_id", "RESTRICT"),
            ("deviation_audit_events", "approved_deviation_id", "RESTRICT"),
            ("generated_reports", "inspection_id", "RESTRICT"),
            ("generated_reports", "part_revision_id", "RESTRICT"),
            ("generated_reports", "generated_by", "RESTRICT"),
        } <= fk_deletions

        assert Base.metadata.tables["part_types"].columns.legacy_code.nullable
        assert not Base.metadata.tables["inspections"].columns.part_revision_id.nullable

        inspector = inspect(db.bind)
        checks = inspector.get_check_constraints("part_types")
        assert any("revision_no > 0" in check["sqltext"] for check in checks)
        revision_checks = inspector.get_check_constraints("part_revisions")
        assert any("revision_no > 0" in check["sqltext"] for check in revision_checks)

    @pytest.mark.parametrize("revision_no", [0, -1])
    def test_revision_numbers_must_be_positive(self, db, revision_no):
        with pytest.raises(IntegrityError):
            db.add(PartType(
                part_number=f"PT-{revision_no}",
                part_description="Invalid revision",
                revision_no=revision_no,
            ))
            db.commit()

    def test_restrict_foreign_key_prevents_deleting_referenced_catalog_entry(self, db):
        db.execute(text("PRAGMA foreign_keys=ON"))
        measurement, user = add_measurement(db)
        approved = ApprovedDeviation(code="AD-1", description="Use as-is")
        db.add(approved)
        db.flush()
        db.add(Deviation(
            measurement_id=measurement.id,
            origin="AUTO",
            status="ACCEPTED",
            created_by=user.id,
            approved_deviation_id=approved.id,
            approved_deviation_code_snapshot=approved.code,
            approved_deviation_description_snapshot=approved.description,
            resolved_by=user.id,
            resolved_at=datetime.now(timezone.utc),
        ))
        db.commit()

        with pytest.raises(IntegrityError):
            db.delete(approved)
            db.commit()

    @pytest.mark.parametrize("field", ["code", "description"])
    def test_approved_deviation_fields_must_be_nonblank(self, db, field):
        values = {"code": "AD-1", "description": "Use as-is"}
        values[field] = "   "

        with pytest.raises(IntegrityError):
            db.add(ApprovedDeviation(**values))
            db.commit()

    def test_generated_report_requires_sha256_length(self, db):
        measurement, user = add_measurement(db)
        inspection = db.get(Inspection, measurement.inspection_id)
        with pytest.raises(IntegrityError):
            db.add(GeneratedReport(
                inspection_id=inspection.id,
                part_revision_id=inspection.part_revision_id,
                content_hash="too-short",
                file_path="report.pdf",
                generated_by=user.id,
            ))
            db.commit()


class TestCanonicalWorkflowContracts:
    def test_part_type_write_rejects_legacy_code_and_output_omits_it(self):
        with pytest.raises(ValidationError):
            PartTypeIn(
                part_number="PN-100",
                part_description="Bracket",
                legacy_code="OLD-100",
            )

        output = PartTypeOut.model_validate({
            "id": 1,
            "part_number": "PN-100",
            "part_description": "Bracket",
            "legacy_code": "OLD-100",
            "image_path": None,
            "revision_no": 2,
            "active": True,
        })
        assert output.model_dump() == {
            "id": 1,
            "part_number": "PN-100",
            "part_description": "Bracket",
            "image_path": None,
            "revision_no": 2,
            "active": True,
        }

    def test_part_type_write_contract_rejects_all_legacy_public_names(self):
        for legacy_field in ("code", "name", "description", "legacy_code"):
            payload = {
                "part_number": "PN-100",
                "part_description": "Bracket",
                legacy_field: "legacy value",
            }
            with pytest.raises(ValidationError):
                PartTypeIn.model_validate(payload)

    @pytest.mark.parametrize("field", ["part_number", "part_description"])
    def test_part_type_write_contract_rejects_blank_canonical_fields(self, field):
        payload = {"part_number": "PN-100", "part_description": "Bracket"}
        payload[field] = "   "

        with pytest.raises(ValidationError):
            PartTypeIn.model_validate(payload)

    @pytest.mark.parametrize("field", ["code", "description"])
    def test_approved_deviation_contract_rejects_blank_fields(self, field):
        payload = {"code": "AD-1", "description": "Use as-is"}
        payload[field] = "   "

        with pytest.raises(ValidationError):
            ApprovedDeviationIn.model_validate(payload)

    def test_new_output_contracts_serialize_canonical_evidence(self):
        now = datetime.now(timezone.utc)
        revision = PartRevisionOut(
            id=1, part_type_id=2, revision_no=3,
            definition_json='{"part_number":"PN-100"}', created_at=now,
        )
        approved_in = ApprovedDeviationIn(code="AD-1", description="Use as-is")
        approved_out = ApprovedDeviationOut(
            id=4, code=approved_in.code, description=approved_in.description,
            active=True, created_at=now,
        )
        event = DeviationAuditEventOut(
            id=5, deviation_id=6, action="ACCEPTED", actor_id=7,
            approved_deviation_id=approved_out.id,
            approved_deviation_code_snapshot=approved_out.code,
            approved_deviation_description_snapshot=approved_out.description,
            rejection_reason=None, created_at=now,
        )
        report = GeneratedReportOut(
            id=8, inspection_id=9, part_revision_id=revision.id,
            content_hash="a" * 64, file_path="report_8.pdf",
            generated_by=7, generated_at=now,
        )
        eligibility = ReportEligibilityOut(
            eligible=False, missing_items=["Pending deviation 6"],
        )

        assert approved_out.code == "AD-1"
        assert event.approved_deviation_description_snapshot == "Use as-is"
        assert report.content_hash == "a" * 64
        assert eligibility.missing_items == ["Pending deviation 6"]
