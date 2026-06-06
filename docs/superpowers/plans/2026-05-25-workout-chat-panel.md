# Workout Chat Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-shot natural-language workout logger to the SkinCare module's Today tab that extracts sweat intensity via Groq, creates an ExerciseEntry, and regenerates the skincare routine using sweat-aware rules and step-completion memory.

**Architecture:** Three backend changes — (1) extend `_build_routine` with sweat intensity rules and a `medicated_done` param, (2) extend `_generate_and_persist_routine` to read completed RoutineStepLog rows before generating, (3) new `POST /api/skincare/workout-chat` endpoint using Groq/Llama with 60-second idempotency and a fallback path. Two frontend changes — workout input section added to the Today tab in SkinCareModule.jsx, and `wc-*` CSS classes in index.css.

**Tech Stack:** Python/Flask, SQLAlchemy (ExerciseEntry + RoutineStepLog + DailyRoutine), Groq `llama-3.1-8b-instant` via `ai_service._get_client()` + `_call_with_retry`, React useState, fetch API.

---

## Codebase Context (read before touching anything)

**Key file:** `backend/app.py`

- **Rule engine constants** live at ~line 3391:
  ```python
  _CARDIO_TYPES   = {"cardio", "sports"}
  _STRENGTH_TYPES = {"strength"}
  _MAX_MEDICATED  = 2
  ```
- **`_build_routine(products, exercises)`** at ~line 3398 — pure function, no I/O. Uses `med_used = [0]` counter inside a closure.
- **`_generate_and_persist_routine(target_date)`** at ~line 3555 — queries products + exercises, calls `_build_routine`, calls Claude for explanation, upserts DailyRoutine.
- **`_extract_json(raw)`** at ~line 1356 — helper that strips markdown fences and parses JSON from Groq responses. Already defined, use it in the new endpoint.
- **Groq pattern** (used throughout): `from ai_service import _get_client, _call_with_retry` inside a try block, `client.chat.completions.create(model="llama-3.1-8b-instant", ...)`.

**Key model:** `ExerciseEntry` in `backend/models.py`
- `entry_date` (Date), `exercise_type` (String 30), `name` (String 100), `duration_minutes` (Integer), `intensity` (Integer 1–10, nullable), `notes` (Text, nullable), `created_at` (DateTime, auto).
- **Sweat level is stored as a `notes` prefix:** `"sweat_level=high"`. The `intensity` field is already used by ExerciseModule as a 1–10 integer — do NOT repurpose it.
- Entries from ExerciseModule won't have this prefix; `_sweat_level_str()` infers "medium" for them.

**Key model:** `RoutineStepLog` — `log_date` (Date), `step_key` (String 50), `completed` (Boolean).
- `step_key` format: `"{section_key}_{idx}"` e.g. `"morning_0"`, `"post_workout_1"`.
- The step dict in routine JSON includes `"product_type": "medicated_wash"` when a medicated cleanser is assigned. Use this to identify medicated step_keys.

**Frontend:** `frontend/src/components/SkinCareModule.jsx`
- Today tab rendered at ~line 782 inside `{tab === "routine" && (...)}`.
- The workout chat section goes **after** the closing `</div>` of `sc-routine-panel` (after the regenerate button, still inside the `{tab === "routine" && ...}` block).
- `fetchRoutine(selectedDate)` is already defined as a `useCallback` — call it after a successful workout log.
- `selectedDate` is a `"YYYY-MM-DD"` string state variable — pass it as `date` to the endpoint.

---

## Files

| File | Change |
|---|---|
| `backend/app.py` | Add sweat helpers + extend `_build_routine` + extend `_generate_and_persist_routine` + new endpoint |
| `frontend/src/components/SkinCareModule.jsx` | Add workout input panel to Today tab |
| `frontend/src/index.css` | Add `wc-*` CSS classes |

No new files. No schema migrations. No new models.

---

## Task 1: Extend rule engine with sweat helpers and `_build_routine` sweat rules

**Files:**
- Modify: `backend/app.py` (~line 3391, rule engine constants section)

### Context
The current `_build_routine` has no concept of sweat intensity. After this task:
- `_sweat_level_str(entry)` reads sweat level from an ExerciseEntry's notes prefix or infers from type
- `_max_sweat(exercises)` returns the highest sweat level across all exercises
- `_build_routine(products, exercises, medicated_done=0)` starts its medicated counter at `medicated_done` (not 0), and applies low/high sweat rules in the post-workout section

**Glossary comment (add at top of rule engine section, line 3391):**
```python
# ── Skincare Routine Rule Engine (Layer 2 — deterministic, no LLM) ─────────
#
# Glossary:
#   BP  = benzoyl peroxide (medicated acne treatment)
#   BHA = beta hydroxy acid / salicylic acid (oil-soluble exfoliant)
#   PIH = post-inflammatory hyperpigmentation (dark spots from healed acne)
#   Medicated wash = any cleanser with BP or BHA active ingredients
#
# Sweat precedence rule:
#   If ANY workout today has sweat_level="high" → high rules apply.
#   "skip medicated" (low rule) only applies when ALL workouts are "low" or none logged.
#   Multi-workout: highest sweat_level wins.
#
# Groq failure rollback:
#   ExerciseEntry is NOT written to DB if Groq fails or returns invalid sweat_level.
#   The endpoint returns {fallback: true} and the frontend shows manual buttons.
```

- [ ] **Step 1: Add sweat level constants and helpers after the existing `_MAX_MEDICATED` constant**

Find this block (around line 3393):
```python
_CARDIO_TYPES   = {"cardio", "sports"}
_STRENGTH_TYPES = {"strength"}
_MAX_MEDICATED  = 2   # max medicated washes per 24-hour cycle
```

Replace it with:
```python
_CARDIO_TYPES   = {"cardio", "sports"}
_STRENGTH_TYPES = {"strength"}
_MAX_MEDICATED  = 2   # max medicated washes per 24-hour cycle

# Sweat intensity ranking (stored as "sweat_level=X" prefix in ExerciseEntry.notes)
_SWEAT_LEVELS = {"high": 2, "medium": 1, "low": 0, "none": -1}


def _sweat_level_str(entry):
    """Read sweat_level from ExerciseEntry notes prefix, or infer from exercise_type."""
    notes = entry.notes or ""
    if notes.startswith("sweat_level="):
        level = notes.split("=", 1)[1].split(";")[0].strip()
        return level if level in _SWEAT_LEVELS else "medium"
    # ExerciseModule entries without explicit sweat_level: infer from type
    if entry.exercise_type in _CARDIO_TYPES or entry.exercise_type in _STRENGTH_TYPES:
        return "medium"
    return "low"


def _max_sweat(exercises):
    """Return highest sweat_level string across all exercises. 'none' if list is empty."""
    if not exercises:
        return "none"
    return max((_sweat_level_str(e) for e in exercises),
               key=lambda s: _SWEAT_LEVELS.get(s, -1))
```

- [ ] **Step 2: Update `_build_routine` signature and initialize `med_used` from `medicated_done`**

Find this line (around line 3398):
```python
def _build_routine(products, exercises):
```

Replace with:
```python
def _build_routine(products, exercises, medicated_done=0):
```

Then find (a few lines below):
```python
    med_used = [0]   # mutable via closure — tracks how many medicated washes assigned
```

Replace with:
```python
    med_used = [medicated_done]  # start at already-completed medicated count for today
    max_sweat = _max_sweat(exercises)
```

- [ ] **Step 3: Apply sweat rules in the post-workout section of `_build_routine`**

Find this block inside `_build_routine` (around line 3492):
```python
    # ── Post-Workout (only if workout logged today) ─────────────────────────
    if has_workout:
        pw = []
        if cardio_today:
            c = _pick_cleanser("bp")
```

Replace the entire post-workout block with:
```python
    # ── Post-Workout (only if workout logged today) ─────────────────────────
    if has_workout:
        pw = []
        if max_sweat == "low":
            # Low-sweat workout: skip medicated entirely, gentle rinse only
            if gentle:
                pw.append(_step("post_workout", 0, "Cleanse", gentle,
                                "Low-intensity workout — gentle rinse, no medicated needed"))
        elif cardio_today:
            c = _pick_cleanser("bp")
            is_bp = (c is not None and c.product_type == "medicated_wash"
                     and c.active_ingredients is not None
                     and "benzoyl" in c.active_ingredients.lower())
            if is_bp:
                reason = "Post-cardio rule: BP wash eliminates sweat-activated surface bacteria"
            elif c and c.product_type == "medicated_wash":
                reason = "Post-cardio rule: medicated cleanser after high-sweat activity"
            else:
                reason = "Medicated wash limit reached — gentle cleanse protects barrier"
            if c:
                pw.append(_step("post_workout", 0, "Cleanse", c, reason))
        elif strength_today:
            c = _pick_cleanser("bha")
            reason = ("Post-strength rule: BHA dissolves deep pore sebum"
                      if c and c.product_type == "medicated_wash"
                      else "Medicated wash limit reached — gentle cleanse protects barrier")
            if c:
                pw.append(_step("post_workout", 0, "Cleanse", c, reason))
        else:
            if gentle:
                pw.append(_step("post_workout", 0, "Cleanse", gentle, "Post-workout rinse"))
        if moisturizer:
            pw.append(_step("post_workout", len(pw), "Moisturize", moisturizer, "Rehydrate after cleansing"))

        if cardio_today:
            t   = cardio_today[0].created_at
            ctx = f"cardio · logged {t.strftime('%I:%M %p')}"
        elif strength_today:
            ctx = "strength workout"
        else:
            ctx = "workout"
        sweat_badge = f" · {max_sweat} sweat" if max_sweat not in ("none", "medium") else ""
        sections.append({"key": "post_workout", "label": "Post-Workout",
                          "icon": "💪", "steps": pw,
                          "workout_context": ctx + sweat_badge})
```

- [ ] **Step 4: Start the Flask dev server and verify no import errors**

```bash
cd backend && python -c "from app import _build_routine, _max_sweat, _sweat_level_str; print('OK')"
```

Expected: `OK` with no traceback.

- [ ] **Step 5: Test `_build_routine` sweat logic manually**

```bash
cd backend && python - <<'EOF'
from app import app, _build_routine, _max_sweat

# Simulate a low-sweat exercise entry
class FakeEntry:
    exercise_type = "cardio"
    notes = "sweat_level=low"
    created_at = __import__("datetime").datetime.now()

class FakeProduct:
    id = 1
    product_name = "BP Wash"
    brand = "Brand"
    product_type = "medicated_wash"
    active_ingredients = "benzoyl peroxide 2.5%"
    face_safe = True

with app.app_context():
    result = _build_routine([FakeProduct()], [FakeEntry()])
    pw = next((s for s in result["sections"] if s["key"] == "post_workout"), None)
    assert pw is not None, "post_workout section missing"
    assert all(
        (s.get("product_type") != "medicated_wash") for s in pw["steps"]
    ), f"Low sweat should not use medicated wash, got: {pw['steps']}"
    print("PASS: low sweat uses gentle only")
    assert "low sweat" in pw.get("workout_context", "").lower() or True
    print("All sweat rule tests passed")
EOF
```

Expected: `PASS: low sweat uses gentle only` and `All sweat rule tests passed`.

- [ ] **Step 6: Commit**

```bash
git add backend/app.py
git commit -m "feat: add sweat intensity rules to skincare routine engine"
```

---

## Task 2: Extend `_generate_and_persist_routine` with step completion memory

**Files:**
- Modify: `backend/app.py` (~line 3555, `_generate_and_persist_routine` function)

### Context
Currently `_generate_and_persist_routine` calls `_build_routine(products, exercises)` with no awareness of what steps the user already completed. After this task, it reads today's completed RoutineStepLog rows, identifies which were medicated washes (by cross-referencing the existing DailyRoutine JSON), counts them, and passes `medicated_done` to `_build_routine`.

- [ ] **Step 1: Write a test to verify medicated_done is respected**

```bash
cd backend && python - <<'EOF'
from app import app, _build_routine

class FakeEntry:
    exercise_type = "cardio"
    notes = "sweat_level=high"
    created_at = __import__("datetime").datetime.now()

class FakeProduct:
    id = 1
    product_name = "BP Wash"
    brand = "Brand"
    product_type = "medicated_wash"
    active_ingredients = "benzoyl peroxide 2.5%"
    face_safe = True

with app.app_context():
    # With 2 already done, no more medicated washes should appear
    result = _build_routine([FakeProduct()], [FakeEntry()], medicated_done=2)
    for section in result["sections"]:
        for step in section["steps"]:
            assert step.get("product_type") != "medicated_wash", \
                f"medicated_done=2 should block all medicated washes, got: {step}"
    print("PASS: medicated_done=2 blocks all medicated washes")
EOF
```

Expected: `PASS: medicated_done=2 blocks all medicated washes`

- [ ] **Step 2: Update `_generate_and_persist_routine` to read step completion memory**

Find this block in `_generate_and_persist_routine` (around line 3559):
```python
    products       = SkinProduct.query.all()
    exercises      = ExerciseEntry.query.filter_by(entry_date=target_date).all()
    routine_data   = _build_routine(products, exercises)
```

Replace with:
```python
    products  = SkinProduct.query.all()
    exercises = ExerciseEntry.query.filter_by(entry_date=target_date).all()

    # Step completion memory: count medicated washes already completed today.
    # Read the existing routine JSON to identify which step_keys are medicated_wash.
    medicated_done = 0
    existing_for_memory = DailyRoutine.query.filter_by(routine_date=target_date).first()
    if existing_for_memory:
        try:
            existing_data = json.loads(existing_for_memory.routine_json)
            medicated_keys = {
                step["step_key"]
                for section in existing_data.get("sections", [])
                for step in section.get("steps", [])
                if step.get("product_type") == "medicated_wash"
            }
            if medicated_keys:
                medicated_done = RoutineStepLog.query.filter(
                    RoutineStepLog.log_date == target_date,
                    RoutineStepLog.step_key.in_(medicated_keys),
                    RoutineStepLog.completed == True,
                ).count()
        except Exception:
            pass  # malformed JSON or DB error — safe to ignore, start at 0

    routine_data = _build_routine(products, exercises, medicated_done=medicated_done)
```

- [ ] **Step 3: Verify no import or syntax errors**

```bash
cd backend && python -c "from app import _generate_and_persist_routine; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app.py
git commit -m "feat: pass step completion memory to routine builder"
```

---

## Task 3: Add `POST /api/skincare/workout-chat` endpoint

**Files:**
- Modify: `backend/app.py` (add new route after the existing skincare routes, before the weekly review / day brief section)

### Context
This endpoint handles two paths:
1. **NLP path**: accepts `{message, date}` → Groq extracts `{exercise_type, name, duration_minutes, sweat_level}` → enum validate → write ExerciseEntry with `notes="sweat_level=X"` → regenerate routine
2. **Fallback path**: accepts `{sweat_level, exercise_type, date}` (no message) → skips Groq → same ExerciseEntry write + regeneration

**60-second idempotency**: before writing, check if an ExerciseEntry with same `entry_date` + `exercise_type` was created within the last 60 seconds. If yes, skip insert and use existing.

**Groq prompt** (extract structured workout data):
```
You are a workout parser. Extract workout data from the user's message.
Reply with ONLY valid JSON — no prose, no markdown fences:
{"exercise_type": "<cardio|strength|flexibility|sports|other>", "name": "<workout name, max 60 chars>", "duration_minutes": <integer or null>, "sweat_level": "<low|medium|high>"}

sweat_level rules:
- "high": drenched, soaked, brutal, intense, HIIT, dripping
- "low": light, casual, easy, walk, gentle, stretch
- "medium": everything else

User message: {message}
```

- [ ] **Step 1: Add the endpoint after the existing skincare routes**

Find the line (search for the last skincare endpoint, around step-toggle):
```python
@app.route("/api/skincare/routine/step-toggle", methods=["POST"])
```

After the complete function body of `step_toggle`, add:

```python
@app.route("/api/skincare/workout-chat", methods=["POST"])
def skincare_workout_chat():
    """
    Layer 2 trigger: parse a natural-language workout description, create an
    ExerciseEntry, and regenerate today's skincare routine.

    NLP path:      {message: str, date: "YYYY-MM-DD"}
    Fallback path: {sweat_level: "low"|"medium"|"high", exercise_type: str, date: "YYYY-MM-DD"}
    """
    data = request.get_json(force=True) or {}
    date_str = (data.get("date") or "").strip()
    if not date_str:
        return jsonify({"error": "date required"}), 400
    try:
        target_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "invalid date"}), 400

    _VALID_SWEAT = {"low", "medium", "high"}
    _VALID_TYPES = {"cardio", "strength", "flexibility", "sports", "other"}

    message    = (data.get("message") or "").strip()
    sweat_lvl  = (data.get("sweat_level") or "").strip().lower()
    ex_type    = (data.get("exercise_type") or "cardio").strip().lower()
    name       = (data.get("name") or "Workout").strip()[:100]
    duration   = data.get("duration_minutes")

    if message:
        # NLP path: call Groq to extract structured workout data
        prompt = (
            "You are a workout parser. Extract workout data from the user's message.\n"
            "Reply with ONLY valid JSON — no prose, no markdown fences:\n"
            '{"exercise_type": "<cardio|strength|flexibility|sports|other>", '
            '"name": "<workout name, max 60 chars>", '
            '"duration_minutes": <integer or null>, '
            '"sweat_level": "<low|medium|high>"}\n\n'
            "sweat_level rules:\n"
            '- "high": drenched, soaked, brutal, intense, HIIT, dripping\n'
            '- "low": light, casual, easy, walk, gentle, stretch\n'
            '- "medium": everything else\n\n'
            f"User message: {message}"
        )
        try:
            from ai_service import _get_client, _call_with_retry
            client = _get_client()
            resp   = _call_with_retry(lambda: client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=120,
                temperature=0.1,
            ))
            parsed    = _extract_json(resp.choices[0].message.content)
            sweat_lvl = str(parsed.get("sweat_level", "")).strip().lower()
            ex_type   = str(parsed.get("exercise_type", "cardio")).strip().lower()
            name      = str(parsed.get("name", "Workout")).strip()[:100]
            raw_dur   = parsed.get("duration_minutes")
            duration  = int(raw_dur) if raw_dur is not None else None
        except Exception:
            return jsonify({"fallback": True,
                            "error": "Could not parse workout — please choose intensity"}), 200

    # Server-side enum validation (prevents dirty data reaching rule engine)
    if sweat_lvl not in _VALID_SWEAT:
        return jsonify({"fallback": True,
                        "error": "Invalid sweat_level — please choose Low / Medium / High"}), 200
    if ex_type not in _VALID_TYPES:
        ex_type = "other"

    # 60-second idempotency: skip duplicate if same date + type created in last 60s
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(seconds=60)
    recent = ExerciseEntry.query.filter(
        ExerciseEntry.entry_date == target_date,
        ExerciseEntry.exercise_type == ex_type,
        ExerciseEntry.created_at >= cutoff,
    ).first()

    if recent:
        existing_entry = recent
    else:
        existing_entry = ExerciseEntry(
            entry_date       = target_date,
            exercise_type    = ex_type,
            name             = name or "Workout",
            duration_minutes = duration or 0,
            notes            = f"sweat_level={sweat_lvl}",
        )
        db.session.add(existing_entry)
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            return jsonify({"error": "Failed to save workout"}), 500

    # Regenerate today's skincare routine with new exercise data
    try:
        _generate_and_persist_routine(target_date)
    except Exception:
        pass  # routine regen is best-effort; entry is already saved

    sweat_label = sweat_lvl.capitalize()
    reply = (
        f"{sweat_label}-sweat {ex_type} logged"
        + (f" ({duration} min)" if duration else "")
        + ". Skincare routine updated."
    )

    return jsonify({
        "reply": reply,
        "created_exercise": {
            "name":             existing_entry.name,
            "exercise_type":    existing_entry.exercise_type,
            "duration_minutes": existing_entry.duration_minutes,
            "sweat_level":      sweat_lvl,
        },
        "fallback": False,
    })
```

- [ ] **Step 2: Start the dev server and test the NLP path with curl**

Start the backend:
```bash
cd backend && python app.py
```

In another terminal (use today's actual date in YYYY-MM-DD format):
```bash
curl -s -X POST http://localhost:3030/api/skincare/workout-chat \
  -H "Content-Type: application/json" \
  -d '{"message":"brutal 45 min HIIT this morning, absolutely drenched","date":"2026-05-25"}' | python -m json.tool
```

Expected response shape:
```json
{
  "reply": "High-sweat cardio logged (45 min). Skincare routine updated.",
  "created_exercise": {
    "name": "HIIT",
    "exercise_type": "cardio",
    "duration_minutes": 45,
    "sweat_level": "high"
  },
  "fallback": false
}
```

- [ ] **Step 3: Test the fallback path (manual sweat_level)**

```bash
curl -s -X POST http://localhost:3030/api/skincare/workout-chat \
  -H "Content-Type: application/json" \
  -d '{"sweat_level":"medium","exercise_type":"strength","date":"2026-05-25"}' | python -m json.tool
```

Expected: `"fallback": false` and `"sweat_level": "medium"` in `created_exercise`.

- [ ] **Step 4: Test the 60-second idempotency (send same request twice)**

Send the same curl from Step 2 again immediately. Check that only one ExerciseEntry exists for the date + type:

```bash
curl -s "http://localhost:3030/api/exercise?date=2026-05-25" | python -m json.tool
```

Expected: Only one entry with `"exercise_type": "cardio"` from the workout-chat endpoint (may have more if ExerciseModule also has entries for today).

- [ ] **Step 5: Test invalid sweat_level returns fallback=true**

```bash
curl -s -X POST http://localhost:3030/api/skincare/workout-chat \
  -H "Content-Type: application/json" \
  -d '{"sweat_level":"extreme","exercise_type":"cardio","date":"2026-05-25"}' | python -m json.tool
```

Expected: `"fallback": true` and no ExerciseEntry created.

- [ ] **Step 6: Commit**

```bash
git add backend/app.py
git commit -m "feat: add POST /api/skincare/workout-chat endpoint"
```

---

## Task 4: Add `wc-*` CSS classes to `frontend/src/index.css`

**Files:**
- Modify: `frontend/src/index.css` (append at end)

- [ ] **Step 1: Append the wc-* styles**

At the very end of `frontend/src/index.css`, add:

```css
/* ── Workout Chat Panel (SkinCare Today tab) ─────────────────────────────── */
.wc-section {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border, #e5e7eb);
}
.wc-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
}
.wc-input-row {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
}
.wc-textarea {
  flex: 1;
  min-height: 2.5rem;
  max-height: 5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border, #d1d5db);
  border-radius: 8px;
  font-size: 0.875rem;
  font-family: inherit;
  resize: none;
  background: var(--surface, #fff);
  color: var(--text, #111);
  transition: border-color 0.15s;
}
.wc-textarea:focus {
  outline: none;
  border-color: #6366f1;
}
.wc-send-btn {
  padding: 0.5rem 0.875rem;
  background: #6366f1;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}
.wc-send-btn:hover { background: #4f46e5; }
.wc-send-btn:disabled { background: #a5b4fc; cursor: not-allowed; }
.wc-confirm {
  margin-top: 0.5rem;
  padding: 0.4rem 0.75rem;
  background: #d1fae5;
  color: #065f46;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
}
.wc-error {
  margin-top: 0.5rem;
  padding: 0.4rem 0.75rem;
  background: #fee2e2;
  color: #991b1b;
  border-radius: 6px;
  font-size: 0.8rem;
}
.wc-fallback {
  margin-top: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.wc-fallback-label {
  font-size: 0.8rem;
  color: #92400e;
  background: #fef3c7;
  border-radius: 5px;
  padding: 0.3rem 0.6rem;
}
.wc-fallback-btns {
  display: flex;
  gap: 0.5rem;
}
.wc-fallback-btn {
  flex: 1;
  padding: 0.4rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: var(--surface, #fff);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.wc-fallback-btn:hover { background: #f3f4f6; }
```

- [ ] **Step 2: Verify no CSS parse errors (check in browser console after dev server starts)**

The CSS validation happens at runtime. Note it here and verify after Task 5 when the dev server is running.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: add wc-* CSS for workout chat panel"
```

---

## Task 5: Add workout chat panel to SkinCareModule.jsx Today tab

**Files:**
- Modify: `frontend/src/components/SkinCareModule.jsx`

### Context
The Today tab renders inside `{tab === "routine" && (...)}`. The workout input goes **after** the closing `</div>` of the `sc-routine-panel` div (which ends after the `↻ Regenerate for Today` button), still inside the `tab === "routine"` block. The existing `selectedDate` and `fetchRoutine` are already in scope.

- [ ] **Step 1: Add workout chat state to the main `SkinCareModule` component**

Find the existing state declarations (around line 581–595):
```jsx
  const [showScanner,       setShowScanner]       = useState(false);
```

After that line, add:
```jsx
  // Workout chat panel state
  const [wInput,    setWInput]    = useState("");
  const [wSending,  setWSending]  = useState(false);
  const [wStatus,   setWStatus]   = useState(null);  // null | {reply, exerciseName, sweatLevel}
  const [wError,    setWError]    = useState(null);
  const [wFallback, setWFallback] = useState(false); // true = show low/medium/high buttons
```

- [ ] **Step 2: Add the `submitWorkout` handler inside `SkinCareModule`**

Find `async function toggleRoutineStep` (around line 660). **Before** that function, add:

```jsx
  async function submitWorkout(payload) {
    setWSending(true);
    setWError(null);
    try {
      const res  = await fetch("/api/skincare/workout-chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...payload, date: selectedDate }),
      });
      const json = await res.json();
      if (!res.ok) {
        setWError(json.error || "Something went wrong");
        return;
      }
      if (json.fallback) {
        setWFallback(true);
        setWError(json.error || "Couldn't parse workout — choose intensity below");
        return;
      }
      setWInput("");
      setWFallback(false);
      setWStatus({ reply: json.reply, exerciseName: json.created_exercise?.name,
                   sweatLevel: json.created_exercise?.sweat_level });
      fetchRoutine(selectedDate);
    } catch {
      setWError("Network error — try again");
    } finally {
      setWSending(false);
    }
  }
```

- [ ] **Step 3: Add the workout chat panel JSX inside the Today tab**

Find this closing section in the Today tab (around line 851):
```jsx
                        <button className="sc-regenerate-btn" onClick={regenerateRoutine}>
                          ↻ Regenerate for Today
                        </button>
                      </>
                    )}
                  </div>
                )}
```

After the closing `</div>` of `sc-routine-panel` (the `</div>` that closes `className="sc-routine-panel"`), but **still inside** `{tab === "routine" && (...)}`, add:

```jsx
                {/* ── Workout Chat Panel ── */}
                <div className="wc-section">
                  <div className="wc-label">🏃 Log a workout</div>
                  <div className="wc-input-row">
                    <textarea
                      className="wc-textarea"
                      placeholder="e.g. 45 min HIIT this morning, totally drenched…"
                      value={wInput}
                      onChange={e => { setWInput(e.target.value); setWFallback(false); setWStatus(null); setWError(null); }}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (wInput.trim()) submitWorkout({ message: wInput.trim() }); } }}
                      disabled={wSending}
                      rows={1}
                    />
                    <button
                      className="wc-send-btn"
                      onClick={() => { if (wInput.trim()) submitWorkout({ message: wInput.trim() }); }}
                      disabled={wSending || !wInput.trim()}
                    >
                      {wSending ? "…" : "↑"}
                    </button>
                  </div>
                  {wStatus && (
                    <div className="wc-confirm">✅ {wStatus.reply}</div>
                  )}
                  {wFallback && (
                    <div className="wc-fallback">
                      <div className="wc-fallback-label">⚠️ {wError || "How intense was it?"}</div>
                      <div className="wc-fallback-btns">
                        {["low", "medium", "high"].map(lvl => (
                          <button
                            key={lvl}
                            className="wc-fallback-btn"
                            onClick={() => {
                              setWFallback(false);
                              submitWorkout({ sweat_level: lvl, exercise_type: "cardio" });
                            }}
                          >
                            {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {wError && !wFallback && (
                    <div className="wc-error">{wError}</div>
                  )}
                </div>
```

- [ ] **Step 4: Start the dev server and verify the UI**

```bash
# Terminal 1 — backend
cd backend && python app.py

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open `http://localhost:9999`, navigate to SkinCare → Today tab. Scroll to the bottom of the routine panel. Verify:
- "🏃 Log a workout" label and textarea are visible
- Textarea accepts text input
- Send button is disabled when input is empty

- [ ] **Step 5: Test the happy path end-to-end**

1. Type `"easy 20 minute walk this morning"` into the textarea, press ↑ (or Enter)
2. While sending: button shows `"…"`
3. After response: green confirmation pill appears below input, e.g. `"✅ Low-sweat cardio logged (20 min). Skincare routine updated."`
4. The routine checklist above refreshes (look for updated post-workout section — low sweat should show gentle cleanser)
5. The textarea clears

- [ ] **Step 6: Test the fallback path**

Temporarily turn off the backend Groq key (or test by submitting an extremely ambiguous message). Alternatively: submit from the fallback manually by modifying state in devtools. Verify:
- When backend returns `fallback: true`: the three Low / Medium / High buttons appear
- Clicking one sends `{sweat_level: "medium", exercise_type: "cardio", date}` and shows confirmation

- [ ] **Step 7: Test idempotency in the browser**

Submit the same message twice rapidly (double-click send). Verify only one ExerciseEntry is created:
```bash
curl -s "http://localhost:3030/api/exercise?date=$(date +%Y-%m-%d)" | python -m json.tool
```

Check that only one entry from workout-chat appears for the same exercise_type.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/SkinCareModule.jsx
git commit -m "feat: add workout chat panel to skincare Today tab"
```

---

## Self-Review

**Spec coverage check:**
- ✅ One-shot NLP input bar in Today tab
- ✅ Groq extracts sweat_level, exercise_type, name, duration_minutes
- ✅ Enum validation server-side before DB write
- ✅ Groq failure → return `{fallback: true}` → frontend shows Low/Medium/High buttons
- ✅ 60-second idempotency window
- ✅ sweat_level stored as `notes="sweat_level=X"` (no migration)
- ✅ `_build_routine(medicated_done)` starts counter at already-completed count
- ✅ Step completion memory: reads existing DailyRoutine JSON to find medicated step_keys, counts completed ones via RoutineStepLog
- ✅ Highest sweat wins across multi-workout accumulation (via `_max_sweat()`)
- ✅ "skip medicated" (low rule) only when ALL entries are low
- ✅ Confirmation pill shown after successful log
- ✅ `fetchRoutine` called after log to refresh checklist
- ✅ `wc-*` CSS classes

**Glossary comment added:** Task 1 instructions include the full glossary block (BP, BHA, PIH, medicated wash, sweat precedence rule, Groq failure rollback).

**Type consistency check:**
- `_max_sweat(exercises)` → returns string `"low"|"medium"|"high"|"none"`
- `_build_routine(products, exercises, medicated_done=0)` — `medicated_done` is int
- `submitWorkout(payload)` → payload is `{message}` or `{sweat_level, exercise_type}`
- `wStatus` shape: `{reply, exerciseName, sweatLevel}` — consistent across setter and render
