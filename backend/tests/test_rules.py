from app.services.status import MeasurementStatus, InspectionStatus, worst_of
from app.services.tolerance import evaluate


class TestEvaluate:
    # Symmetric case expressed through its resolved bounds (nominal +/- tol)
    def test_symmetric_resolved_bounds_in_range(self):
        assert evaluate(10.0, 10.0, 9.9, 10.1) is MeasurementStatus.IN_TOLERANCE

    def test_symmetric_resolved_bounds_out_of_range(self):
        assert evaluate(10.2, 10.0, 9.9, 10.1) is MeasurementStatus.PENDING

    # LIMITS format (asymmetric bounds)
    def test_limits_asymmetric_in_range(self):
        assert evaluate(5.1, None, 4.8, 5.3) is MeasurementStatus.IN_TOLERANCE

    def test_limits_below_min(self):
        assert evaluate(4.7, None, 4.8, 5.3) is MeasurementStatus.PENDING

    def test_limits_above_max(self):
        assert evaluate(5.31, None, 4.8, 5.3) is MeasurementStatus.PENDING

    # Unilateral: one bound is None (unbounded)
    def test_unilateral_lower_only(self):
        assert evaluate(4.8, None, 4.8, None) is MeasurementStatus.IN_TOLERANCE
        assert evaluate(4.79, None, 4.8, None) is MeasurementStatus.PENDING

    def test_unilateral_upper_only(self):
        assert evaluate(120.0, None, None, 120.0) is MeasurementStatus.IN_TOLERANCE
        assert evaluate(120.1, None, None, 120.0) is MeasurementStatus.PENDING

    # Inclusive edges: bound values themselves are in tolerance
    def test_edges_are_inclusive(self):
        assert evaluate(9.9, 10.0, 9.9, 10.1) is MeasurementStatus.IN_TOLERANCE
        assert evaluate(10.1, 10.0, 9.9, 10.1) is MeasurementStatus.IN_TOLERANCE


class TestWorstOf:
    def test_empty_means_conforming(self):
        assert worst_of([]) is InspectionStatus.CONFORMING

    def test_all_in_tolerance_means_conforming(self):
        assert worst_of([MeasurementStatus.IN_TOLERANCE] * 3) is InspectionStatus.CONFORMING

    def test_pending_without_rejection(self):
        statuses = [MeasurementStatus.IN_TOLERANCE, MeasurementStatus.PENDING]
        assert worst_of(statuses) is InspectionStatus.PENDING

    def test_accepted_deviations(self):
        statuses = [MeasurementStatus.IN_TOLERANCE, MeasurementStatus.DEVIATION_ACCEPTED]
        assert worst_of(statuses) is InspectionStatus.ACCEPTED_WITH_DEVIATIONS

    def test_rejected_beats_pending_and_accepted(self):
        statuses = [
            MeasurementStatus.PENDING,
            MeasurementStatus.DEVIATION_ACCEPTED,
            MeasurementStatus.REJECTED,
        ]
        assert worst_of(statuses) is InspectionStatus.REJECTED
