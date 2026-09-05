# Delta for Part Catalog

## MODIFIED Requirements

### Requirement: Define dual-format characteristics

An administrator MUST be able to add, edit, and remove characteristics with code, name, unit, a nonblank free-text `measurement_method`, and finite `nominal`, `min_limit`, and `max_limit` values. The system MUST enforce the invariant `min_limit <= nominal <= max_limit`. `tol_type` (`SYMMETRIC` or `LIMITS`) MUST be retained only as a UX authoring/display hint: for `SYMMETRIC` the server MUST derive `min_limit` and `max_limit` from `nominal ± tol_plus`; for `LIMITS` the administrator MUST supply explicit `nominal`, `min_limit`, and `max_limit`. A characteristic MAY have one linked balloon.
(Previously: dual symmetric/limits format with optional nominal and unilateral limits; method absent.)

#### Scenario: Characteristic uses symmetric tolerance

- GIVEN a part type managed by an administrator
- WHEN a characteristic is saved with nominal, symmetric tolerance, and a method
- THEN the server derives `min_limit`/`max_limit` from `nominal ± tol_plus` and stores all four canonical fields NOT NULL

#### Scenario: Characteristic uses limits with explicit nominal

- GIVEN a part type managed by an administrator
- WHEN a characteristic is saved with `LIMITS`, finite `nominal`, `min_limit`, `max_limit`, and a method satisfying `min_limit <= nominal <= max_limit`
- THEN the stored range uses those explicit values

#### Scenario: Missing method or non-finite limits are rejected

- GIVEN characteristic data with a blank `measurement_method` or missing/non-finite `nominal`, `min_limit`, or `max_limit`
- WHEN the administrator saves the characteristic
- THEN the save is rejected with validation feedback and no characteristic is persisted

#### Scenario: Administrator edits or removes a characteristic

- GIVEN an existing characteristic and an authenticated administrator
- WHEN the administrator edits or removes it
- THEN the requested catalog change is applied to future inspections
- AND existing measurement records remain available

## ADDED Requirements

### Requirement: Guarded legacy characteristic migration

The system MUST migrate legacy characteristic rows to the four-field canonical model using ordered `PRAGMA user_version` steps at startup. The migration MUST derive `min_limit`/`max_limit` for `SYMMETRIC` rows from `nominal ± tol_plus`. The migration MUST block activation when any row is non-derivable (`LIMITS` row with null `nominal`, or any row missing `measurement_method`), MUST emit row-level diagnostics identifying each blocking row, and MUST leave the schema and `user_version` unchanged on block. The migration MUST be idempotent on retry after an administrator corrects the flagged rows.

#### Scenario: Non-derivable rows block activation with diagnostics

- GIVEN a legacy `LIMITS` row with null `nominal` or any legacy row missing `measurement_method`
- WHEN the migration runs
- THEN activation is blocked, row-level diagnostics identify each blocking row, and the schema and `user_version` remain unchanged

#### Scenario: Corrected rows activate on idempotent retry

- GIVEN a previously blocked migration and administrator corrections supplying finite nominal and nonblank method for every flagged row
- WHEN the migration runs again
- THEN previously applied steps are not repeated, the corrected rows activate, and `user_version` advances

## MODIFIED Requirements

### Requirement: Preserve measurement tolerance snapshots

When a measurement is recorded, the system MUST preserve a four-field snapshot of the characteristic's `nominal`, `min_limit`, `max_limit`, and `measurement_method` in effect at that moment; later characteristic edits MUST NOT change that measurement or its evaluation basis. For measurements recorded before this change, the system MUST retain the snapshot as originally recorded and MUST NOT fabricate missing `measurement_method` or limit values.
(Previously: snapshot of nominal and applicable tolerance/limits; method not mentioned.)

#### Scenario: Characteristic is edited after inspection

- GIVEN a completed measurement with a stored four-field snapshot
- WHEN an administrator edits the characteristic definition
- THEN the completed measurement retains its original snapshot and result

#### Scenario: Legacy measurement snapshots are not fabricated

- GIVEN a measurement recorded before the four-field snapshot requirement
- WHEN its record is read after migration
- THEN its original snapshot fields are preserved and the missing `measurement_method` snapshot remains null rather than backfilled
