# Apply Progress — add-dimensional-inspection-app

Mode: Strict TDD for implementation and integration behavior. Chain: stacked-to-main. Branches: PR1–PR8d merged; PR9 is `feat/integration-docs` off updated main.

## Tasks (cumulative)

- [x] 1.1 tolerance rules (`evaluate`, `worst_of`) → `services/tolerance.py`, `services/status.py`
- [x] 1.2 schema: all tables + constraints → `models.py`, `db.py`; schema test
- [x] 1.3 auth: login/logout/me, Argon2id, HttpOnly cookie, env admin seed → `routers/auth.py`, `services/auth.py`, `deps.py`, `main.py`, `schemas.py`
- [x] 1.4 users: create/deactivate/reset, 409 dup, session invalidation, inspector 403 → `routers/users.py`
- [x] 2.1 part types: create/patch/deactivate + image upload/validation → `routers/catalog.py`, `services/catalog.py`
- [x] 2.2 characteristics: dual-format checks (SYMMETRIC/LIMITS incl. unilateral), unique code 409, edit, hard delete → `services/catalog.validate_characteristic`
- [x] 2.3 balloons: unique number per type 409, one per characteristic 409, x/y 0..1 (422), delete frees number+link; inspector read-only (GET 200, mutations 403)
- [x] 3.1 inspection start: Piece auto-create on start, dup serial 409, cross-type serial OK, inactive type 409, foreign characteristic 422, 401/404 → `routers/inspections.py`, `services/inspection.py`
- [x] 3.2 record: resolved-limit snapshot (SYMMETRIC→nominal±tol; LIMITS→min/max, unilateral null bound) + server-side evaluate + deviation, dup characteristic 409 (A3), non-numeric 422, snapshot survives characteristic edit
- [x] 3.3 complete: worst-of persisted (CONFORMING/PENDING covered; REJECTED/ACCEPTED_WITH_DEVIATIONS derive via PR4 disposition), completed_at set, locked against later edits (record 409, re-complete 409)
- [x] 4.1 grouped pending-deviation queue: admin-only, newest-first, conforming/annulled excluded → `routers/deviations.py`, `services/disposition.py`
- [x] 4.2 accept/reject: mandatory text, immutable audit, worst-of inspection status recompute
- [x] 4.3 annulment: completed/admin-only, mandatory reason, immutable audit/measurements; annulled records excluded from queue
- [x] 5.1 current-state Jinja HTML: part image/identity, inspector/time, snapshot measurement table, dispositions, overall status → `services/report.py`, `templates/report.html.j2`
- [x] 5.2 authorized on-demand WeasyPrint PDF: admin-any, inspector-own, other 403; no stored report → `routers/reports.py`
- [x] 6.1 chronological stability contract with current reference lines, nullable deviation, and empty state → `routers/stability.py`, `services/stability.py`
- [x] 6.2 admin-only scoping, cross-type 422, asymmetric limits, and annulled exclusion
- [x] 7.1 Vite + TypeScript scaffold, credentialed API client, session login/logout/me, Spanish role tabs and states
- [x] 7.2 admin user management and inspector read-only catalog with characteristic details
- [x] 8.1 admin catalog forms, image upload, dual-format characteristics, normalized linked balloons, and inspector read-only view
- [x] 8.2 inspector workspace: active part/serial/characteristic selection, 3-pane guided capture, active balloon, server measurement/final statuses, numeric feedback, and navigation
- [x] 8.3 admin deviation queue grouped by inspection, mandatory disposition/annulment text, server status refresh, and authorized PDF downloads for admins and owning inspectors
- [x] 8.4 admin-only scoped stability selection, chronological table, nullable deviation display, and Recharts trend with server reference lines
- [x] 9.1 full TestClient lifecycle: login, catalog, characteristic/balloon, inspection, completion lock, disposition, PDF report, and stability; role and snapshot immutability contracts included
- [x] 9.2 root README: prerequisites, Python/Node setup, Pango/Cairo dependencies, local SQLite run, initial admin variables, test/build commands, deployment boundary, and backup/restore notes; no tracked scaffold leftovers were safe or necessary to remove

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `tests/test_rules.py` | Unit | N/A (new) | ✅ ModuleNotFoundError | ✅ 13 passed | ✅ symmetric/limits/unilateral/edges + worst_of matrix | ➖ None needed |
| 1.2 | `tests/test_schema.py` | Unit (SQLite DDL) | ✅ 13/13 rules green | ✅ ModuleNotFoundError | ✅ 9 passed | ✅ 6 constraint groups | ✅ relationship added, suite green |
| 1.3 | `tests/test_auth.py` | Integration | ✅ 22/22 prior green | ✅ ModuleNotFoundError | ✅ 7 passed | ✅ invalid/inactive/unknown/cookie flags/seed | ✅ StaticPool fixture fix |
| 1.4 | `tests/test_users.py` | Integration | ✅ 29/29 prior green | ✅ router missing (6 fail) | ✅ 7 passed | ✅ 409/401/403/invalidation/reset | ➖ None needed |
| 2.1 | `tests/test_catalog.py` (TestPartTypes/Image/Access) | Integration | ✅ 36/36 prior green | ✅ router missing (7 fail) | ✅ 8 passed | ✅ dup 409 / deactivate / 404 / bad image type / 403 / 401 | ➖ None needed (matches users.py pattern) |
| 2.2 | `tests/test_catalog.py` (TestCharacteristics) | Integration | ✅ 44/44 prior green | ✅ endpoints missing (10 fail) | ✅ 10 passed | ✅ symmetric + limits/unilateral / 3 invalid combos / 409 dup / edit / edit-invalid 422 / delete 404 | ➖ None needed |
| 2.3 | `tests/test_catalog.py` (TestBalloons) | Integration | ✅ 54/54 prior green | ✅ endpoints missing (7 fail) | ✅ 8 passed | ✅ dup number 409 / cross-type same number OK / one-per-characteristic 409 / x,y bounds 422 / delete frees / 404 / inspector 403 | ➖ None needed |
| 3.1 | `tests/test_inspection.py` (TestStart) | Integration | ✅ 62/62 prior green | ✅ routes missing (6 fail) | ✅ 6 passed | ✅ valid start / dup serial 409 / cross-type serial OK / inactive type 409 / foreign char 422 / 401+404 | ➖ None needed |
| 3.2 | `tests/test_inspection.py` (TestRecord) | Integration | ✅ 68/68 prior green | ✅ endpoint missing (7 fail) | ✅ 7 passed | ✅ in-range snapshot+deviation / out-of-range PENDING / LIMITS unilateral bounds / dup 409 / non-numeric 422 / snapshot survives edit / 401+404 | ✅ GET measurements population bug caught by RED; router helper extraction, suite green |
| 3.3 | `tests/test_inspection.py` (TestComplete) | Integration | ✅ 75/75 prior green | ✅ endpoint missing (4 fail) | ✅ 4 passed | ✅ all-in-tolerance CONFORMING / worst-of PENDING / lock (record 409, re-complete 409) / 401+404 | ✅ get_inspection_or_404 extraction, suite green |
| 4.1 | `tests/test_disposition.py` (TestQueue) | Integration | ✅ 79/79 prior green | ✅ queue route absent | ✅ 4 passed | ✅ grouped/non-empty + conforming empty / newest-first / admin 403 + anonymous 401 | ➖ None needed |
| 4.2 | `tests/test_disposition.py` (TestDisposition) | Integration | ✅ 4/4 queue tests green | ✅ disposition route absent | ✅ 11 passed | ✅ accept/reject/blank/worst-of/403/immutable/invalid+404+401 | ✅ shared status recompute retained for annulment |
| 4.3 | `tests/test_disposition.py` (TestAnnulment) | Integration | ✅ 11/11 disposition tests green | ✅ 3 failed (404; route absent) | ✅ 3 passed | ✅ success + blank / role+completion+404 / repeat audit immutability + direct disposition lock | ✅ `_recompute_status` extracted; 14/14 green |
| 5.1 | `tests/test_report.py` (HTML) | Integration | ✅ 93/93 prior green | ✅ 2 failed (`ModuleNotFoundError`) | ✅ 2 passed | ✅ disposed + conforming paths; complete evidence and no-disposition branch | ✅ incomplete report timestamp fallback; 2/2 green |
| 5.2 | `tests/test_report.py` (HTTP/PDF) | Integration | ✅ 2/2 report HTML green | ✅ route 404 (1 failed, 3 passed, 1 skipped) | ✅ 5 passed | ✅ admin/owner/other; before/after disposition; `%PDF` bytes | ✅ authorization extracted to `may_download_report`; 5/5 green |
| 6.1 | `tests/test_stability.py` (TestStabilityContract) | Integration | ✅ 98/98 prior green | ✅ route absent (3 failed) | ✅ 3 passed | ✅ chronological non-empty / pure LIMITS null deviation / empty state | ➖ None needed |
| 6.2 | `tests/test_stability.py` (TestStabilityGuards) | Integration | ✅ 3/3 contract tests green | ✅ 3 failed, 1 passed (403 / mismatch / annulled) | ✅ 4 passed | ✅ role / cross-type / asymmetric references / annulled exclusion | ➖ None needed |
| 7.1 | `src/api/client.test.ts`, `src/App.test.tsx` | Unit + RTL integration | N/A (new) | ✅ 2 suites failed: missing `client`/`App` | ✅ 5 passed | ✅ success/error + admin/inspector/session paths | ✅ RTL cleanup added; 5/5 green |
| 7.2 | `src/App.test.tsx` | RTL integration | N/A (new) | ✅ missing `App` | ✅ 3 component flows passed | ✅ create/deactivate/reset + read-only non-empty catalog | ✅ accessible action labels; 3/3 green |
| 8.1 | `src/App.test.tsx`, `src/api/client.test.ts` | RTL integration + unit | ✅ 5/5 prior green | ✅ 3 failed, 4 passed (catalog APIs/forms/balloons absent) | ✅ 7 passed | ✅ symmetric + unilateral LIMITS, multipart upload, normalized balloon, inspector read-only | ✅ keyed tolerance fields prevent stale values across format changes; 7/7 green |
| 8.2 | `src/Inspection.test.tsx`, `src/api/client.test.ts` | RTL integration + unit | ✅ 7/7 prior green | ✅ 2 suites failed (missing `Inspection` and inspection client) | ✅ 6 focused passed | ✅ IN_TOLERANCE/PENDING, two tolerance formats, navigation, invalid input, server-derived completion | ✅ focused 6/6 and full 10/10 green |
| 8.3 | `src/Deviations.test.tsx`, `src/Inspection.test.tsx`, `src/App.test.tsx`, `src/api/client.test.ts` | RTL integration + unit | ✅ 10/10 prior green | ✅ 3 files failed: missing queue/client/report behavior | ✅ 10 focused passed | ✅ accept/reject, blank text, annulment, admin/inspector access, PDF response, server status refresh | ✅ shared report downloader; focused/full 14/14 and build green |
| 8.4 | `src/Stability.test.tsx`, `src/App.test.tsx`, `src/api/client.test.ts` | RTL integration + unit | ✅ 9/9 prior green | ✅ 3 files failed: missing stability component/client/wiring | ✅ 13 focused passed | ✅ chronological/non-empty, nullable deviation, empty, catalog/API error paths | ✅ loading and error states made mutually exclusive; 13/13 focused green |
| 9.1 | `tests/test_lifecycle.py` | TestClient integration | ✅ 105/105 prior green | ✅ target absent: pytest exit 4 | ✅ 1 focused passed | ✅ happy lifecycle plus inspector/admin/other-inspector authorization and completed/snapshot immutability branches | ➖ Test-only work unit; no production refactor needed |

Task 9.2 is documentation-only and was explicitly outside the task 9.1 Strict TDD scope; commands were validated through the PR9 work-unit evidence below.

## Work Unit Evidence

| Unit | Focused test command | Result | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| PR1 | `pytest` in `backend/` | 36 passed | uvicorn login flow 200→200→200→401 | revert `feat/backend-core` commits |
| PR2 | `pytest` in `backend/` | **62 passed** (36 prior + 26 catalog) | N/A — API slice (per work-unit table); behavior fully covered by TestClient integration tests incl. multipart upload + FileResponse round-trip | revert `feat/part-catalog` commits: all changes in `backend/` (+ tasks/progress doc lines) |
| PR3 | `pytest` in `backend/` | **79 passed** (62 prior + 17 inspection) | N/A — API slice (per work-unit table); TestClient integration covers start→record→complete lifecycle incl. snapshot immutability across characteristic edits | revert `feat/inspection-execution` commits: all changes in `backend/` (+ tasks/progress doc lines) |
| PR4 | `.venv/bin/python -m pytest tests/test_disposition.py` in `backend/` | **14 passed** (11 prior + 3 annulment) | `.venv/bin/python -m pytest tests/test_disposition.py::TestAnnulment::test_admin_annuls_with_audit_and_record_becomes_terminal` → **1 passed**; TestClient executes the FastAPI+SQLite HTTP lifecycle | revert PR4 commits `8c62f1d`, `aac9d1d`, `e0c8384` plus the PR4 progress-doc commit |
| PR5 | `.venv/bin/python -m pytest tests/test_report.py` in `backend/` | **5 passed**; full backend **98 passed** | `.venv/bin/python -m pytest tests/test_report.py::test_report_download_returns_pdf_bytes_when_weasyprint_is_available` → **1 passed**; TestClient runs auth→SQLite→Jinja→WeasyPrint and verifies `%PDF` | revert PR5 commits `6d09fb5`, `ce176be` plus this progress-doc commit; removes report service/template/router/tests and dependency additions only |
| PR6 | `.venv/bin/python -m pytest tests/test_stability.py` in `backend/` | **7 passed**; full backend **105 passed** | `.venv/bin/python -m pytest tests/test_stability.py::TestStabilityContract::test_returns_reference_lines_and_chronological_measurement_points` → **1 passed**; TestClient runs auth→inspection lifecycle→SQLite query→JSON contract | revert PR6 commits `a35d996`, `b12fba5` plus this progress-doc commit; removes stability router/service/tests and app wiring only |
| PR7 | `npm run test -- --run` in `frontend/` | **5 passed** across 2 files | `npm run dev -- --host 127.0.0.1`; Vite ready in 143 ms and `GET /` returned 530 bytes | revert `e9f02db` plus the PR7 progress-doc commit; removes `frontend/` and its three root ignore entries only |
| PR8a | `npm run test -- --run src/App.test.tsx src/api/client.test.ts` in `frontend/` | **7 passed** across 2 files; `npm run build` passed | `npm run dev -- --host 127.0.0.1`; `GET /` returned **200** and 332 bytes | revert `2d95e28` plus the PR8a progress-doc commit; removes catalog management UI/client methods/tests/styles only |
| PR8b | `npm run test -- --run src/Inspection.test.tsx src/api/client.test.ts` in `frontend/` | **6 passed** across 2 files; full frontend **10 passed**; `npm run build` passed | `npm run dev -- --host 127.0.0.1`; `GET /` returned **200** and 348 bytes | revert `20d9791` plus the PR8b progress-doc commit; removes inspection workspace/client methods/tests/styles only |
| PR8c | `npm run test -- --run src/Deviations.test.tsx src/Inspection.test.tsx src/App.test.tsx src/api/client.test.ts` in `frontend/` | **14 passed** across 4 files; `npm run build` passed | `npm run dev -- --host 127.0.0.1 --port 4175`; `GET /` returned **200** and 530 bytes; RTL covers queue→dispose/annul→refresh/download | revert `0e68011` plus the PR8c progress-doc commit; removes deviation workspace, shared report downloader, API methods, tests, and styles only |
| PR8d | `npm run test -- --run src/Stability.test.tsx src/App.test.tsx src/api/client.test.ts` in `frontend/` | **13 passed** across 3 files; full frontend **18 passed**; `npm run build` passed | `npm run dev -- --host 127.0.0.1 --port 4176`; `GET /` returned **200** and 530 bytes; RTL covers scoped selection→contract→chart/table plus empty/error states | revert `723997c` plus the PR8d progress-doc commit; removes stability view, typed API contract, App wiring, tests, and styles only |
| PR9 | `.venv/bin/python -m pytest tests/test_lifecycle.py` in `backend/` | **1 passed** focused; backend **106 passed**; frontend **18 passed**; frontend build passed | bounded uvicorn + Vite proxy smoke with temporary SQLite: login **200**, `/api/auth/me` **200**, frontend **200** and 530 bytes | revert `backend/tests/test_lifecycle.py`, `README.md`, and the two Phase 9 checkbox/evidence updates; no production behavior removed |

## Commits

PR1 (`feat/backend-core`, merged to main as #2/#3):
- `547a332 chore(backend): scaffold python environment and test runner`
- `3e9d3d8 feat(backend): add tolerance evaluation and worst-of status rules`
- `f374479 feat(backend): add database schema with integrity constraints`
- `62e08be feat(backend): add session auth with Argon2 credentials`
- `eeec407 feat(backend): add admin user management`
- `d0e662b docs(backend): record PR1 apply progress`

PR2 (`feat/part-catalog`, merged to main as #5/#6):
- `53aca63 feat(backend): add part type catalog management with image upload` (205 lines)
- `a1dbe1c feat(backend): add dual-format characteristics management`
- `e38c88c feat(backend): add balloon placement linked to characteristics`
- `af62445 docs(backend): record PR2 apply progress`

PR3 (`feat/inspection-execution`, off main):
- `40c0448 feat(backend): add inspection start and guided measurement capture` (376 changed lines)
- `6c7df5a feat(backend): add inspection completion with worst-of status lock` (69 changed lines)
- docs commit: `docs(backend): record PR3 apply progress`

PR4 (`feat/deviation-disposition`, off updated main):
- `8c62f1d feat(backend): add grouped pending deviation queue for administrators`
- `aac9d1d feat(backend): add audited deviation disposition with worst-of status recompute`
- `e0c8384 feat(backend): add audited inspection annulment`
- docs commit: `docs(backend): record PR4 apply progress`

PR5 (`feat/inspection-report`, off updated main):
- `6d09fb5 feat(backend): render current inspection report HTML`
- `ce176be feat(backend): add authorized PDF report downloads`
- docs commit: `docs(backend): record PR5 apply progress`

PR6 (`feat/stability-analysis`, off updated main):
- `a35d996 feat(backend): add chronological stability analysis`
- `b12fba5 feat(backend): enforce scoped stability access`
- docs commit: `docs(backend): record PR6 apply progress`

PR7 (`feat/frontend-shell`, off updated main):
- `e9f02db feat(frontend): add authenticated role-based shell`
- docs commit: `docs(frontend): record PR7 apply progress`

PR8a (`feat/frontend-catalog`, off updated main):
- `2d95e28 feat(frontend): add catalog management and balloon editor`
- docs commit: `docs(frontend): record task 8.1 apply progress`

PR8b (`feat/frontend-inspection`, off updated main):
- `20d9791 feat(frontend): add guided inspection workspace`
- docs commit: `docs(frontend): record task 8.2 apply progress`

PR8c (`feat/frontend-deviations`, off updated main):
- `0e68011 feat(frontend): add deviation disposition workspace`
- docs commit: `docs(frontend): record task 8.3 apply progress`

PR8d (`feat/frontend-stability`, off updated main):
- `723997c feat(frontend): add stability trend analysis`
- docs commit: `docs(frontend): record task 8.4 apply progress`

PR9 (`feat/integration-docs`, off updated main):
- `test(backend): cover complete inspection lifecycle`
- `docs: add local setup and operations guide`
- docs commit: `docs: complete dimensional inspection apply progress`

## ⚠️ Budget breach (needs orchestrator decision)

PR3 code diff `main..HEAD` = **444 insertions + 1 deletion = 445 changed lines** vs hard budget 400 (+45). Same structural cause as PR1/PR2: strict TDD with tests committed alongside behavior (238 test lines of the 445). No tests trimmed. Clean split, both halves independently green and under budget:
- **PR3a** = commit `40c0448` (start + measurement capture, tasks 3.1–3.2) = **376 lines**, verified 75/75 pytest green at that commit.
- **PR3b** = commit `6c7df5a` (completion lock, task 3.3) = **69 lines**, stacked on PR3a; 79/79 green.
Alternatives: maintainer `size:exception` (overage is only 45 lines).

## ⚠️ PR4 review-budget split

PR4 exceeds the 400-line review budget once cumulative progress documentation is included. Clean stacked split:
- **PR4a** = `8c62f1d` + `aac9d1d` (tasks 4.1–4.2: queue and disposition).
- **PR4b** = `e0c8384` + the PR4 progress-doc commit (task 4.3: terminal audited annulment), stacked on PR4a.

Both slices retain their tests and stay independently reviewable; final `main..HEAD` counts are recorded in the apply result.

## Deviations from design

- PR1: enums in `services/status.py`; deps/main/schemas landed with auth commit (self-consistent commits).
- PR2: spec text mentions part-type `name`/`description`, but design Data Model (binding, already merged in PR1 schema) defines PartType as code/image_path/active only — followed design. Flagged for spec/specs alignment at archive time.
- PR2: `PartType.name/description` absent; `PATCH /api/part-types/{id}` accepts `active` only (matches merged model).
- PR2: Image stored as `{part_type_id}{.png|.jpg}` under images dir (one image per part type, overwrite on re-upload); DB stores the file name. `IMAGES_DIR` env override for tests, default `backend/data/images/` per design ADR.
- PR2: Balloon PATCH not implemented (design lists `.../balloons`, `/api/balloons/{id}`; only DELETE needed by spec scenarios — re-placement = delete + create, both covered by tests).
- PR3: characteristic selection is validated at start (belongs to part type, no dups) and echoed in the start response, but NOT persisted as a separate table (merged PR1 schema has none per design Data Model). `GET` derives `characteristic_ids` from recorded measurements; recording any characteristic of the inspected part type is allowed (unselected = simply not measured, per spec skip rule). Flagged for archive-time review.
- PR3: status codes not pinned by spec: inactive part type → 409 (state conflict), foreign characteristic → 422, locked-inspection edits → 409, duplicate serial → 409 (matches PR2 duplicate precedent).
- PR7: the typed client is `src/api/client.ts` rather than the planned `.js`; Recharts is installed but intentionally unused until Phase 8.

## PR7 review budget

- Authored implementation: **268 lines**. Generated `package-lock.json`: **3,093 lines**. Implementation total: **3,361 lines**.
- The lockfile is committed for reproducibility and reported separately; generated-file handling is required for native review tooling rather than deleting it.

## Next steps

- All 25 tasks are complete; run `sdd-verify`, then archive the change after verification succeeds.
