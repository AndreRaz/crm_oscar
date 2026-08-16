# Proposal: Dimensional Inspection & Part Stability System (v1)

## Intent

Inspection today runs on paper/spreadsheets: no traceability, informal deviation acceptance, no drift visibility. Build v1 per `docs/PRD.md` (10 locked decisions).

## Scope

### In Scope
- FR-1 Auth: local login, hashed passwords, server-side sessions; `admin`/`inspector` roles; admin user management.
- FR-2 Catalog: part types with image; deactivate semantics; read-only for inspectors.
- FR-3 Characteristics: dual tolerance formats (`nominal ± tol`, `min/max limits`); snapshot rule.
- Balloons: numbered points on image, one per characteristic.
- FR-4/5 Guided inspection: 3-pane screen (image + balloon / nominal / actual input); piece serial unique per part type; live pass/fail; manual entry.
- FR-6 MRB disposition: pending queue; accept-with-note / reject-with-reason; audit; immutable inspections, admin annulment.
- FR-7 On-demand PDF report (WeasyPrint, not stored).
- FR-8 Stability (admin): chronological table + Recharts trend chart with nominal and limit lines, per part type.

### Out of Scope
- Phase 2: visual attributes, CSV import, Cp/Cpk, multi-user deployment, gauge input.
- Multi-tenancy, SSO, cross-part-type comparison.

## Capabilities

### New Capabilities
- `user-auth`: login, sessions, roles, admin user management.
- `part-catalog`: part types, images, balloons, characteristics, snapshot rule.
- `inspection-execution`: 3-pane capture, piece serials, validation, live status, locking.
- `deviation-disposition`: pending queue, accept/reject with mandatory notes, audit, annulment.
- `inspection-report`: on-demand PDF reflecting current disposition state.
- `stability-analysis`: per-part-type table + trend chart with tolerance limits (admin only).

### Modified Capabilities
None — greenfield; `openspec/specs/` is empty.

## Approach

All business rules server-side (NFR-3): FastAPI + SQLAlchemy + SQLite REST API owns tolerance evaluation, worst-of status derivation, permissions, audit. React (Vite) SPA consumes it; Recharts trends; WeasyPrint on-demand PDFs from HTML. Strict TDD: pytest backend, Vitest + RTL frontend. UI Spanish (NFR-6); code English.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/` | New | FastAPI: models, routers, services, PDF templates, pytest |
| `frontend/` | New | React SPA: catalog, inspection, MRB, stability tabs |
| `openspec/specs/` | New | Six capability specs on archive |


## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Snapshot inconsistency after edits | Med | Snapshot at measurement time; pytest edit-after-inspection cases |
| WeasyPrint system deps (pango/cairo) | Med | Document install; assert generated HTML, not pixels |
| Scope creep toward Phase 2 | Med | Non-goals locked in PRD §3/§11; review vs decision log |
| Business logic leaking to client | Low | NFR-3 gate: no tolerance/status logic in frontend |

## Rollback Plan

Greenfield, no production data: revert = delete `backend/`/`frontend/`, archive the change. PR slices independently revertible; SQLite backed up via file copy (NFR-2).

## Dependencies

- Python + WeasyPrint system libs (pango/cairo); Node for Vite.

## Success Criteria

- [ ] FR-1..FR-8 covered by green pytest + Vitest suites (TDD).
- [ ] Inspector completes a full inspection with live pass/fail.
- [ ] Admin resolves a deviation and annuls an inspection, both audited.
- [ ] PDF reflects disposition state at download time (A4).
- [ ] Stability chart renders trend with nominal/limit lines.

## Proposal question round

Mode `auto` — no interactive round. PRD §10/§12 pre-answer shaping questions; only A5 (inspector PDF scope) worth flagging to Oscar.
