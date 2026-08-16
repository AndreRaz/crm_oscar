# PRD — Dimensional Inspection & Part Stability System

**Status:** Draft v1 (for review)
**Date:** 2026-08-16
**Owner:** Oscar (product) — QA / Manufacturing

---

## 1. Overview

A local web application for dimensional quality inspection. Inspectors measure
physical parts against defined characteristics (nominal + tolerance), record
results, and generate auditable inspection reports. An administrator manages the
part catalog, resolves out-of-tolerance deviations, and compares measurements
across pieces of the same part type to detect process drift.

**Platform:** local web app (single local server + browser client) with SQLite
as the database, architected so the data layer can later be swapped for a
shared multi-user deployment without rewriting the UI or business logic.

## 2. Problem

Dimensional inspection today is done on paper or spreadsheets. This causes:

- No traceability: which piece, measured by whom, when, with what result.
- Out-of-tolerance values are accepted informally, without a disposition record.
- No visibility into whether a process is drifting: measurements of the same
  characteristic across many pieces are never compared.

## 3. Goals and Non-Goals

### Goals (v1)

- G1: Role-based access (Admin / Inspector) with login.
- G2: Admin-managed part catalog with images and balloon annotations.
- G3: Characteristic definition supporting both tolerance formats
      (nominal ± tolerance and min/max limits).
- G4: Guided inspection screen: part image (left), nominal value (center),
      actual value input (right), with live pass/fail status.
- G5: Deviation disposition workflow: pending → admin accepts (concession) or
      rejects, fully audited.
- G6: Immutable inspection records with annulment workflow for corrections.
- G7: Downloadable PDF report per inspection.
- G8: Admin stability view: table + trend chart per characteristic across
      pieces of the same part type, with tolerance limits drawn.

### Non-Goals (v1)

- Multi-user shared deployment (single local machine only; data layer must be
  swappable, see NFR-3).
- Visual/attribute characteristics (OK / NOT OK) — Phase 2.
- Digital gauge instrument input (serial/USB) — Phase 2.
- CSV/Excel measurement import — Phase 2.
- Process capability indices (Cp/Cpk) and statistical control limits — Phase 2.

## 4. Roles and Permissions

| Capability | Admin | Inspector |
| --- | --- | --- |
| Log in and inspect parts | ✓ | ✓ |
| View part catalog | ✓ | ✓ |
| Select characteristics to evaluate in an inspection | ✓ | ✓ |
| Download PDF report of an inspection | ✓ | own inspections (A5) |
| Create/edit part types, upload images, place balloons | ✓ | — |
| Add/remove/edit characteristics of a part type | ✓ | — |
| Resolve pending deviations (accept/reject) | ✓ | — |
| View stability comparison tab | ✓ | — |
| Manage user accounts (create, deactivate, reset password) | ✓ | — (A1) |
| Annul an inspection | ✓ | — |

## 5. Domain Model

- **PartType** — a kind of part in the catalog (code, name, description, image).
- **Balloon** — a numbered point placed on the part image, linked to one
  characteristic (ballooned-drawing convention).
- **Characteristic** — a measurable dimension of a part type. Defined either as
  `nominal ± tolerance` or `min limit / max limit` (asymmetric and unilateral
  supported via limits).
- **Piece** — one physical part instance, identified by a unique serial number
  within its part type (A2).
- **Inspection** — the act of inspecting one piece: a set of measurements by
  one inspector. Immutable once completed.
- **Measurement** — actual value recorded for one characteristic in one
  inspection, with a snapshot of the nominal/tolerance used at measurement
  time, the computed deviation, and its disposition status.

## 6. Functional Requirements

### FR-1 Authentication and Users

- Login with username and password (local accounts, hashed passwords).
- Two roles: `admin` and `inspector`. Role drives visible tabs and actions.
- Admin manages user accounts: create inspector/admin accounts, deactivate,
  reset password (A1).

### FR-2 Part Catalog (tab)

- Admin creates part types: code, name, description, and uploads an image.
- Admin edits/deactivates part types. Deactivated part types are hidden from
  new inspections but kept in history.
- Inspectors see the catalog read-only.
- Admin places numbered balloons on the image, each linked to a
  characteristic (see FR-3).

### FR-3 Characteristics

- Admin adds, removes, and edits characteristics per part type.
- Each characteristic has: code, name, unit, tolerance definition
  (either `nominal ± sym tolerance` or `min/max limits`), and an optional
  balloon link.
- **Snapshot rule:** when an inspection records a measurement, the
  nominal/tolerance values in effect at that moment are stored with the
  measurement. Later edits to a characteristic never alter past inspections.

### FR-4 Inspection Execution

- Inspector selects a part type, identifies the piece by serial number, and
  selects which characteristics to evaluate.
- Inspection screen, three panes:
  - **Left:** part image with balloons; the balloon of the current
    characteristic is highlighted.
  - **Center:** desired value (nominal and tolerance, rendered per the
    characteristic's format).
  - **Right:** input for the actual measured value (manual entry, FR-5).
- On entry, the app computes deviation and shows live status (see §7).
- One measurement per characteristic per inspection (A3). The inspector may
  skip characteristics not selected.
- On completion the inspection is saved and locked (FR-6).

### FR-5 Measurement Capture

- Manual entry only in v1: the inspector reads the instrument and types the
  value. Numeric validation with unit-aware decimals.

### FR-6 Disposition Workflow and Immutability

- Out-of-tolerance measurements are marked `PENDING` automatically.
  Inspectors cannot accept deviations.
- Admin sees a pending-deviations queue grouped by inspection, and resolves
  each one as:
  - `DEVIATION_ACCEPTED` — concession, with mandatory note, and who/when.
  - `REJECTED` — with mandatory reason.
- Inspection records are immutable after completion. Corrections are made by
  annulment: admin annuls an inspection with a mandatory reason (audited) and
  a new inspection is performed.
- Every disposition and annulment is audited (user, timestamp, note).

### FR-7 Inspection Report

- Downloadable PDF per inspection (A4: generated on demand, not stored).
- Contains: part type and image, piece serial, inspector, date/time, table of
  evaluated characteristics (nominal, tolerance, actual, deviation, status),
  disposition notes, and overall inspection status.
- The PDF reflects the current disposition state at download time.

### FR-8 Stability Comparison (admin tab)

- Admin selects one part type and one characteristic.
- **Table:** one row per inspected piece (chronological): serial, date,
  actual value, deviation, status.
- **Trend chart:** actual value per inspection over time, with horizontal
  lines for nominal and upper/lower limits. Visual detection of drift.
- Comparison is always within the same part type, never across types.

## 7. Status Logic

Measurement status after entry:

| Status | Meaning |
| --- | --- |
| `IN_TOLERANCE` | Actual value within limits (auto). |
| `PENDING` | Out of tolerance, awaiting admin disposition. |
| `DEVIATION_ACCEPTED` | Out of tolerance, admin concession with note. |
| `REJECTED` | Out of tolerance, admin rejected with reason. |

Inspection status (derived, worst-of): any `REJECTED` → `REJECTED`; else any
`PENDING` → `PENDING`; else any `DEVIATION_ACCEPTED` → `ACCEPTED_WITH_DEVIATIONS`;
else `CONFORMING`.

## 8. Non-Functional Requirements

- **NFR-1** Local single-server web app; browser client (desktop-first).
- **NFR-2** SQLite single-file database; backup procedure = documented file
  copy (with app stopped or using the documented safe method).
- **NFR-3** All business rules (tolerance evaluation, status derivation,
  permissions) run server-side, so the migration to a shared multi-user
  deployment only replaces the data/deployment layer.
- **NFR-4** Authentication: hashed passwords, server-side sessions.
- **NFR-5** Auditability: no measurement may ever be silently altered.
- **NFR-6** UI language: Spanish (A6).
- **NFR-7** Interactive response well under 1s at local single-machine scale.

## 9. Conceptual Data Model

```
User          (id, username, password_hash, role, active)
PartType      (id, code, name, description, image_path, active)
Characteristic(id, part_type_id, code, name, unit,
               tol_type: SYMMETRIC|LIMITS,
               nominal, tol_plus, tol_minus, min_limit, max_limit,
               sort_order, active)
Balloon       (id, part_type_id, characteristic_id, number, x, y)
Piece         (id, part_type_id, serial, created_at)   -- serial unique per type
Inspection    (id, piece_id, inspector_id, started_at, completed_at,
               status, annulled_at, annulled_by, annulment_reason)
Measurement   (id, inspection_id, characteristic_id,
               actual_value,
               nominal_snapshot, limits_snapshot,
               deviation, status,
               disposition_by, disposition_at, disposition_note)
```

## 10. Assumptions (confirm)

| # | Assumption |
| --- | --- |
| A1 | Admin manages user accounts in-app (create/deactivate/reset). |
| A2 | Serial numbers are unique within a part type (not globally). |
| A3 | One measurement per characteristic per inspection; no repeat averaging in v1. |
| A4 | PDF reports are generated on demand, not stored as files. |
| A5 | Inspectors can download PDFs of their own inspections only; admin can download any. |
| A6 | UI copy in Spanish. |
| A7 | Editing a characteristic affects new inspections only (snapshot rule, FR-3). |
| A8 | A rejected piece is recorded in the system; its physical handling is an offline process. |

## 11. Phase 2 Roadmap (explicitly out of v1)

1. Visual/attribute characteristics (OK / NOT OK) alongside numeric ones.
2. CSV/Excel measurement import.
3. Process capability: Cp/Cpk and statistical control limits on the stability chart.
4. Shared multi-user deployment (central server + network database).
5. Digital gauge input (serial/USB instrument reading).

## 12. Decision Log

| Topic | Decision |
| --- | --- |
| Tolerance model | Both formats: nominal ± tol and min/max limits, per characteristic |
| Deviation flow | MRB-style: inspector marks pending; admin accepts (concession) or rejects |
| Piece identity | Unique serial number per physical piece |
| Stability depth | Table + trend chart with tolerance limits (no Cp/Cpk in v1) |
| Platform | Local web app (server + browser), SQLite, migration path to shared |
| Report | Downloadable PDF |
| Capture | Manual entry in v1 |
| Image | Ballooned image linked per characteristic |
| Record edits | Immutable records; annulment + re-inspection for corrections |
| Visual attributes | Phase 2 |
