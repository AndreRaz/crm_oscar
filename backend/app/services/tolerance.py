"""Tolerance evaluation rule. Pure function, no DB/HTTP deps."""
from app.services.status import MeasurementStatus


def evaluate(actual: float, nominal: float | None, lower: float | None, upper: float | None) -> MeasurementStatus:
    """Evaluate a measurement against resolved limits.

    In-range iff lower <= actual <= upper (inclusive; None bound = unbounded).
    `nominal` is part of the resolved-snapshot contract (ADR-4); the decision
    only depends on the resolved bounds.
    """
    if (lower is not None and actual < lower) or (upper is not None and actual > upper):
        return MeasurementStatus.PENDING
    return MeasurementStatus.IN_TOLERANCE
