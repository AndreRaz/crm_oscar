import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.models import (
    Base, User, AuthSession, PartType, Characteristic, Balloon, Piece,
    Inspection, Measurement,
)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def add_part_type(db, code="PT-1"):
    pt = PartType(code=code)
    db.add(pt)
    db.commit()
    return pt


def add_user(db, username="alice", role="admin"):
    user = User(username=username, role=role, password_hash="x")
    db.add(user)
    db.commit()
    return user


def add_symmetric_characteristic(db, pt):
    ch = Characteristic(part_type_id=pt.id, code="A1", tol_type="SYMMETRIC",
                        nominal=10.0, tol_plus=0.1)
    db.add(ch)
    db.commit()
    return ch


class TestUserConstraints:
    def test_duplicate_username_rejected(self, db):
        add_user(db, "alice")
        with pytest.raises(IntegrityError):
            db.add(User(username="alice", role="inspector", password_hash="y"))
            db.commit()


class TestCharacteristicConstraints:
    def test_symmetric_requires_nominal_and_tol_plus(self, db):
        pt = add_part_type(db)
        with pytest.raises(IntegrityError):
            db.add(Characteristic(part_type_id=pt.id, code="A1",
                                  tol_type="SYMMETRIC", nominal=10.0))
            db.commit()

    def test_limits_requires_at_least_one_bound(self, db):
        pt = add_part_type(db)
        with pytest.raises(IntegrityError):
            db.add(Characteristic(part_type_id=pt.id, code="A2", tol_type="LIMITS"))
            db.commit()

    def test_limits_min_cannot_exceed_max(self, db):
        pt = add_part_type(db)
        with pytest.raises(IntegrityError):
            db.add(Characteristic(part_type_id=pt.id, code="A3", tol_type="LIMITS",
                                  min_limit=5.2, max_limit=5.0))
            db.commit()

    def test_code_unique_per_part_type(self, db):
        pt = add_part_type(db)
        add_symmetric_characteristic(db, pt)
        with pytest.raises(IntegrityError):
            db.add(Characteristic(part_type_id=pt.id, code="A1", tol_type="LIMITS",
                                  min_limit=0.0))
            db.commit()


class TestBalloonConstraints:
    def test_number_unique_per_part_type(self, db):
        pt = add_part_type(db)
        ch1 = add_symmetric_characteristic(db, pt)
        db.add(Balloon(part_type_id=pt.id, number=1, characteristic_id=ch1.id, x=0.1, y=0.2))
        db.commit()
        ch2 = Characteristic(part_type_id=pt.id, code="A2", tol_type="LIMITS", min_limit=0.0)
        db.add(ch2)
        db.commit()
        with pytest.raises(IntegrityError):
            db.add(Balloon(part_type_id=pt.id, number=1, characteristic_id=ch2.id, x=0.3, y=0.4))
            db.commit()

    def test_one_balloon_per_characteristic(self, db):
        pt = add_part_type(db)
        ch = add_symmetric_characteristic(db, pt)
        db.add(Balloon(part_type_id=pt.id, number=1, characteristic_id=ch.id, x=0.1, y=0.2))
        db.commit()
        with pytest.raises(IntegrityError):
            db.add(Balloon(part_type_id=pt.id, number=2, characteristic_id=ch.id, x=0.3, y=0.4))
            db.commit()


class TestPieceConstraint:
    def test_serial_unique_per_part_type(self, db):
        pt = add_part_type(db)
        db.add(Piece(part_type_id=pt.id, serial="S1"))
        db.commit()
        with pytest.raises(IntegrityError):
            db.add(Piece(part_type_id=pt.id, serial="S1"))
            db.commit()


class TestMeasurementConstraint:
    def test_unique_per_inspection_and_characteristic(self, db):
        pt = add_part_type(db)
        user = add_user(db, "bob", "inspector")
        ch = add_symmetric_characteristic(db, pt)
        piece = Piece(part_type_id=pt.id, serial="S1")
        db.add(piece)
        db.commit()
        insp = Inspection(piece_id=piece.id, inspector_id=user.id, status="PENDING")
        db.add(insp)
        db.commit()
        db.add(Measurement(inspection_id=insp.id, characteristic_id=ch.id,
                           actual_value=10.0, status="IN_TOLERANCE"))
        db.commit()
        with pytest.raises(IntegrityError):
            db.add(Measurement(inspection_id=insp.id, characteristic_id=ch.id,
                               actual_value=10.1, status="PENDING"))
            db.commit()
