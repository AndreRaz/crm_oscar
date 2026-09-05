# Delta for Deviation Disposition

## MODIFIED Requirements

### Requirement: Queue pending deviations

The system MUST persist deviations in a single `deviations` table with an `origin` discriminator of `AUTO` or `MANUAL`. An `AUTO` deviation MUST be materialized when an out-of-tolerance measurement is recorded. The deviations list MUST be visible to every authenticated user, grouped by inspection. The system MUST prevent inspectors from resolving deviations; only administrators MAY resolve them.
(Previously: admin-only queue of pending measurements; no deviation entity; no inspector visibility.)

#### Scenario: Shared deviations list is visible to all authenticated users

- GIVEN an authenticated inspector and an existing AUTO or MANUAL deviation
- WHEN the inspector opens the deviations list
- THEN the deviation appears grouped by its inspection

#### Scenario: Inspector cannot resolve a deviation

- GIVEN an authenticated inspector and a pending deviation
- WHEN the inspector attempts to resolve it
- THEN the action is denied and the deviation remains pending

### Requirement: Resolve deviations with mandatory audit data

An administrator MUST resolve each pending deviation as `ACCEPTED` with a nonblank note or `REJECTED` with a nonblank reason through a single transactional resolution service. Each resolution MUST record the acting user and timestamp. The legacy `POST /api/measurements/{id}/disposition` endpoint MUST delegate to this service and MUST NOT be removed. Resolving an `AUTO` deviation MUST drive the source measurement status (`ACCEPTED` → `DEVIATION_ACCEPTED`, `REJECTED` → `REJECTED`); resolving a `MANUAL` deviation MUST NOT mutate the source measurement's dimensional status.
(Previously: admin resolved pending measurements directly; no unified service; no AUTO/MANUAL distinction.)

#### Scenario: Administrator accepts or rejects

- GIVEN an administrator and a pending deviation
- WHEN the administrator submits a valid note or reason
- THEN the status changes to the selected disposition and user, time, and text are audited

#### Scenario: Missing disposition text is rejected

- GIVEN a pending deviation
- WHEN the administrator submits an empty or whitespace-only note or reason
- THEN the disposition is rejected and the status remains pending

#### Scenario: Legacy disposition endpoint delegates to the resolution service

- GIVEN an administrator and a pending AUTO deviation
- WHEN the administrator calls `POST /api/measurements/{id}/disposition`
- THEN the request is handled by the same resolution service and the measurement status is updated consistently

#### Scenario: Resolving a manual deviation leaves dimensional status unchanged

- GIVEN a pending MANUAL deviation on a measurement whose status is `IN_TOLERANCE`
- WHEN an administrator resolves it as `ACCEPTED`
- THEN the deviation is audited as resolved and the measurement status remains `IN_TOLERANCE`
