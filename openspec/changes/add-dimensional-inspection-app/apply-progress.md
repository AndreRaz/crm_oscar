# Apply Progress — add-dimensional-inspection-app

Branch: `feat/backend-core` (stacked-to-main, PR1 of 8). Mode: Strict TDD. First batch (no prior progress).

## Tasks

- [x] 1.1 tolerance rules (`evaluate`, `worst_of`) → `services/tolerance.py`, `services/status.py`
- [x] 1.2 schema: all tables + constraints → `models.py`, `db.py`; schema test
- [x] 1.3 auth: login/logout/me, Argon2id, HttpOnly cookie, env admin seed → `routers/auth.py`, `services/auth.py`, `deps.py`, `main.py`, `schemas.py`
- [x] 1.4 users: create/deactivate/reset, 409 dup, session invalidation, inspector 403 → `routers/users.py`
- [ ] Phase 2 (PR2) … Phase 9 pending

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `tests/test_rules.py` | Unit | N/A (new) | ✅ ModuleNotFoundError | ✅ 13 passed | ✅ symmetric/limits/unilateral/edges + worst_of matrix | ➖ None needed |
| 1.2 | `tests/test_schema.py` | Unit (SQLite DDL) | ✅ 13/13 rules green | ✅ ModuleNotFoundError | ✅ 9 passed | ✅ 6 constraint groups | ✅ relationship added, suite green |
| 1.3 | `tests/test_auth.py` | Integration | ✅ 22/22 prior green | ✅ ModuleNotFoundError | ✅ 7 passed | ✅ invalid/inactive/unknown/cookie flags/seed | ✅ StaticPool fixture fix |
| 1.4 | `tests/test_users.py` | Integration | ✅ 29/29 prior green | ✅ router missing (6 fail) | ✅ 7 passed | ✅ 409/401/403/invalidation/reset | ➖ None needed |

## Work Unit Evidence (PR1)

| Evidence | Value |
|---|---|
| Focused test command | `pytest` in `backend/` → **36 passed** (13 rules + 9 schema + 7 auth + 7 users) |
| Runtime harness | uvicorn on :8642, env-seeded admin: login 200 → me 200 → logout 200 → me 401 |
| Rollback boundary | Revert `feat/backend-core` commits: all changes live in `backend/` (+ 8 lines in `tasks.md`) |

## Commits (main..HEAD)

- `chore: project baseline with PRD and SDD planning artifacts` (on main)
- `547a332 chore(backend): scaffold python environment and test runner`
- `3e9d3d8 feat(backend): add tolerance evaluation and worst-of status rules`
- `f374479 feat(backend): add database schema with integrity constraints`
- `62e08be feat(backend): add session auth with Argon2 credentials`
- `eeec407 feat(backend): add admin user management`

## ⚠️ Budget breach (needs orchestrator decision)

`git diff --stat main..HEAD` = **809 insertions + 4 deletions = 813 changed lines** vs hard budget 400. The 4-task PR1 slice (full 8-table schema + auth + users under strict TDD with tests committed alongside) cannot fit 400 authored lines; trimming would require deleting TDD evidence. Options: split PR1 → PR1a (1.1–1.2, ≈380 lines) + PR1b (1.3–1.4, ≈430 lines), or maintainer `size:exception`.

## Deviations from design

- Enums (`MeasurementStatus`, `InspectionStatus`) live in `services/status.py`; `models.py` imports them — keeps task 1.1 pure (no DB imports) per ADR-1. Design placed no explicit home for enums.
- Task 1.2's `deps.py`/`main.py`/`schemas.py` landed with the auth commit (1.3) so every commit is self-consistent (main.py only imports routers that exist in that commit).

## Next steps

- Orchestrator: resolve budget breach (split vs size:exception), then PR1 delivery.
- PR2: Catalog API (Phase 2, tasks 2.1–2.3).
