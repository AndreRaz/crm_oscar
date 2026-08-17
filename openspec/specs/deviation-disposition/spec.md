# Deviation Disposition Specification

## Purpose

Provide audited administrator disposition of out-of-tolerance measurements and correction by annulment.

## Requirements

### Requirement: Queue pending deviations

The system MUST mark every out-of-tolerance measurement `PENDING`, MUST prevent inspectors from accepting deviations, and MUST show administrators a queue grouped by inspection.

#### Scenario: Pending deviation appears in the queue

- GIVEN a completed inspection containing an out-of-tolerance measurement
- WHEN an administrator opens the deviation queue
- THEN the measurement appears under its inspection with pending status

#### Scenario: Inspector cannot dispose a deviation

- GIVEN an authenticated inspector and a pending deviation
- WHEN the inspector attempts to resolve it
- THEN the action is denied and the deviation remains `PENDING`

### Requirement: Resolve deviations with mandatory audit data

An administrator MUST resolve each pending deviation as `DEVIATION_ACCEPTED` with a nonblank concession note or `REJECTED` with a nonblank reason. Each resolution MUST record the acting user and timestamp.

#### Scenario: Administrator accepts or rejects

- GIVEN an administrator and a pending deviation
- WHEN the administrator submits a valid note or reason
- THEN the status changes to the selected disposition and user, time, and text are audited

#### Scenario: Missing disposition text is rejected

- GIVEN a pending deviation
- WHEN the administrator submits an empty or whitespace-only note or reason
- THEN the disposition is rejected and the status remains `PENDING`

### Requirement: Derive overall inspection status

The system MUST derive inspection status from current measurement statuses: any `REJECTED` yields `REJECTED`; otherwise any `PENDING` yields `PENDING`; otherwise any `DEVIATION_ACCEPTED` yields `ACCEPTED_WITH_DEVIATIONS`; otherwise it yields `CONFORMING`.

#### Scenario: Worst status wins

- GIVEN an inspection with accepted, pending, and rejected measurements
- WHEN its status is requested after disposition changes
- THEN the overall status is `REJECTED`

#### Scenario: No deviations is conforming

- GIVEN an inspection whose measurements are all `IN_TOLERANCE`
- WHEN its status is requested
- THEN the overall status is `CONFORMING`

### Requirement: Preserve records and support annulment

Completed inspections and measurements MUST be immutable. Only an administrator MAY annul a completed inspection, and annulment MUST require a nonblank reason, record user and timestamp, and require a new inspection for corrections.

#### Scenario: Administrator annuls an inspection

- GIVEN a completed inspection and an administrator
- WHEN the administrator submits a valid annulment reason
- THEN the inspection is marked annulled and the annulment audit is retained

#### Scenario: Completed measurement cannot be changed

- GIVEN a completed inspection
- WHEN any user attempts to edit a measurement or disposition data directly
- THEN the change is denied and the original record remains unchanged

#### Scenario: Annulment without a reason is rejected

- GIVEN a completed inspection and an administrator
- WHEN the administrator submits an empty or whitespace-only annulment reason
- THEN the annulment is rejected and the inspection remains unchanged
