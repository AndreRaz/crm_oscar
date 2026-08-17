# Part Catalog Specification

## Purpose

Define the administrator-managed part catalog, balloon annotations, and measurable characteristics.

## Requirements

### Requirement: Manage part types and lifecycle

An administrator MUST be able to create and edit a part type with code, name, description, and image, and MUST be able to deactivate it. Deactivated part types MUST NOT be selectable for new inspections and MUST remain available to historical records.

#### Scenario: Administrator creates and deactivates a part type

- GIVEN an authenticated administrator
- WHEN the administrator saves valid part type data and later deactivates it
- THEN the part type appears in the catalog
- AND it is excluded from new inspection selection while history remains readable

#### Scenario: Invalid catalog data is rejected

- GIVEN missing required part type data or an invalid image submission
- WHEN the administrator saves the part type
- THEN the part type is not saved and validation feedback is returned

### Requirement: Define dual-format characteristics

An administrator MUST be able to add, edit, and remove characteristics with code, name, unit, and either symmetric nominal-plus-tolerance values or minimum/maximum limits. A characteristic MAY have one linked balloon.

#### Scenario: Characteristic uses symmetric tolerance

- GIVEN a part type managed by an administrator
- WHEN a characteristic is saved with nominal and symmetric tolerance
- THEN its desired range is represented as nominal plus/minus that tolerance

#### Scenario: Characteristic uses limits

- GIVEN a part type managed by an administrator
- WHEN a characteristic is saved with minimum and maximum limits
- THEN its desired range uses those limits, including asymmetric or unilateral ranges

#### Scenario: Administrator edits or removes a characteristic

- GIVEN an existing characteristic and an authenticated administrator
- WHEN the administrator edits or removes it
- THEN the requested catalog change is applied to future inspections
- AND existing measurement records remain available

### Requirement: Keep inspector catalog access read-only

Inspectors MUST be able to view active catalog information but MUST NOT create, edit, deactivate, annotate, or change characteristics.

#### Scenario: Inspector views catalog without edit access

- GIVEN an authenticated inspector
- WHEN the inspector opens a part type and its characteristics
- THEN catalog data is readable
- AND catalog mutation requests are denied

### Requirement: Preserve measurement tolerance snapshots

When a measurement is recorded, the system MUST preserve the characteristic nominal and applicable tolerance or limits in effect at that moment; later characteristic edits MUST NOT change that measurement or its evaluation basis.

#### Scenario: Characteristic is edited after inspection

- GIVEN a completed measurement with a stored tolerance snapshot
- WHEN an administrator edits the characteristic definition
- THEN the completed measurement retains its original snapshot and result

### Requirement: Maintain balloon links

An administrator MUST be able to place numbered balloons on a part image, with each balloon linked to its characteristic and each number unique within that part type.

#### Scenario: Balloon is placed and displayed

- GIVEN an image and an existing characteristic
- WHEN the administrator places a numbered balloon and links it
- THEN the balloon coordinates and characteristic association are saved for inspection display

#### Scenario: Duplicate balloon number is rejected

- GIVEN a balloon number already used by the part type
- WHEN the administrator submits another balloon with that number
- THEN the placement is rejected without changing existing annotations
