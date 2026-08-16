"""Status enums and worst-of derivation. Pure functions, no DB/HTTP deps."""
from enum import Enum
from typing import Iterable


class MeasurementStatus(str, Enum):
    IN_TOLERANCE = "IN_TOLERANCE"
    PENDING = "PENDING"
    DEVIATION_ACCEPTED = "DEVIATION_ACCEPTED"
    REJECTED = "REJECTED"


class InspectionStatus(str, Enum):
    CONFORMING = "CONFORMING"
    PENDING = "PENDING"
    ACCEPTED_WITH_DEVIATIONS = "ACCEPTED_WITH_DEVIATIONS"
    REJECTED = "REJECTED"


def worst_of(statuses: Iterable[MeasurementStatus]) -> InspectionStatus:
    """Derive inspection status: REJECTED > PENDING > DEVIATION_ACCEPTED > CONFORMING."""
    present = set(statuses)
    if MeasurementStatus.REJECTED in present:
        return InspectionStatus.REJECTED
    if MeasurementStatus.PENDING in present:
        return InspectionStatus.PENDING
    if MeasurementStatus.DEVIATION_ACCEPTED in present:
        return InspectionStatus.ACCEPTED_WITH_DEVIATIONS
    return InspectionStatus.CONFORMING
