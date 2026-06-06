# Fly.io Deployment — Life Tracker

## App details

| Field | Value |
|---|---|
| App name | `life-tracker-zach` |
| Region | `iad` (US East) |
| URL | https://life-tracker-zach.fly.dev |
| Machine | 1× shared CPU, 256 MB RAM |
| Auto-stop | Yes — machine stops when idle, starts on first request |

---

## fly.toml (already configured)

Located at project root: `fly.toml`

```toml
app = "life-tracker-zach"
primary_region = "iad"

[build]

[env]
  PORT = "8080"
  DB_PATH = "/data/sleep_tracker.db"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[[mounts]]
  source = "life_tracker_data"
  destination = "/data"

[[vm]]
  memory = "256mb"
  cpu_kind = "shared"
  cpus = 1
```

Key points:
- `internal_port = 8080` — gunicorn binds to this port inside the container
- `force_https = true` — all HTTP redirected to HTTPS automatically
- `auto_stop_machines = "stop"` / `min_machines_running = 0` — machine sleeps when no traffic (cold start ~1s)
- `[[mounts]]` — persistent volume `life_tracker_data` mounted at `/data`; this is where `sleep_tracker.db` lives across deploys

---

## Dockerfile (already configured)

Located at project root: `Dockerfile`

Two-stage build:
1. **Stage 1 (`node:20-alpine`)** — installs npm deps and runs `vite build`, outputs to `/build/dist`
2. **Stage 2 (`python:3.11-slim`)** — installs Python deps, copies Flask backend, copies the built React dist from Stage 1

Gunicorn runs as the entrypoint with 2 workers and a 120s timeout.

---

## Deploy command

Run from the project root (`C:\Users\zacha\OneDrive\Documents\SleepTracker`):

```
flyctl deploy --app life-tracker-zach
```

This is the only command needed. It:
1. Builds the Docker image remotely via Depot (no local Docker required)
2. Runs both build stages (npm build + pip install)
3. Pushes the image to Fly's registry
4. Performs a rolling deploy — replaces the running machine with zero downtime

---

## Secrets (environment variables set on Fly, not in fly.toml)

Set once via `flyctl secrets set KEY=value --app life-tracker-zach`. Never stored in the repo.

| Secret | Purpose |
|---|---|
| `GROQ_API_KEY` | Groq AI — weekly insights, chatbot, exercise summaries |
| `ANTHROPIC_API_KEY` | Claude vision — food photo analyzer |
| `PIN_HASH` | SHA-256 hash of the PIN used to lock the app |

To update a secret: `flyctl secrets set KEY=newvalue --app life-tracker-zach`
To list current secrets (names only): `flyctl secrets list --app life-tracker-zach`

---

## Persistent database

The SQLite database lives on a Fly volume, not in the container image. It survives deploys and machine restarts.

- Volume name: `life_tracker_data`
- Mount path: `/data`
- DB file: `/data/sleep_tracker.db`

**To pull the cloud DB to local for inspection:**

```powershell
.\pull.ps1
```

This stops local servers, downloads the DB via `flyctl sftp`, and restarts. See `pull.ps1` at project root.

---

## Logs

```
flyctl logs --app life-tracker-zach --no-tail
```

On startup the app prints:
- `Database ready: /data/sleep_tracker.db`
- `Groq API key : OK`

Any 500 errors from Flask will appear here.

---

## Notes

- **UTC timezone** — Fly machines run UTC. All "today" API endpoints must accept a `?date=YYYY-MM-DD` query param sent from the client (local date). Never rely on `date.today()` alone on the server for user-facing data.
- **Cold starts** — with `min_machines_running = 0` the machine stops after ~5 min of no traffic. The first request after idle takes ~1s to wake. Acceptable for a single-user app.
- **No CI/CD pipeline** — deploys are manual (`flyctl deploy`). There is no GitHub Actions or automated deploy on push.
