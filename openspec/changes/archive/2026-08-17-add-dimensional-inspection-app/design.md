# Design: Dimensional Inspection & Part Stability System (v1)

## Technical Approach

Greenfield monolith: FastAPI + SQLAlchemy + SQLite REST API owns every business rule (NFR-3); the React (Vite) SPA only renders state and collects input. Layered backend (`routers → services → models`) keeps tolerance evaluation, worst-of derivation, permissions, and audit in pure service functions, unit-testable without DB or HTTP (strict TDD). PDFs render on demand via WeasyPrint; nothing is stored.

## Architecture Decisions

| # | Decision | Rejected alternative | Rationale |
|---|----------|----------------------|-----------|
| 1 | Rules as pure functions in `services/` | Rules in routers/models | `evaluate()`/`worst_of()` testable without DB/HTTP (NFR-3) |
| 2 | Argon2id via `argon2-cffi` | bcrypt (72-byte cap); PBKDF2 (weaker) | OWASP-preferred memory-hard hash |
| 3 | DB server sessions; opaque token, HttpOnly `SameSite=Lax` cookie | JWT; in-memory sessions | NFR-4; instant invalidation on deactivate/reset |
| 4 | Resolved snapshot: nominal + lower/upper limit copies | Copy raw fields; FK-only | One evaluation basis for both `tol_type`s; edits never alter history (FR-3) |
| 5 | Status persisted; recomputed on complete/disposition/annulment | Derived view per read | Spec stores worst-of; recompute only in audited events |
| 6 | On-demand WeasyPrint from Jinja2 HTML; tests assert HTML | Stored PDFs; pixel tests | FR-7 current state; pango/cairo risk in one smoke test |
| 7 | DB unique/check constraints mirror service validation | App-only checks | Defense in depth: username, serial, balloon, A3 |
| 8 | Piece auto-created at inspection start | Separate piece registry | `unique(part_type_id, serial)` enforces A2 in one step |

## Data Flow

    React SPA ──HTTP+cookie──▶ Routers (authz dep) ──▶ Services (rules+audit) ──▶ SQLAlchemy ──▶ SQLite
                                     │
                                     └─ report ─▶ Jinja2 HTML ─▶ WeasyPrint ─▶ PDF bytes (not stored)

Lifecycle: start (create Piece+Inspection) → record Measurements (snapshot+evaluate, live status) → complete (worst-of, lock) → disposition/annulment touch only status+audit fields. Images under `backend/data/images/`; DB holds the path.

## Data Model (SQLAlchemy, refined from PRD §9)

FKs indexed; timestamps default `utcnow`.

- **User**: `username` unique; `role` Enum(admin, inspector); `active`.
- **AuthSession**: `token` PK (urlsafe), `user_id` FK, `expires_at`.
- **PartType**: `code` unique; `image_path`; `active`.
- **Characteristic**: `tol_type` Enum(SYMMETRIC, LIMITS); nullable `nominal`, `tol_plus`, `min_limit`, `max_limit`. Checks: SYMMETRIC ⇒ `nominal`+`tol_plus` required; LIMITS ⇒ ≥1 limit, `min ≤ max` if both. Unique(`part_type_id`,`code`); `sort_order`.
- **Balloon**: Unique(`part_type_id`,`number`); `characteristic_id` unique; `x`,`y` relative 0..1.
- **Piece**: Unique(`part_type_id`,`serial`).
- **Inspection**: `status` Enum(CONFORMING, PENDING, ACCEPTED_WITH_DEVIATIONS, REJECTED); nullable annulment `at/by/reason`.
- **Measurement**: `actual_value` Float; nullable snapshots (`nominal_snapshot`, `lower/upper_limit_snapshot`; null = unilateral side); `deviation` = actual − nominal if nominal exists; `status` Enum(IN_TOLERANCE, PENDING, DEVIATION_ACCEPTED, REJECTED); disposition `by/at/note`; Unique(`inspection_id`,`characteristic_id`) (A3).

In-range ⇔ `lower ≤ actual ≤ upper` (inclusive; null bound = unbounded).

## API Surface

- Auth: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- Users (admin): `GET/POST /api/users`, `PATCH /api/users/{id}` (deactivate, reset)
- Catalog: `GET/POST /api/part-types`, `GET/PATCH /api/part-types/{id}` (+deactivate), `POST/GET .../image`; `GET/POST .../characteristics`, `PATCH/DELETE /api/characteristics/{id}`; same for `.../balloons`, `/api/balloons/{id}`
- Inspections: `POST /api/inspections` (part_type_id, serial, characteristic_ids), `GET /api/inspections/{id}`, `POST .../measurements`, `POST .../complete`, `POST .../annul` (admin)
- Deviations (admin): `GET /api/deviations`, `POST /api/measurements/{id}/disposition` `{action: accept|reject, text}`
- Report: `GET /api/inspections/{id}/report.pdf` (admin any; inspector own)
- Stability (admin): `GET /api/stability?part_type_id=&characteristic_id=`

## Interfaces / Contracts

```python
def evaluate(actual, nominal, lower, upper) -> MeasurementStatus  # all float|None
def worst_of(statuses) -> InspectionStatus
# precedence: REJECTED > PENDING > DEVIATION_ACCEPTED > (all IN_TOLERANCE ⇒ CONFORMING)
```

Stability response consumed by Recharts (`points` chronological):

```json
{ "characteristic": {"code","name","unit","nominal","lower_limit","upper_limit"},
  "points": [{"inspection_id","serial","completed_at","actual","deviation","status"}] }
```

Frontend draws a `Line` plus nominal/limit `ReferenceLine`s; it never computes status.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/app/main.py`, `db.py`, `deps.py` | Create | App wiring, engine/session, `current_user`/`require_role` |
| `backend/app/models.py`, `schemas.py` | Create | Tables above; Pydantic v2 I/O |
| `backend/app/routers/{auth,users,catalog,inspections,deviations,reports,stability}.py` | Create | Thin HTTP per capability |
| `backend/app/services/{tolerance,status,auth,catalog,inspection,disposition,report,stability}.py` | Create | Rules + audit writes |
| `backend/app/templates/report.html.j2` | Create | A4 report, Spanish labels |
| `backend/tests/` | Create | pytest unit + integration |
| `frontend/src/api/client.js` | Create | fetch wrapper, cookie credentials |
| `frontend/src/pages/{Login,Catalog,Inspection,Deviations,Stability,Users}.jsx` + components, tests | Create | Role tabs; 3-pane inspection; BalloonEditor; Recharts trend; Vitest+RTL |

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| pytest unit | `evaluate` (symmetric, limits, asymmetric, unilateral, inclusive edges); `worst_of` matrix; hash/verify; blank-note rejection | Pure functions |
| pytest integration | Role 403s; uniqueness rules; snapshot survives characteristic edit; complete locks; disposition+annulment audit; report authz (admin any / inspector own / other denied); PDF reflects disposition change; stability scoping | TestClient, temp SQLite |
| PDF | Required fields; valid bytes | Assert HTML; one WeasyPrint smoke test |
| Vitest+RTL | Role tabs; inspector read-only catalog; 3-pane shows server statuses; chart ReferenceLines from contract | Mocked `api/client.js` |
| E2E | — | Deferred (Playwright, post-v1) |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required — greenfield; schema created at startup; first-run seeds one admin from env vars.

## Open Questions

- None blocking. A5 (inspector PDF = own inspections) implemented per PRD; confirm with Oscar.
