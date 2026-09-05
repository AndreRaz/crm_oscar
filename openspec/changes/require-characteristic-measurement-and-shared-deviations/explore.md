# Exploration: require-characteristic-measurement-and-shared-deviations

## Current State

**Characteristic model** (`backend/app/models.py`, `services/catalog.py`, `services/inspection.py`):
dual tolerance format — `SYMMETRIC` requires `nominal + tol_plus` (min/max derived, never stored);
`LIMITS` requires at least one of `min_limit`/`max_limit` (unilateral allowed) with `nominal` optional.
There is **no `measurement_method`** anywhere. Validation lives in `validate_characteristic()` and the
`ck_characteristic_tolerance` CHECK constraint (ADR-7 defense in depth).

**Measurement snapshots** (`models.py:118`, `services/inspection.py:record_measurement`): store
`nominal_snapshot`, `lower/upper_limit_snapshot` (all nullable), and `deviation = actual − nominal`
(null for pure-LIMITS). No method snapshot. Disposition audit (`disposition_by/at/note`) lives directly
on the measurement row.

**Deviations today are implicit** (`services/disposition.py`, `routers/deviations.py`): out-of-range
measurements become `PENDING`; admin-only `GET /api/deviations` returns a queue grouped by inspection;
admin resolves via `POST /api/measurements/{id}/disposition`. No deviation entity, no description field,
no manual creation, no inspector visibility (frontend `App.tsx:56` gives inspectors only Catálogo +
Inspección tabs).

**Report/stability**: PDF renders from snapshots (`services/report.py`); stability reads
`resolve_limits()` + points — both benefit from always-present nominal but need method added.

**Live data** (`backend/data/app.db`): 2 characteristics (id 1 SYMMETRIC nominal=2.0 no stored limits;
id 2 LIMITS nominal=NULL min=2.0 max=3.0), 5 measurements (id 5 is `PENDING`), 3 inspections.
No migration tooling exists — `db.py:init_db()` is `create_all` only; greenfield assumption
(archived design "Migration / Rollout: none required") is now void.

## Affected Areas

- `backend/app/models.py` — Characteristic NOT NULL columns + `measurement_method`, new CHECK; Measurement +method snapshot; new `deviations` table; constraints rewrite (ADR-7)
- `backend/app/db.py` / new migration module — `create_all` insufficient; SQLite table-rebuild migration needed
- `backend/app/services/catalog.py` — `validate_characteristic()` new four-value rule
- `backend/app/services/inspection.py` — `resolve_limits()`, `record_measurement()` snapshot+evaluate inputs
- `backend/app/services/disposition.py` — split into deviation service (create manual, shared list, resolve with audit)
- `backend/app/routers/{catalog,deviations,inspections}.py` — schemas, authz widening (deviations list: admin → any authenticated), new create/resolve endpoints
- `backend/app/schemas.py` — CharacteristicIn/Out (+method, min/max required), MeasurementOut (+method snapshot), DeviationOut/CreateIn/ResolveIn
- `backend/app/services/report.py` + `templates/report.html.j2` — method in snapshot columns
- `backend/app/services/stability.py` — nominal now always present (simplification, minor)
- `frontend/src/api/client.ts` — type + endpoint changes
- `frontend/src/Catalog.tsx` — method field; SYMMETRIC derived min/max display; LIMITS requires nominal
- `frontend/src/Inspection.tsx` — show method; per-characteristic "report deviation" action with mandatory description
- `frontend/src/Deviations.tsx` — shared read-only list for inspectors; resolution UI admin-only
- `frontend/src/App.tsx` — Desviaciones tab for inspector role
- `backend/tests/*` (12 files) — type/authz changes ripple through catalog, inspection, disposition, report, schema suites
- `openspec/specs/{part-catalog,inspection-execution,deviation-disposition}/spec.md` — MODIFIED/ADDED requirement deltas

## Approaches

### Characteristic measurement model

1. **Canonical storage, keep `tol_type` as input/display hint** — store `nominal`, `min_limit`,
   `max_limit`, `measurement_method` as NOT NULL on every characteristic; server derives min/max for
   SYMMETRIC (`nominal ± tol_plus`), requires explicit values for LIMITS. `tol_type` kept for UX only.
   - Pros: one stored shape simplifies `evaluate()`, snapshots, deviation binding, stability; SYMMETRIC UX
     preserved; SYMMETRIC rows auto-migratable; honors decision 1 literally
   - Cons: LIMITS semantics change (unilateral dies, nominal mandatory); CHECK constraint rewrite; dual input paths remain
   - Effort: **Medium**

2. **Drop `tol_type`, single nominal/min/max/method model** — symmetric input computed client-side.
   - Pros: simplest canonical model; no dual paths
   - Cons: breaking API + bigger Catalog.tsx rewrite; loses nominal±tol authoring UX that matches engineering drawings
   - Effort: **Medium-High**

3. **Service-layer-only enforcement, DB stays nullable** — no migration.
   - Pros: zero schema work
   - Cons: violates ADR-7 defense in depth; historical NULLs persist forever, undermining decision 2; **rejected**

### Deviation entity and shared list

1. **New `deviations` table with `origin` discriminator (AUTO/MANUAL)** — AUTO row materialized when an
   out-of-range measurement is recorded (measurement status engine unchanged); MANUAL rows created from the
   inspection screen on any recorded measurement. One table feeds the shared list; one resolution path
   (`PENDING → ACCEPTED | REJECTED`, admin-only, nonblank text, resolved_by/at). Snapshot copies of
   nominal/min/max/method on the row (decision 4).
   - Pros: single read model for the shared list; manual-on-IN_TOLERANCE fits naturally; self-contained audit;
     existing PENDING measurement (id 5) backfills cleanly
   - Cons: dual-write consistency between `measurement.status` and `deviation.status` must be designed
     (resolution of an AUTO deviation should drive measurement status — single write path)
   - Effort: **Medium-High**

2. **Extend Measurement with description/creator/origin** — deviations stay measurement rows.
   - Pros: no new table
   - Cons: manual deviation on IN_TOLERANCE measurement creates two status sources of truth; disposition audit
     already on the row becomes ambiguous; **rejected**

3. **Keep auto queue measurement-based + separate manual deviations table, union at read** —
   - Pros: zero change to auto path
   - Cons: two resolution paths, two audit shapes, unstable identity for the admin UI; union query complexity; **rejected**

### SQLite migration

1. **Lightweight versioned migration in app startup** (`PRAGMA user_version` + ordered steps, table rebuild
   per SQLite 12-step ALTER) — no new dependencies, matches local single-file deployment.
   - Pros: no Alembic dep; testable against a copy of the old schema; runs where `init_db()` runs today
   - Cons: hand-rolled; must be idempotent and careful with CHECK/FK rebuild
   - Effort: **Medium**

2. **Adopt Alembic** — Pros: standard tooling. Cons: heavy new dependency for one local SQLite file;
   offline authoring overhead; **rejected for this project size**

## Recommendation

- **Characteristic: approach 1** (canonical NOT NULL storage, `tol_type` as input hint). It satisfies
  decision 1 without sacrificing the SYMMETRIC authoring UX and gives deviations/snapshots a uniform shape.
- **Deviation: approach 1** (one `deviations` table, `origin` AUTO/MANUAL, single resolution path).
  Resolution of an AUTO deviation drives `measurement.status` (accept → `DEVIATION_ACCEPTED`,
  reject → `REJECTED`); MANUAL deviations never mutate measurement status — preserving the "distinct but
  same list" semantics of decision 6.
- **Migration: approach 1** (`user_version` runner at startup). Backfill rules: SYMMETRIC min/max derived
  from `nominal ± tol_plus`; LIMITS missing nominal and all missing `measurement_method` are
  **non-derivable** — live row id 2 (LIMITS, nominal NULL) proves this case exists, so the proposal MUST
  lock a policy (recommended: backfill nominal = midpoint of limits and method = explicit placeholder
  marking legacy data, plus admin-visible flag; alternative: fail startup with manual fix instructions).
  Backfill AUTO deviation rows for existing PENDING measurements (id 5) so the shared list is
  historically complete. Historical measurement snapshots stay as-recorded; the four-value snapshot
  rule applies going forward (method snapshot is NULL on legacy rows — fabrication of history is worse).

## Risks

- **Data migration on real rows**: LIMITS characteristic id 2 has NULL nominal — the non-derivable case is
  live, not theoretical; wrong backfill policy corrupts QA history.
- **Breaking API/authz changes**: `GET /api/deviations` opens admin → all roles and changes shape;
  `POST /api/measurements/{id}/disposition` is superseded — spec deltas must mark these MODIFIED/BREAKING
  and frontend must ship in lockstep.
- **Dual-write drift**: if both measurement disposition and deviation resolution paths survive, statuses
  diverge; single write path is mandatory.
- **Open semantics** (must be locked in proposal/spec): does a pending MANUAL deviation on an IN_TOLERANCE
  measurement affect inspection worst-of status (recommended: no — parallel concern); one open deviation per
  measurement or many (recommended: one); does the legacy disposition endpoint get removed or delegate.
- **Review budget**: schema + migration + API + UI + tests will exceed 400 lines — plan chained PRs
  (backend model+migration → backend deviation API → frontend catalog/inspection → frontend shared
  list/report) per delivery strategy ask-on-risk.
- **Report/authz edge**: shared list readable by all authenticated users, but PDF remains admin-any /
  inspector-own — deviation rows must not leak cross-inspector report access.

## Ready for Proposal

**Yes.** Codebase is fully mapped, live migration cases identified, and approaches costed. The proposal
should lock: (a) backfill policy for non-derivable nominal/method on legacy rows, (b) manual-deviation vs
inspection-status interaction, (c) one-open-deviation-per-measurement, (d) replacement vs delegation of
`POST /api/measurements/{id}/disposition`, (e) chained-PR slicing forecast.
