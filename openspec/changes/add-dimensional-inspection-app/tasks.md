# Tasks: Dimensional Inspection & Part Stability System (v1)

Strict TDD: failing tests (RED) → implement (GREEN) → refactor; done = tests green. Backend: `pytest` in `backend/`; frontend: `vitest run` in `frontend/`.

## Review Workload Forecast

|Field|Value|
|---|---|
|Estimated changed lines|4000–6000|
|400-line budget risk|High|
|Chained PRs recommended|Yes|
|Suggested split|PR1→PR8|
|Delivery strategy|ask-on-risk|
|Chain strategy|pending (user picks)|

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

|Unit|Goal|Test|Harness|Rollback|
|---|---|---|---|---|
|PR1|Backend core: models, auth, users|pytest tests/auth_users|uvicorn login flow|app core files|
|PR2|Catalog API|pytest tests/catalog|N/A — API slice|catalog router+service|
|PR3|Inspection execution API|pytest tests/inspection|N/A — needs PR1–2|inspection files|
|PR4|Disposition + annulment API|pytest tests/disposition|N/A|deviation files|
|PR5|PDF report|pytest tests/report|browser PDF download|template+service|
|PR6|Stability API|pytest tests/stability|N/A|stability files|
|PR7|FE shell: login, users, catalog|vitest run|npm run dev|FE shell+pages|
|PR8|FE features: inspect, MRB, report, stability|vitest run|full walkthrough|FE feature pages|

## Planning Resolutions

- Confirmed PRD §9 drops: no `tol_minus` (SYMMETRIC = single ± value; asymmetric ⇒ LIMITS); no `Characteristic.active` (delete removes; snapshots preserve history).
- Stability `deviation` is nullable — null when no nominal snapshot (pure LIMITS); UI renders "—".
- `GET /api/deviations` returns `{groups:[{inspection:{id,part_type_code,serial,inspector,completed_at,status},measurements:[…]}]}`; PENDING only, newest first, annulled excluded.

## Phase 1: Models & Auth (PR1)

- [x] 1.1 `backend/tests/test_rules.py`: `evaluate` (symmetric/limits/unilateral/edges) + `worst_of` matrix → `services/tolerance.py`, `services/status.py`
- [x] 1.2 `app/{main,db,deps}.py`, `models.py`, `schemas.py`: all tables + constraints; schema test
- [x] 1.3 `tests/test_auth.py`: login/logout/me; Argon2; inactive denied; HttpOnly cookie; env admin seed → `routers/auth.py`, `services/auth.py`
- [x] 1.4 `tests/test_users.py`: create/deactivate/reset; dup username 409; deactivated session invalid; inspector 403 → `routers/users.py`

## Phase 2: Catalog (PR2)

- [ ] 2.1 `tests/test_catalog.py`: part-type create/patch/deactivate (inactive blocked for new inspections); image validation → `routers/catalog.py`, `services/catalog.py`
- [ ] 2.2 characteristics: dual-format checks, unique code, edit, delete
- [ ] 2.3 balloons: unique number per type, one per characteristic, x/y 0..1; inspector mutations 403

## Phase 3: Inspection Execution (PR3)

- [ ] 3.1 `tests/test_inspection.py`: start — Piece auto-create, dup serial 409, cross-type serial OK, inactive type rejected → `routers/inspections.py`, `services/inspection.py`
- [ ] 3.2 record: resolved-limit snapshot + evaluate + deviation; dup characteristic 409 (A3); non-numeric 422
- [ ] 3.3 complete: worst-of persisted; locked against later edits

## Phase 4: Disposition (PR4)

- [ ] 4.1 `tests/test_disposition.py`: grouped queue (shape above); inspector disposition 403 → `routers/deviations.py`, `services/disposition.py`
- [ ] 4.2 accept/reject: blank text 422 stays PENDING; audit by/at/note; status recomputed
- [ ] 4.3 annul: admin-only, blank reason 422, audit retained; completed records immutable

## Phase 5: Report (PR5)

- [ ] 5.1 `tests/test_report.py`: HTML shows identity, characteristic table, notes, overall status; conforming omits disposition text → `services/report.py`, `templates/report.html.j2`
- [ ] 5.2 authz admin-any/inspector-own/other-403; reflects latest disposition; `%PDF` smoke test → `routers/reports.py`

## Phase 6: Stability (PR6)

- [ ] 6.1 `tests/test_stability.py`: contract shape, chronological points, nullable deviation, empty state → `routers/stability.py`, `services/stability.py`
- [ ] 6.2 admin-only 403; type/characteristic mismatch 422; asymmetric limits distinct; annulled excluded

## Phase 7: Frontend Shell (PR7)

- [ ] 7.1 Vite scaffold + `src/api/client.js` (cookie credentials) + Login + role tabs, Spanish copy; RTL mocks client
- [ ] 7.2 Users page (admin) + read-only catalog (inspector); RTL

## Phase 8: Frontend Features (PR8)

- [ ] 8.1 Admin catalog forms + BalloonEditor; RTL tests
- [ ] 8.2 3-pane inspection (balloon/nominal/actual): server statuses only, invalid-input feedback; RTL
- [ ] 8.3 Deviations queue + disposition/annul forms (mandatory text) + report download authz; RTL
- [ ] 8.4 Stability: Recharts trend + nominal/limit ReferenceLines from contract, empty state; RTL

## Phase 9: Integration & Wrap-up

- [ ] 9.1 Backend e2e flow test: login → catalog → inspect → complete → dispose → report → stability
- [ ] 9.2 README: WeasyPrint system deps, run commands; remove scaffold leftovers
