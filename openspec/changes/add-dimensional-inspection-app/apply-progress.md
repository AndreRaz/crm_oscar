# Apply Progress — add-dimensional-inspection-app

Mode: Strict TDD. Chain: stacked-to-main. Branches: `feat/backend-core` (PR1, merged), `feat/part-catalog` (PR2, merged), `feat/inspection-execution` (PR3, off updated main).

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
- [ ] Phase 4 (PR4) … Phase 9 pending

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

## Work Unit Evidence

| Unit | Focused test command | Result | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| PR1 | `pytest` in `backend/` | 36 passed | uvicorn login flow 200→200→200→401 | revert `feat/backend-core` commits |
| PR2 | `pytest` in `backend/` | **62 passed** (36 prior + 26 catalog) | N/A — API slice (per work-unit table); behavior fully covered by TestClient integration tests incl. multipart upload + FileResponse round-trip | revert `feat/part-catalog` commits: all changes in `backend/` (+ tasks/progress doc lines) |
| PR3 | `pytest` in `backend/` | **79 passed** (62 prior + 17 inspection) | N/A — API slice (per work-unit table); TestClient integration covers start→record→complete lifecycle incl. snapshot immutability across characteristic edits | revert `feat/inspection-execution` commits: all changes in `backend/` (+ tasks/progress doc lines) |

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

## ⚠️ Budget breach (needs orchestrator decision)

PR3 code diff `main..HEAD` = **444 insertions + 1 deletion = 445 changed lines** vs hard budget 400 (+45). Same structural cause as PR1/PR2: strict TDD with tests committed alongside behavior (238 test lines of the 445). No tests trimmed. Clean split, both halves independently green and under budget:
- **PR3a** = commit `40c0448` (start + measurement capture, tasks 3.1–3.2) = **376 lines**, verified 75/75 pytest green at that commit.
- **PR3b** = commit `6c7df5a` (completion lock, task 3.3) = **69 lines**, stacked on PR3a; 79/79 green.
Alternatives: maintainer `size:exception` (overage is only 45 lines).

## Deviations from design

- PR1: enums in `services/status.py`; deps/main/schemas landed with auth commit (self-consistent commits).
- PR2: spec text mentions part-type `name`/`description`, but design Data Model (binding, already merged in PR1 schema) defines PartType as code/image_path/active only — followed design. Flagged for spec/specs alignment at archive time.
- PR2: `PartType.name/description` absent; `PATCH /api/part-types/{id}` accepts `active` only (matches merged model).
- PR2: Image stored as `{part_type_id}{.png|.jpg}` under images dir (one image per part type, overwrite on re-upload); DB stores the file name. `IMAGES_DIR` env override for tests, default `backend/data/images/` per design ADR.
- PR2: Balloon PATCH not implemented (design lists `.../balloons`, `/api/balloons/{id}`; only DELETE needed by spec scenarios — re-placement = delete + create, both covered by tests).
- PR3: characteristic selection is validated at start (belongs to part type, no dups) and echoed in the start response, but NOT persisted as a separate table (merged PR1 schema has none per design Data Model). `GET` derives `characteristic_ids` from recorded measurements; recording any characteristic of the inspected part type is allowed (unselected = simply not measured, per spec skip rule). Flagged for archive-time review.
- PR3: status codes not pinned by spec: inactive part type → 409 (state conflict), foreign characteristic → 422, locked-inspection edits → 409, duplicate serial → 409 (matches PR2 duplicate precedent).

## Next steps

- Orchestrator: resolve PR3 budget breach (split PR3a/PR3b at commit boundary vs size:exception), then delivery.
- PR4: Disposition + annulment API (Phase 4, tasks 4.1–4.3).
