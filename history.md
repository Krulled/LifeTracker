# Life Tracker — Project History
*Feed this file to Claude at the start of a new session to restore full context.*

---

## Project Overview

A personal health & life tracking web app. Lives at **https://life-tracker-zach.fly.dev** (PIN-locked for privacy). Also runs locally at `localhost:9999` (frontend) / `localhost:3030` (backend). Local dev bypasses PIN auth.

**Stack:**
- Backend: Python/Flask + SQLite + SQLAlchemy (`backend/app.py`, `backend/models.py`)
- Frontend: React + Vite (`frontend/src/`)
- AI: Groq API (text — chatbots, insights) + Anthropic Claude API (vision — food photo scanning)
- Hosting: Fly.io, app name `life-tracker-zach`, region `iad`
- Database: SQLite, persisted on Fly.io volume at `/data/sleep_tracker.db`
- Local DB: `backend/sleep_tracker.db`

---

## Repo Layout

```
SleepTracker/
├── backend/
│   ├── app.py               # Flask app, all API routes
│   ├── models.py            # SQLAlchemy models
│   ├── requirements.txt     # flask, groq, anthropic, gunicorn, etc.
│   ├── .env                 # GROQ_API_KEY, ANTHROPIC_API_KEY (not in Docker)
│   └── sleep_tracker.db     # local SQLite DB
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Auth wrapper + routing
│   │   ├── index.css        # All styles (~6300 lines)
│   │   └── components/      # One file per module (see list below)
│   ├── package.json
│   └── vite.config.mjs      # .mjs extension suppresses CJS deprecation warning
├── fly.toml                 # Fly.io config (256mb RAM, /data mount)
├── Dockerfile               # Multi-stage: node build → python serve
├── .dockerignore
├── start.bat                # Local dev: starts Flask + Vite dev server
├── setup.bat                # Local setup: creates venv, installs deps
├── pull.ps1                 # Sync cloud DB → local (stops servers, writes file, restarts)
└── logs/
    ├── backend.log
    └── frontend.log
```

**Frontend components:**
- `App.jsx` — PIN auth wrapper, hash-based routing to all modules
- `PinLock.jsx` — 6-digit PIN keypad (cloud only; local bypasses)
- `HealthDashboard.jsx` — hub overview cards
- `TodayStrip.jsx` — today's summary strip
- `AIInsights.jsx` — weekly AI insights (Groq)
- `HealthChatbot.jsx` — general health AI chatbot (Groq)
- `SleepModule.jsx` — sleep logging & calendar
- `CalorieModule.jsx` — full calorie tracker with calendar
- `NutritionFitnessModule.jsx` — combined calories + exercise daily log + chatbot + weekly energy balance chart
- `FoodPhotoAnalyzer.jsx` — photo → AI macro analysis (Anthropic Claude vision)
- `ExerciseModule.jsx` — exercise log with routines/templates
- `HabitModule.jsx` — habit checklist + 12-week grid
- `MoodModule.jsx` — mood tracking
- `HydrationModule.jsx` — water intake
- `WeightModule.jsx` — weight & body fat trends
- `WeeklyReviewModule.jsx` — weekly review + AI feedback
- `ChoresModule.jsx` — weekly chore tracker
- `TaskModule.jsx` — task list with AI coach

---

## Environment Variables

**Local (`backend/.env`):**
```
GROQ_API_KEY=...
ANTHROPIC_API_KEY=...
```

**Fly.io secrets (set via `flyctl secrets set KEY=value --app life-tracker-zach`):**
- `GROQ_API_KEY` — Groq text AI (chatbots, insights)
- `ANTHROPIC_API_KEY` — Anthropic Claude (food photo vision analysis)
- `PIN_HASH` — SHA-256 hex of the 6-digit PIN (enables PIN lock on cloud)
- `SECRET_KEY` — Flask session signing key

PIN auth is controlled by `PIN_HASH`: if the env var is empty (local dev), auth is bypassed entirely. `SESSION_COOKIE_SECURE` is only set to True when `PIN_HASH` is present.

---

## Fly.io Deployment

```powershell
flyctl deploy --app life-tracker-zach
```

- Docker multi-stage build: Node builds frontend → Python serves everything
- Gunicorn serves Flask on port 8080
- Frontend `dist/` is served as static files by Flask
- DB is on a persistent volume (`life_tracker_data` → `/data/`)
- Auto-stops when idle (`auto_stop_machines = "stop"`), auto-starts on request

---

## Local Development

**Start servers:**
```
start.bat
```
- Checks if ports 3030/9999 are already in use before starting (no double-start crash)
- Uses `backend/venv/` if it exists, falls back to global Python
- Frontend: Vite dev server on port 9999, proxies `/api/*` → port 3030
- Backend: Flask on port 3030

**Setup from scratch:**
```
setup.bat
```
Creates `backend/venv/`, installs `requirements.txt`.

**Sync cloud DB to local (`pull.ps1`):**
1. Stops local servers (kills ports 3030 + 9999) to release SQLite file lock
2. Downloads DB from Fly.io via `flyctl ssh sftp`
3. Writes `backend/sleep_tracker.db`
4. Restarts servers via `start.bat`

---

## Key Architectural Decisions & Known Patterns

### UTC Date Bug — Fixed in Multiple Places
The Fly.io server runs UTC. Users in US time zones can be up to 7 hours behind UTC, meaning after ~5–8pm their local time, the server is already on the next date. This caused:
- Calories showing 0 on cloud (fixed)
- Habits not saving on mobile (fixed)

**Pattern for every endpoint that has a concept of "today":**
- Frontend computes local date: `` `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}` ``
- Frontend passes it as `?date=YYYY-MM-DD` query param
- Backend: `today = date.fromisoformat(date_str) if date_str else date.today()`

**Files already fixed:**
- `TodayStrip.jsx` + `HealthDashboard.jsx` — pass `?date=` to `/api/today`
- `app.py` `today_snapshot()` — reads `?date=` param
- `HabitModule.jsx` — passes `?date=` to `/api/habits`
- `app.py` `get_habits()` — reads `?date=`, passes `today=` to `h.to_dict()`
- `models.py` `Habit.logged_today(today=None)` + `Habit.current_streak(today=None)` — accept optional date param

**Still uses `date.today()` (server UTC) and has NOT been fixed:**
Sleep, mood, exercise, hydration, weight, tasks, chores — these modules were not reported as broken. Apply the same pattern if issues arise.

### PIN Auth Architecture
- `require_pin()` is a Flask `@before_request` hook
- Checks `session.get("pin_ok")` for every `/api/*` route except `/api/auth/*` and `/api/sync/*`
- `POST /api/auth/verify` — verifies SHA-256 hash of entered PIN vs `PIN_HASH` env var
- `GET /api/auth/status` — frontend polls this on load to decide whether to show PIN screen
- `POST /api/auth/lock` — clears session (🔒 Lock button on hub)
- Frontend (`App.jsx`): `App` component handles auth state; if not authed, shows `PinLock`; if authed, shows `AuthedApp`
- Local dev: `PIN_HASH` is empty → `require_pin()` returns immediately → no lock screen

### Food Photo AI (Anthropic Claude Vision)
- Endpoint: `POST /api/food/analyze-photo`
- Model: `claude-haiku-4-5-20251001` (fast + cheap, excellent food recognition)
- Frontend compresses images to max 1024px / 0.82 JPEG quality before sending (canvas API)
- Returns: `{ food_name, calories, protein_g, carbs_g, fat_g, description }`
- UI shows quantity multiplier (1× 2× 3× 4× 6× presets + custom input) — all macros scale proportionally
- Component: `FoodPhotoAnalyzer.jsx`, launched from 📷 Scan button in `NutritionFitnessModule`

### Meal Templates
- Saved via `POST /api/food/templates`
- Applied via `POST /api/food/templates/:id/apply`
- Frontend: `TemplatesPanel` inside `NutritionFitnessModule` / `CalorieDaySection`

### AI Services
- **Groq** (`GROQ_API_KEY`): Used for all text AI — nutrition chatbot, health chatbot, AI weekly insights, weekly review feedback, task AI coach. Fast inference.
- **Anthropic** (`ANTHROPIC_API_KEY`): Used only for food photo vision analysis (`claude-haiku-4-5-20251001`).

---

## Bugs Fixed This Session

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Calories showing 0 on cloud | `date.today()` in `today_snapshot()` used UTC; user's local date differed | Frontend passes `?date=<localDate>`; backend reads it |
| `pull.ps1` always failed | Flask held SQLite file lock | Script stops servers before writing, restarts after |
| `start.bat` double-start crash | No port check before starting | Added `netstat` guard |
| Package version mismatch local vs cloud | Global Python had different versions than `requirements.txt` | Created `backend/venv/`, updated `setup.bat` + `start.bat` |
| Vite CJS deprecation warning | `vite.config.js` (CommonJS) | Renamed to `vite.config.mjs` |
| Habits not saving on mobile | `Habit.logged_today()` and `current_streak()` used `date.today()` (UTC) | Added `today=None` param to both methods; frontend passes `?date=` |

---

## Features Built This Session

### PIN Lock (privacy)
- 6-digit PIN keypad (`PinLock.jsx`) with shake animation on wrong PIN
- Server-side session cookie (`pin_ok`) — protects all `/api/*` routes
- Lock button on hub footer
- Local dev auto-bypasses (no `PIN_HASH` env var)

### Food Photo Scanner
- 📷 Scan button in Nutrition & Fitness → Calories panel header
- Camera capture + gallery upload (both supported)
- Client-side image compression before upload
- Claude Haiku vision returns food name + macros + description
- Quantity multiplier scales all macros (presets: 1× 2× 3× 4× 6×)
- Preview/edit form before saving — user can adjust any value

---

## Finance App
There is a separate Finance app linked from the hub: `http://localhost:5174/?tab=dashboard` (local only). It's a different project. The link opens in a new tab.

---

## Notes for Future Sessions
- Always pass local date as `?date=YYYY-MM-DD` for any endpoint that references "today"
- The `venv` is in `backend/venv/` — use `venv\Scripts\python.exe` on Windows
- After making backend changes locally, restart Flask (kill port 3030, re-run `start.bat`)
- After making frontend changes locally, Vite hot-reloads automatically (no restart needed)
- To deploy: `flyctl deploy --app life-tracker-zach` from the project root
- `.dockerignore` excludes `backend/venv/` — dependencies are installed fresh in Docker via `requirements.txt`
