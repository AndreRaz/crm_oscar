# Project Context — crm_oscar

## Product

Local web application for dimensional QA inspection: parts catalog with
ballooned images, characteristics with dual tolerance formats, guided
inspection capture, MRB deviation disposition, PDF reports, and per-part-type
stability trend charts. Full requirements: `docs/PRD.md`.

## Stack (binding decisions)

- Backend: Python FastAPI + SQLAlchemy + SQLite, Pydantic validation.
- Frontend: React (Vite) + Recharts (trend charts).
- PDF generation: WeasyPrint.
- Deployment: local single-server web app; ALL business rules server-side
  (PRD NFR-3) so a later shared multi-user deployment only swaps the
  data/deployment layer.

## Testing capabilities

- Backend: pytest + pytest-asyncio. Command: `pytest` (from `backend/`).
- Frontend: Vitest + React Testing Library. Command: `vitest run`
  (from `frontend/`).
- E2E (later phase): Playwright.
- Strict TDD mode: ENABLED (greenfield project, full test tooling available).

## SDD Session Preflight (current session)

- execution_mode: auto
- artifact_store: both (OpenSpec files + Engram memory)
- delivery_strategy: ask-on-risk
- review_budget_lines: 400

## Conventions

- Technical artifacts (specs, designs, tasks, code, comments) in English.
- UI copy in Spanish (PRD NFR-6).
- Inspection records are immutable; corrections via annulment (PRD FR-6).
- Measurements store tolerance snapshots (PRD FR-3).
