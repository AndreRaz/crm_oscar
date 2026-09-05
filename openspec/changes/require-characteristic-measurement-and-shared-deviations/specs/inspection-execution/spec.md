# Delta for Inspection Execution

## MODIFIED Requirements

### Requirement: Provide guided manual measurement capture

The system MUST present the selected characteristic in three panes: image and highlighted balloon, the nominal/min/max limits and `measurement_method`, and manual actual-value input. It MUST validate numeric, unit-aware decimal input and MUST permit unselected characteristics to be skipped. When a measurement is recorded, the system MUST capture a four-field snapshot of `nominal`, `min_limit`, `max_limit`, and `measurement_method`.
(Previously: panes showed nominal/tolerance only; method absent; snapshot content unspecified.)

#### Scenario: Inspector records a numeric value

- GIVEN a selected characteristic with a valid canonical definition
- WHEN the inspector enters a valid measured decimal
- THEN the actual value is accepted, a four-field snapshot is stored, and the result is displayed with its method

#### Scenario: Invalid input is not recorded

- GIVEN a measurement input that is non-numeric or invalid for its unit
- WHEN the inspector submits it
- THEN the value is rejected with validation feedback and no measurement is recorded

## ADDED Requirements

### Requirement: Create measurement-bound manual deviations

An authenticated inspector MUST be able to create a `MANUAL` deviation from the inspection screen for any recorded measurement regardless of its dimensional status. A MANUAL deviation MUST require a nonblank description. The system MUST enforce at most one `PENDING` MANUAL deviation per measurement. Creating or resolving a MANUAL deviation MUST NOT change the measurement's dimensional status or the inspection's worst-of status.

#### Scenario: Inspector reports a manual deviation on an in-tolerance measurement

- GIVEN an authenticated inspector and a measurement with status `IN_TOLERANCE`
- WHEN the inspector submits a nonblank description for a manual deviation
- THEN a `PENDING` MANUAL deviation is created for that measurement and the measurement status remains `IN_TOLERANCE`

#### Scenario: Second open manual deviation is rejected

- GIVEN a measurement that already has a `PENDING` MANUAL deviation
- WHEN the inspector attempts to create another manual deviation for it
- THEN the creation is rejected and the existing deviation remains the only open manual deviation

#### Scenario: Blank description is rejected

- GIVEN an authenticated inspector and any recorded measurement
- WHEN the inspector submits an empty or whitespace-only description for a manual deviation
- THEN no manual deviation is created

#### Scenario: Manual deviation does not affect inspection status

- GIVEN an inspection whose measurements are all `IN_TOLERANCE` and one carries a `PENDING` MANUAL deviation
- WHEN the inspection status is derived
- THEN the overall status remains `CONFORMING`
