# Workout Chat Panel — Design Spec
**Date:** 2026-05-25

## Overview

A one-shot natural-language workout logger embedded in the SkinCare module's Today tab. The user types a workout description ("brutal HIIT this morning, drenched") and the system extracts structured data, creates an ExerciseEntry, and immediately regenerates today's skincare routine based on sweat intensity.

This is a failsafe input path alongside the existing ExerciseModule — both sources write ExerciseEntry rows and the rule engine reads all of them.

---

## Glossary (must be in code comments at rule engine top)

- **BP** = benzoyl peroxide (a medicated acne treatment)
- **PIH** = post-inflammatory hyperpigmentation (dark spots left by healed acne)
- **BHA** = beta hydroxy acid (salicylic acid — oil-soluble exfoliant, effective post-sweat)
- **Medicated wash** = any cleanser with BP or BHA active ingredients

---

## Resolved Design Decisions

### 1. Chat panel with mandatory fallback
Keep the NLP chat input. If Groq fails or returns an invalid response, the frontend automatically shows three inline buttons: **Low / Medium / High**. The user clicks one to submit directly. Same endpoint, same rule engine — the fallback passes `sweat_level` without a Groq call.

### 2. POST idempotency
60-second timestamp window: if an ExerciseEntry with the same `entry_date` and `exercise_type` was created within the last 60 seconds, return the existing entry rather than inserting a duplicate. Prevents double-tap / network retry corruption of the sweat accumulation math.

### 3. ExerciseModule + chat panel data ownership
Both sources create independent ExerciseEntry rows. No deduplication at insert time. The rule engine reads all rows for the date and applies "highest sweat wins" — this naturally handles the multi-source case without schema changes.

### 4. Groq failure rollback
Order of operations in the Flask endpoint:
1. Call Groq → parse response
2. Validate `sweat_level` is in `{"low", "medium", "high"}` (server-side enum check)
3. Only if valid: write ExerciseEntry to DB
4. Trigger routine regeneration
5. Return `{reply, created_exercise}`

If step 1 or 2 fails: return `{fallback: true, error: "..."}` — no DB write, no routine change. Frontend shows fallback buttons.

### 5. "Skip medicated" vs "highest sweat wins" precedence
Rule: **highest sweat across all of today's ExerciseEntry rows wins.**
- If ANY entry has `sweat_level = "high"` → medicated washes unlocked
- "Skip medicated" applies only when ALL entries are `sweat_level = "low"` (or no workout logged)
- One high-intensity entry overrides any number of low-intensity entries

### 6. Unchecking a completed step
RoutineStepLog stores `completed` (bool) per step per day. The max-2-medicated count is computed dynamically at routine generation time from rows where `completed = True`. Unchecking a step always decrements the live count. This makes the max-2 rule a hard cap enforced against current state.

---

## Architecture

### Layer assignments (unchanged from prior council)
- **Layer 1** (LLM ingest, once): product photo scanning — not touched by this feature
- **Layer 2** (deterministic Python, once per trigger): `_build_routine()` + `_generate_and_persist_routine()` — extended with sweat rules and step-completion memory
- **Layer 3** (idempotent React): renders from persisted `DailyRoutine` row — unchanged

### New endpoint
`POST /api/skincare/workout-chat`
- Input: `{message: str, date: "YYYY-MM-DD"}`
- Groq parses → `{exercise_type, name, duration_minutes, sweat_level}`
- Fallback path: `{sweat_level: "low"|"medium"|"high", exercise_type, date}` (no Groq call)
- Idempotency: check for duplicate within 60s window
- DB write: ExerciseEntry
- Trigger: `_generate_and_persist_routine(target_date)`
- Output: `{reply: str, created_exercise: {name, exercise_type, duration_minutes, sweat_level}, fallback: bool}`

---

## Rule Engine Extensions

### Sweat intensity rules (added to `_build_routine`)

```python
# BP = benzoyl peroxide, BHA = beta hydroxy acid, PIH = post-inflammatory hyperpigmentation
# sweat_level precedence: if ANY workout today is "high", high rules apply.
# "skip medicated" only when ALL workouts are "low" (or no workout).
_SWEAT_LEVELS = {"high": 2, "medium": 1, "low": 0}

def _max_sweat(exercises):
    if not exercises:
        return "none"
    return max((e.intensity or "low") for e in exercises, key=lambda s: _SWEAT_LEVELS.get(s, 0))
```

Sweat × type rules:

| Sweat | Type | Rule |
|---|---|---|
| high | cardio | BP wash first (if BP product available); extra rinse step |
| high | strength | BHA cleanser; skip heavy occlusives |
| medium | any | Existing cardio/strength logic unchanged |
| low | any | Skip medicated washes entirely; gentle cleanser only |
| none | — | No workout-driven adjustments |

### Step completion memory (added to `_generate_and_persist_routine`)

```python
# Read completed steps for today before generating
completed_keys = {
    row.step_key
    for row in RoutineStepLog.query.filter_by(log_date=target_date, completed=True).all()
}
# Count medicated washes already done
medicated_done = sum(
    1 for k in completed_keys if k.startswith("medicated_")
)
# Pass to _build_routine so it can cap additional medicated steps
routine = _build_routine(products, exercises, medicated_done=medicated_done)
```

`_build_routine` signature extended:
```python
def _build_routine(products, exercises, medicated_done=0):
    ...
    MAX_MEDICATED = 2
    medicated_remaining = MAX_MEDICATED - medicated_done
    # Only add medicated steps up to medicated_remaining
```

---

## Frontend Changes (SkinCareModule.jsx)

### New state
```js
const [wInput, setWInput] = useState("");
const [wStatus, setWStatus] = useState(null); // null | "sending" | {reply, exerciseName, sweatLevel}
const [wError, setWError] = useState(null);
const [wFallback, setWFallback] = useState(false); // true = show low/medium/high buttons
```

### UI placement
Inside the Today tab, below the routine checklist, separated by a divider:
```
─────────────────────────────────
🏃 Log a workout
[textarea placeholder: "Did a 45 min run this morning..."]
[Send ↑]
✅ 45min cardio (high sweat) logged — routine updated   ← confirmation pill
```

Fallback UI (shown when `wFallback = true` or Groq fails):
```
⚠️ Couldn't parse workout — how intense was it?
[Low] [Medium] [High]
```

### Submit flow
1. `wInput` → POST `/api/skincare/workout-chat` with `{message, date}`
2. On `{fallback: true}` response → set `wFallback = true`
3. On success → set `wStatus` with confirmation data, call `fetchRoutine(selectedDate)`
4. Fallback button click → POST same endpoint with `{sweat_level, exercise_type: "cardio", date}` (bypasses Groq)

---

## CSS
Add `wc-*` classes to `frontend/src/index.css`:
- `wc-section` — wrapper div
- `wc-divider` — horizontal rule above section
- `wc-label` — "🏃 Log a workout" heading
- `wc-input-row` — flex row with textarea + button
- `wc-textarea` — input field
- `wc-send-btn` — send button
- `wc-confirm` — confirmation pill (green)
- `wc-fallback` — fallback prompt container
- `wc-fallback-btn` — low/medium/high buttons

---

## Files Touched

| File | Change |
|---|---|
| `backend/app.py` | Add `POST /api/skincare/workout-chat`; extend `_build_routine(medicated_done)` and `_generate_and_persist_routine` to read RoutineStepLog |
| `frontend/src/components/SkinCareModule.jsx` | Add workout input section + state to Today tab |
| `frontend/src/index.css` | Add `wc-*` styles |

No new files. No new models. No schema migrations.

---

## What Is Explicitly Out of Scope

- Time-weighted sweat accumulation (two medium > one high) — deferred
- General-purpose health event ingestion from this panel — deferred
- Outcome tracking / skin check-in — deferred (prior council decision)
- ExerciseModule sweat intensity field — separate feature, tracked separately
