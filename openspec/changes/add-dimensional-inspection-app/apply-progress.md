# Apply Progress — add-dimensional-inspection-app

Mode: Strict TDD. Chain: stacked-to-main. Branches: `feat/backend-core` (PR1, merged), `feat/part-catalog` (PR2, off updated main).

## Tasks (cumulative)

- [x] 1.1 tolerance rules (`evaluate`, `worst_of`) → `services/tolerance.py`, `services/status.py`
- [x] 1.2 schema: all tables + constraints → `models.py`, `db.py`; schema test
- [x] 1.3 auth: login/logout/me, Argon2id, HttpOnly cookie, env admin seed → `routers/auth.py`, `services/auth.py`, `deps.py`, `main.py`, `schemas.py`
- [x] 1.4 users: create/deactivate/reset, 409 dup, session invalidation, inspector 403 → `routers/users.py`
- [x] 2.1 part types: create/patch/deactivate + image upload/validation → `routers/catalog.py`, `services/catalog.py`
- [x] 2.2 characteristics: dual-format checks (SYMMETRIC/LIMITS incl. unilateral), unique code 409, edit, hard delete → `services/catalog.validate_characteristic`
- [x] 2.3 balloons: unique number per type 409, one per characteristic 409, x/y 0..1 (422), delete frees number+link; inspector read-only (GET 200, mutations 403)
- [ ] Phase 3 (PR3) … Phase 9 pending

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

## Work Unit Evidence

| Unit | Focused test command | Result | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| PR1 | `pytest` in `backend/` | 36 passed | uvicorn login flow 200→200→200→401 | revert `feat/backend-core` commits |
| PR2 | `pytest` in `backend/` | **62 passed** (36 prior + 26 catalog) | N/A — API slice (per work-unit table); behavior fully covered by TestClient integration tests incl. multipart upload + FileResponse round-trip | revert `feat/part-catalog` commits: all changes in `backend/` (+ tasks/progress doc lines) |

## Commits

PR1 (`feat/backend-core`, merged to main as #2/#3):
- `547a332 chore(backend): scaffold python environment and test runner`
- `3e9d3d8 feat(backend): add tolerance evaluation and worst-of status rules`
- `f374479 feat(backend): add database schema with integrity constraints`
- `62e08be feat(backend): add session auth with Argon2 credentials`
- `eeec407 feat(backend): add admin user management`
- `d0e662b docs(backend): record PR1 apply progress`

PR2 (`feat/part-catalog`, off main):
- `53aca63 feat(backend): add part type catalog management with image upload` (205 lines)
- `a1dbe1c feat(backend): add dual-format characteristics management`
- `e38c88c feat(backend): add balloon placement linked to characteristics`
- docs commit: `docs(backend): record PR2 apply progress`

## ⚠️ Budget breach (needs orchestrator decision)

`git diff --stat main..HEAD` (code, pre-docs) = **549 insertions + 2 deletions = 551 changed lines** vs hard budget 400. Same structural cause as PR1: strict TDD with tests committed alongside behavior. Commits are cleanly splittable without rework: PR2a = commit `53aca63` (205 lines, part types + image), PR2b = `a1dbe1c`+`e38c88c` (346 lines, characteristics + balloons) — both under 400. Alternatives: maintainer `size:exception`. No tests were trimmed.

## Deviations from design

- PR1: enums in `services/status.py`; deps/main/schemas landed with auth commit (self-consistent commits).
- PR2: spec text mentions part-type `name`/`description`, but design Data Model (binding, already merged in PR1 schema) defines PartType as code/image_path/active only — followed design. Flagged for spec/specs alignment at archive time.
- PR2: `PartType.name/description` absent; `PATCH /api/part-types/{id}` accepts `active` only (matches merged model).
- Image stored as `{part_type_id}{.png|.jpg}` under images dir (one image per part type, overwrite on re-upload); DB stores the file name. `IMAGES_DIR` env override for tests, default `backend/data/images/` per design ADR.
- Balloon PATCH not implemented (design lists `.../balloons`, `/api/balloons/{id}`; only DELETE needed by spec scenarios — re-placement = delete + create, both covered by tests).

## Next steps

- Orchestrator: resolve PR2 budget breach (split PR2a/PR2b vs size:exception), then delivery.
- PR3: Inspection execution API (Phase 3, tasks 3.1–3.3).
