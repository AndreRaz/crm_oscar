# Inspection Report Specification

## Purpose

Generate an auditable, on-demand A4 PDF for an inspection using its current record state.

## Requirements

### Requirement: Authorize report downloads

The system MUST allow an administrator to download any inspection report and MUST allow an inspector to download reports only for inspections that inspector performed.

#### Scenario: Authorized report download

- GIVEN an administrator or the inspector who performed an inspection
- WHEN the user requests its report
- THEN an A4 PDF is generated and returned

#### Scenario: Unauthorized report download is denied

- GIVEN an inspector who did not perform the inspection
- WHEN the inspector requests its report
- THEN the request is denied and no report is returned

### Requirement: Include complete inspection evidence

The generated PDF MUST contain the part type and image, piece serial, inspector, date/time, evaluated characteristic table with nominal, tolerance, actual, deviation, and status, disposition notes, and overall inspection status.

#### Scenario: Report contains inspection details

- GIVEN an inspection with measurements and a disposition note
- WHEN an authorized user downloads the report
- THEN the PDF contains all required identity, measurement, disposition, and overall-status fields

#### Scenario: Report represents an inspection without deviations

- GIVEN an inspection whose measurements are all in tolerance
- WHEN its report is generated
- THEN it shows `CONFORMING` and contains the evaluated measurements without disposition text

### Requirement: Reflect current state without storing files

The system MUST generate the PDF on demand and MUST reflect the current disposition state at download time; it MUST NOT require a previously stored report file.

#### Scenario: Disposition changes before download

- GIVEN a reportable inspection whose pending deviation has just been resolved
- WHEN an authorized user downloads the report
- THEN the PDF shows the updated disposition and derived overall status

#### Scenario: Repeated downloads use current data

- GIVEN an inspection with no stored PDF artifact
- WHEN the report is requested more than once
- THEN each response is generated from the current inspection record
