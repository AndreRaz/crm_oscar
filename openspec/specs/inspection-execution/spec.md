# Inspection Execution Specification

## Purpose

Guide inspectors through selecting characteristics and recording one locked dimensional inspection.

## Requirements

### Requirement: Start an inspection for a uniquely identified piece

The system MUST allow an authenticated user to select an active part type, identify a piece by serial, and select the characteristics to evaluate. A serial MUST be unique within its part type, but MAY exist under another part type.

#### Scenario: Inspector starts a valid inspection

- GIVEN an active part type and an unused serial for that type
- WHEN the inspector selects characteristics and starts inspection
- THEN a measurement session is created for that piece and selection

#### Scenario: Duplicate serial is rejected

- GIVEN a serial already used for the selected part type
- WHEN the inspector attempts to start another piece with that serial
- THEN the start is rejected and no duplicate piece identity is created

### Requirement: Provide guided manual measurement capture

The system MUST present the selected characteristic in three panes: image and highlighted balloon, nominal/tolerance, and manual actual-value input. It MUST validate numeric, unit-aware decimal input and MUST permit unselected characteristics to be skipped.

#### Scenario: Inspector records a numeric value

- GIVEN a selected characteristic with a valid tolerance definition
- WHEN the inspector enters a valid measured decimal
- THEN the actual value is accepted and the characteristic result is displayed

#### Scenario: Invalid input is not recorded

- GIVEN a measurement input that is non-numeric or invalid for its unit
- WHEN the inspector submits it
- THEN the value is rejected with validation feedback and no measurement is recorded

### Requirement: Evaluate measurement and inspection status server-side

The system MUST evaluate actual values against the applicable tolerance snapshot and show live status. An in-range value MUST be `IN_TOLERANCE`; an out-of-range value MUST be `PENDING` until disposition. The completed inspection MUST be locked and its status derived from its measurements using worst-of ordering: `REJECTED`, then `PENDING`, then `ACCEPTED_WITH_DEVIATIONS`, otherwise `CONFORMING`.

#### Scenario: Measurement status updates live

- GIVEN a valid actual value
- WHEN the value is within or outside the stored limits
- THEN the server returns `IN_TOLERANCE` or `PENDING` respectively

#### Scenario: Completion derives and locks status

- GIVEN selected measurements with any combination of statuses
- WHEN the inspector completes the inspection
- THEN the worst-of status is stored and the inspection and measurements cannot be edited
