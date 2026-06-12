# Life Tracker — Development Rules

## Stack constraints (non-negotiable)

- **Frontend: React only.** All UI must be written in React (`.jsx`). Do not introduce Vue, Svelte, Angular, or any other frontend framework or library that replaces React. Vanilla JS pages are not permitted.
- **Backend: Python Flask only.** All server-side code must be written in Python using Flask (`backend/app.py`). Do not introduce Node.js, Express, FastAPI, Django, or any other backend runtime or framework.

## What this means in practice

- New modules → new `.jsx` component in `frontend/src/components/`, wired into `App.jsx`.
- New API endpoints → new route in `backend/app.py` using Flask `@app.route`.
- Database access → SQLAlchemy models in `backend/models.py`.
- No new runtimes, no new servers, no polyglot backend services.

## Deployment (non-negotiable)

- **Every deploy ships to BOTH Fly.io apps**, never just one: `life-tracker-zach`
  (`fly.toml`) **and** `life-tracker-nev` (`fly.nev.toml`). Shipping one leaves
  the sites out of sync.
- **The standard way to deploy is the `deploy-both-fly-apps` skill.** Follow it
  for every deploy — it deploys `zach`, then `nev` only if `zach` succeeds, then
  verifies both URLs respond.
- **The norm:** once a self-contained set of local changes is complete and
  verified, deploy to both sites via that skill. Deploy finished work, not
  partial/in-progress edits.
