# Stability Analysis Specification

## Purpose

Help administrators detect dimensional drift across inspections of one part type.

## Requirements

### Requirement: Authorize scoped stability analysis

Only administrators MAY access stability analysis. The administrator MUST select exactly one part type and one characteristic belonging to that part type; comparisons MUST NOT cross part types.

#### Scenario: Administrator opens a valid analysis

- GIVEN an authenticated administrator and a characteristic of the selected part type
- WHEN the administrator requests stability data
- THEN data is returned for that characteristic within that part type only

#### Scenario: Inspector or cross-type request is denied

- GIVEN an inspector or a characteristic belonging to another part type
- WHEN the request is submitted
- THEN access or the mismatched selection is rejected

### Requirement: Show chronological measurement table

The system MUST provide one row per inspected piece for the selected part type and characteristic, ordered chronologically, containing serial, date, actual value, deviation, and measurement status.

#### Scenario: Table lists inspected pieces

- GIVEN several inspected pieces of the selected part type
- WHEN the administrator opens the analysis
- THEN each applicable piece appears once in chronological order with all required values

#### Scenario: No measurements are available

- GIVEN a valid part type and characteristic with no inspected pieces
- WHEN the administrator requests the analysis
- THEN an empty result is returned with a clear no-data state

### Requirement: Render tolerance-aware trend chart

The system MUST provide a trend of actual values over inspection time with horizontal nominal and lower/upper limit lines derived from the selected characteristic. It MUST NOT calculate or present Cp/Cpk or statistical control limits in v1.

#### Scenario: Chart displays reference lines

- GIVEN a characteristic with valid nominal and applicable limits
- WHEN the administrator views the trend
- THEN actual measurements and nominal, lower-limit, and upper-limit lines are displayed

#### Scenario: Asymmetric limits remain distinct

- GIVEN a characteristic defined with different minimum and maximum limits
- WHEN the trend is rendered
- THEN each limit line uses its own value and is not treated as symmetric
