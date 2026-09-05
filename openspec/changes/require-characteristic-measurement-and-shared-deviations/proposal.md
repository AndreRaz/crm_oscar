# Proposal: Require Characteristic Measurement Definition and Shared Deviations

## Intent

Require complete measurement definitions and unify automatic/manual deviations in one auditable workflow.

## Scope

### In Scope
- Require finite stored `nominal`, `min_limit`, `max_limit` and nonblank free-text `measurement_method`, satisfying `min <= nominal <= max`; keep `tol_type` as a UX hint.
- Snapshot all four values on new measurements; never fabricate historical snapshots.
- Persist `AUTO|MANUAL` deviations together, expose one authenticated-user list, and restrict resolution to admins.
- Create one open MANUAL deviation per measurement only from inspection context, for any status, with a mandatory description; never alter dimensional status.
- Use ordered `PRAGMA user_version` migration and chained PRs below 400 authored lines.

### Out of Scope
- Instrument catalogs, gauge integration, repeated measurements, or status-rule changes.
- Midpoint, placeholder, or nullable-contract legacy fallbacks.
- PDF authorization changes: admin-any/owner-inspector remains.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `part-catalog`: canonical fields, invariant, and guarded legacy activation.
- `inspection-execution`: four-field snapshots and measurement-bound MANUAL creation.
- `deviation-disposition`: unified persistence, visibility, uniqueness, resolution, audit, and status effects.
- `inspection-report`: snapshotted method evidence; authorization unchanged.

## Approach

Enforce invariants in API validation and SQLite constraints. The migration preflights legacy rows, derives only valid values, and blocks activation with row-level diagnostics for non-derivable nominal/method data; an admin must correct rows before retry. Materialize AUTO deviations for out-of-range measurements. Route new and legacy resolution endpoints through one transactional service. Preserve historical snapshots.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `backend/app/{models,schemas,db.py}` | Modified | Schema and migration guard |
| `backend/app/{services,routers}/` | Modified | Rules and endpoints |
| `frontend/src/` | Modified | Catalog, inspection, shared list |
| `backend/tests/`, `frontend/src/**/*.test.*` | Modified | Regression coverage |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Legacy rows block activation | High | Preflight, diagnostics, backup, admin correction |
| AUTO status drift | Med | One service; legacy endpoint delegates |
| Shared list leaks report access | Med | Independent list/PDF authorization tests |
| Delivery exceeds budget | High | Verified chained PRs under 400 authored lines |

## Rollback Plan

Back up SQLite first. Guard failures leave schema/version unchanged. After activation failure, stop the app and restore backup plus prior code; revert later slices independently.

## Dependencies

- None.

## Success Criteria

- [ ] Invalid characteristics cannot activate or save.
- [ ] New records keep snapshots; legacy history remains unchanged.
- [ ] Authenticated users share one list; only admins resolve; MANUAL leaves dimensional status unchanged.
- [ ] Migration and endpoint tests prove guarded, idempotent behavior.

## Proposal Question Round

Auto mode: binding decisions leave no assumptions awaiting review.
