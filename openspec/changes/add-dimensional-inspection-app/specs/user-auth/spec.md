# User Auth Specification

## Purpose

Provide local account authentication, role-based access, and administrator-managed users.

## Requirements

### Requirement: Authenticate active users

The system MUST authenticate users with usernames and passwords whose stored credentials are hashed, and MUST establish a server-side session only for valid active accounts.

#### Scenario: Active user logs in

- GIVEN an active account with valid credentials
- WHEN the user submits the username and password
- THEN a server-side session is established and the user can access permitted features

#### Scenario: Invalid or inactive login is rejected

- GIVEN invalid credentials or an inactive account
- WHEN the user submits the login form
- THEN no session is established and access is denied

### Requirement: Enforce role permissions

The system MUST enforce `admin` and `inspector` permissions on the server and MUST expose only actions allowed for the authenticated role.

#### Scenario: Inspector accesses inspection features

- GIVEN an authenticated inspector
- WHEN the inspector opens the application
- THEN catalog viewing and inspection actions are available
- AND administrator-only actions are unavailable and denied if requested

#### Scenario: Administrator accesses management features

- GIVEN an authenticated administrator
- WHEN the administrator opens the application
- THEN user, catalog, disposition, annulment, report, and stability actions are available

### Requirement: Manage user accounts

An administrator MUST be able to create admin or inspector accounts, deactivate accounts, and reset passwords; usernames MUST be unique.

#### Scenario: Administrator manages an account

- GIVEN an authenticated administrator
- WHEN the administrator creates, deactivates, or resets an account
- THEN the requested account state or password becomes effective

#### Scenario: Duplicate username is rejected

- GIVEN an existing username
- WHEN an administrator attempts to create another account with that username
- THEN the account is not created and a validation error is returned
