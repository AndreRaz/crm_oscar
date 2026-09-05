# Delta for Inspection Report

## MODIFIED Requirements

### Requirement: Include complete inspection evidence

The generated PDF MUST contain the part type and image, piece serial, inspector, date/time, evaluated characteristic table with `measurement_method`, nominal, min/max limits, actual, deviation, and status, disposition notes, and overall inspection status. Report authorization MUST remain unchanged: administrators MAY download any report and inspectors MAY download only reports for inspections they performed.
(Previously: characteristic table omitted measurement_method; authorization already admin-any/inspector-own.)

#### Scenario: Report contains inspection details with method

- GIVEN an inspection with measurements and a disposition note
- WHEN an authorized user downloads the report
- THEN the PDF contains all required identity, measurement (including method snapshot), disposition, and overall-status fields

#### Scenario: Report represents an inspection without deviations

- GIVEN an inspection whose measurements are all in tolerance
- WHEN its report is generated
- THEN it shows `CONFORMING` and contains the evaluated measurements with method and without disposition text
