# Dimensional Inspection and Part Stability

Local quality-control application for managing a dimensional catalog, guided
inspections, deviation disposition, PDF reports, and stability trends.

## Prerequisites

- Python 3.10 or newer
- Node.js 22 LTS or newer with npm
- SQLite 3 (the CLI is optional but recommended for backups)
- WeasyPrint native libraries for PDF generation

On Debian 11+/Ubuntu 20.04+, install the Pango/Cairo runtime libraries before
installing Python dependencies:

```bash
sudo apt update
sudo apt install libcairo2 libpango-1.0-0 libpangoft2-1.0-0 \
  libgdk-pixbuf-2.0-0 shared-mime-info
```

If `pip` must compile native dependencies instead of using wheels, also install
`build-essential`, `libcairo2-dev`, `libpango1.0-dev`, `libgdk-pixbuf-2.0-dev`,
and `libffi-dev`. Package names differ on non-Debian distributions; see the
[WeasyPrint installation guide](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html).

## Setup

Create the backend virtual environment and install pinned dependencies:

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
```

Install the frontend dependencies from the repository root:

```bash
cd frontend
npm ci
```

## Initial administrator

The backend creates the first administrator at startup when both variables are
set. Use a strong password and remove it from shell history or service files
after the account has been created.

```bash
export ADMIN_USERNAME=admin
export ADMIN_PASSWORD='replace-with-a-strong-password'
```

Seeding is idempotent: an existing username is not overwritten. Later accounts
and password resets are managed through the administrator UI.

## Local SQLite run

The default database URL is `sqlite:///data/app.db`, resolved from `backend/`.
The directory and schema are created automatically. In one terminal:

```bash
cd backend
export ADMIN_USERNAME=admin
export ADMIN_PASSWORD='replace-with-a-strong-password'
.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In another terminal, start Vite. Its development proxy forwards `/api` to the
backend:

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

Open the URL printed by Vite (normally <http://127.0.0.1:5173>). To use another
SQLite file, set `DATABASE_URL=sqlite:////absolute/path/to/app.db` before the
backend starts.

## Tests and production build

```bash
# Backend (run from backend/)
.venv/bin/python -m pytest

# Frontend (run from frontend/)
npm run test -- --run
npm run build
```

The production frontend output is written to `frontend/dist/`. This repository
does not currently include a production static-file server; deploy that output
behind a server that proxies `/api` to the FastAPI process.

## Backups

Back up both the SQLite database and uploaded part images under
`backend/data/images/`. For a consistent database copy while the application is
running, use SQLite's online backup command:

```bash
mkdir -p backups
sqlite3 backend/data/app.db ".backup 'backups/app.db'"
cp -a backend/data/images backups/images
```

Keep backups outside the repository and test restores periodically. To restore,
stop the backend, replace `backend/data/app.db` and `backend/data/images/`, then
restart the service. Copying a live SQLite file directly is not a safe backup.
