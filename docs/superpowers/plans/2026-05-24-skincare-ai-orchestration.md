# Skincare AI Orchestration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual AM/PM skincare checklist with a 3-layer AI-orchestrated daily routine driven by a photo-based product inventory and today's workout log.

**Architecture:** Layer 1 — Claude vision extracts product data once at upload (never re-scanned). Layer 2 — deterministic Python rule engine builds the daily routine from structured inventory + workout data, persisted to `daily_routines` table. Layer 3 — React UI reads the persisted routine idempotently; no LLM calls at render time.

**Tech Stack:** Python Flask, SQLAlchemy, Claude Sonnet 4.6 (vision for product scan; text for 2-sentence explanation only), React, SQLite on Fly.io. Persistent volume already confirmed at `/data` in `fly.toml`.

**Council-mandated constraints:**
- Hardcoded dermatological rules live in Python code — never in a prompt.
- Claude runs exactly twice per product lifetime (scan) and once per day (explanation).
- Routine must be persisted and restored on reload — regeneration-on-open is forbidden.
- A non-dismissible disclaimer must appear in the routine UI on every render.
- No outcome-tracking feedback loop in this plan — deferred to a future iteration.

---

## Pre-flight Checks (verify before Task 1)

- [ ] `fly.toml` has `[[mounts]]` with `source = "life_tracker_data"` and `destination = "/data"` — already confirmed ✅
- [ ] `ExerciseEntry` in `backend/models.py` uses `exercise_type` with values `"cardio"`, `"strength"`, `"flexibility"`, `"sports"`, `"other"`. Time-of-day comes from `created_at` (DateTime). — confirmed ✅
- [ ] `_strip_json_fences()` helper already exists in `backend/app.py` — confirmed ✅
- [ ] `json` already imported in `backend/app.py` line 2 — confirmed ✅

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/models.py` | Modify | Add SkinProduct, DailyRoutine, RoutineStepLog models |
| `backend/app.py` | Modify | Add product endpoints, rule engine, routine endpoints |
| `frontend/src/components/SkinProductScanner.jsx` | Create | Photo → AI review → save modal |
| `frontend/src/components/SkinCareModule.jsx` | Modify | Replace AM/PM tabs with Today + Products tabs |
| `frontend/src/index.css` | Modify | CSS for new components |

---

## Task 1: Database Models

**Files:**
- Modify: `backend/models.py` (append after the `ScannedProduct` class at the end of file)
- Modify: `backend/app.py` line 12 (models import line)

- [ ] **Step 1: Append three new models to `backend/models.py`**

Add this block at the very end of `backend/models.py`:

```python
class SkinProduct(db.Model):
    """User's skincare product inventory — scanned once via Claude vision, never re-scanned."""
    __tablename__ = "skin_products"

    id                 = db.Column(db.Integer,     primary_key=True, autoincrement=True)
    product_name       = db.Column(db.String(200), nullable=False)
    brand              = db.Column(db.String(100), nullable=True)
    product_type       = db.Column(db.String(50),  nullable=False, default="other")
    # product_type values: medicated_wash | gentle_wash | moisturizer | sunscreen | heavy_occlusive | treatment | other
    active_ingredients = db.Column(db.Text,        nullable=True)   # comma-separated string
    face_safe          = db.Column(db.Boolean,     nullable=False,  default=True)
    ai_summary         = db.Column(db.Text,        nullable=True)
    photo_data         = db.Column(db.LargeBinary, nullable=True)
    photo_mime         = db.Column(db.String(20),  nullable=False,  default="image/jpeg")
    created_at         = db.Column(db.DateTime,    default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id":                 self.id,
            "product_name":       self.product_name,
            "brand":              self.brand,
            "product_type":       self.product_type,
            "active_ingredients": self.active_ingredients,
            "face_safe":          self.face_safe,
            "ai_summary":         self.ai_summary,
            "has_photo":          self.photo_data is not None,
            "created_at":         self.created_at.isoformat(),
        }


class DailyRoutine(db.Model):
    """Generated skincare routine for a date — persisted for idempotent rendering (Layer 3)."""
    __tablename__ = "daily_routines"

    id              = db.Column(db.Integer,  primary_key=True, autoincrement=True)
    routine_date    = db.Column(db.Date,     nullable=False, unique=True, index=True)
    routine_json    = db.Column(db.Text,     nullable=False)   # JSON string
    explanation     = db.Column(db.Text,     nullable=True)    # Claude's 2-sentence explanation
    workout_context = db.Column(db.Text,     nullable=True)    # snapshot of exercise data used
    generated_at    = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "routine_date":    self.routine_date.isoformat(),
            "routine":         json.loads(self.routine_json),
            "explanation":     self.explanation,
            "workout_context": self.workout_context,
            "generated_at":    self.generated_at.isoformat(),
        }


class RoutineStepLog(db.Model):
    """Per-step completion state for daily AI routines — keyed by date + step_key."""
    __tablename__ = "routine_step_logs"

    id           = db.Column(db.Integer,    primary_key=True, autoincrement=True)
    log_date     = db.Column(db.Date,       nullable=False, index=True)
    step_key     = db.Column(db.String(50), nullable=False)   # e.g. "morning_0", "post_workout_1"
    completed    = db.Column(db.Boolean,    nullable=False, default=False)
    completed_at = db.Column(db.DateTime,   nullable=True)

    __table_args__ = (
        db.UniqueConstraint("log_date", "step_key", name="uq_routine_step_log"),
    )

    def to_dict(self):
        return {
            "log_date":     self.log_date.isoformat(),
            "step_key":     self.step_key,
            "completed":    self.completed,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }
```

- [ ] **Step 2: Add new models to the import line in `backend/app.py`**

The current line 12 ends with `..., ScannedProduct`. Change it to:

```python
from models import db, SleepEntry, AICache, FoodEntry, Task, Habit, HabitLog, MoodEntry, ExerciseEntry, HydrationLog, MealTemplate, MealTemplateItem, ExerciseTemplate, ExerciseTemplateItem, WeightEntry, WeeklyReview, Chore, ChoreLog, BodyMeasurement, WeeklyPlan, Supplement, SupplementLog, ScreenTimeEntry, UserProfile, SkincareLog, SkinCareStep, SkinCareStepLog, SkinConditionLog, SkinPhotoAnalysis, ScannedProduct, SkinProduct, DailyRoutine, RoutineStepLog
```

- [ ] **Step 3: Verify tables auto-create**

```bash
cd backend && python -c "from app import app, db; app.app_context().__enter__(); db.create_all(); print('OK — tables created')"
```

Expected output: `OK — tables created` with no errors or tracebacks.

- [ ] **Step 4: Commit**

```bash
git add backend/models.py backend/app.py
git commit -m "feat: add SkinProduct, DailyRoutine, RoutineStepLog models"
```

---

## Task 2: Product Endpoints (Ingest, CRUD, Photo)

**Files:**
- Modify: `backend/app.py` (add after the existing skincare routes block, around line 3050)

- [ ] **Step 1: Add the product type constant and all product endpoints**

Find the comment `# Skincare Routes` in `backend/app.py` (around line 2696). After the last existing skincare route (around line 3050), append:

```python
# ── Skin Product Inventory ─────────────────────────────────────────────────

SKIN_PRODUCT_TYPES = (
    "medicated_wash", "gentle_wash", "moisturizer",
    "sunscreen", "heavy_occlusive", "treatment", "other",
)


@app.route("/api/skincare/products/scan", methods=["POST"])
def scan_skin_product():
    """Layer 1: Claude vision — runs once per product at upload time, never again."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "AI not available"}), 503
    data = request.get_json(force=True) or {}
    img  = data.get("image")
    mime = data.get("mime_type", "image/jpeg")
    if not img:
        return jsonify({"error": "image required"}), 400

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    prompt = (
        "You are analyzing a skincare product label photo. "
        "Extract product information and return ONLY a valid JSON object — no markdown, no fences.\n\n"
        "Schema:\n"
        '{"product_name": "full product name as printed on label",\n'
        ' "brand": "brand name or null if not visible",\n'
        ' "product_type": "one of: medicated_wash | gentle_wash | moisturizer | sunscreen | heavy_occlusive | treatment | other",\n'
        ' "active_ingredients": "comma-separated list of active ingredients with % concentrations if visible, or null",\n'
        ' "face_safe": true,\n'
        ' "ai_summary": "1-2 sentence description of what this product does and its primary benefit",\n'
        ' "confidence": "high | medium | low"}\n\n'
        "Set face_safe to false if: the product is a heavy body cream, contains high petrolatum/mineral oil intended for body/hand use, "
        "or the label explicitly states it is not for face use.\n"
        "If the label is unclear, set confidence to 'low' and give your best estimate for all fields."
    )
    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=512,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": mime, "data": img}},
                    {"type": "text", "text": prompt},
                ],
            }],
        )
        raw    = resp.content[0].text.strip()
        result = json.loads(_strip_json_fences(raw))
        ptype  = result.get("product_type", "other")
        result["product_type"] = ptype if ptype in SKIN_PRODUCT_TYPES else "other"
        result["face_safe"]    = bool(result.get("face_safe", True))
        return jsonify(result)
    except json.JSONDecodeError:
        return jsonify({"error": "AI returned invalid JSON", "raw": raw[:300]}), 500
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/skincare/products", methods=["GET"])
def list_skin_products():
    products = SkinProduct.query.order_by(SkinProduct.created_at.desc()).all()
    return jsonify([p.to_dict() for p in products])


@app.route("/api/skincare/products", methods=["POST"])
def create_skin_product():
    data  = request.get_json(force=True) or {}
    name  = str(data.get("product_name") or "").strip()[:200]
    if not name:
        return jsonify({"error": "product_name required"}), 400
    ptype = data.get("product_type", "other")
    if ptype not in SKIN_PRODUCT_TYPES:
        ptype = "other"

    photo_data = None
    photo_b64  = data.get("photo_b64")
    photo_mime = data.get("photo_mime", "image/jpeg")
    if photo_b64:
        import base64
        try:
            photo_data = base64.b64decode(photo_b64)
        except Exception:
            pass

    product = SkinProduct(
        product_name       = name,
        brand              = str(data.get("brand") or "")[:100] or None,
        product_type       = ptype,
        active_ingredients = str(data.get("active_ingredients") or "")[:500] or None,
        face_safe          = bool(data.get("face_safe", True)),
        ai_summary         = str(data.get("ai_summary") or "")[:1000] or None,
        photo_data         = photo_data,
        photo_mime         = photo_mime,
    )
    db.session.add(product)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": str(exc)}), 500
    return jsonify(product.to_dict()), 201


@app.route("/api/skincare/products/<int:product_id>", methods=["PATCH"])
def update_skin_product(product_id):
    product = SkinProduct.query.get_or_404(product_id)
    data    = request.get_json(force=True) or {}
    if "product_name" in data:
        v = str(data["product_name"]).strip()[:200]
        if v:
            product.product_name = v
    if "brand" in data:
        product.brand = str(data["brand"])[:100] or None
    if "product_type" in data:
        ptype = data["product_type"]
        product.product_type = ptype if ptype in SKIN_PRODUCT_TYPES else "other"
    if "active_ingredients" in data:
        product.active_ingredients = str(data["active_ingredients"])[:500] or None
    if "face_safe" in data:
        product.face_safe = bool(data["face_safe"])
    if "ai_summary" in data:
        product.ai_summary = str(data["ai_summary"])[:1000] or None
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": str(exc)}), 500
    return jsonify(product.to_dict())


@app.route("/api/skincare/products/<int:product_id>", methods=["DELETE"])
def delete_skin_product(product_id):
    product = SkinProduct.query.get_or_404(product_id)
    db.session.delete(product)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": str(exc)}), 500
    return jsonify({"ok": True})


@app.route("/api/skincare/products/<int:product_id>/photo", methods=["GET"])
def get_skin_product_photo(product_id):
    product = SkinProduct.query.get_or_404(product_id)
    if not product.photo_data:
        return jsonify({"error": "No photo"}), 404
    return Response(product.photo_data, mimetype=product.photo_mime)
```

- [ ] **Step 2: Smoke-test product endpoints**

Start Flask: `cd backend && python app.py`

```bash
# List (empty)
curl http://localhost:5000/api/skincare/products
# Expected: []

# Create
curl -X POST http://localhost:5000/api/skincare/products \
  -H "Content-Type: application/json" \
  -d '{"product_name":"CeraVe Acne Control Cleanser","brand":"CeraVe","product_type":"medicated_wash","active_ingredients":"2% Salicylic Acid","face_safe":true}'
# Expected: {"id":1,"product_name":"CeraVe Acne Control Cleanser",...}

# Patch
curl -X PATCH http://localhost:5000/api/skincare/products/1 \
  -H "Content-Type: application/json" \
  -d '{"ai_summary":"BHA cleanser for acne-prone skin."}'
# Expected: product with ai_summary set

# Delete
curl -X DELETE http://localhost:5000/api/skincare/products/1
# Expected: {"ok":true}
```

- [ ] **Step 3: Commit**

```bash
git add backend/app.py
git commit -m "feat: add skin product inventory endpoints (scan, CRUD, photo)"
```

---

## Task 3: Rule Engine + Routine Endpoints

**Files:**
- Modify: `backend/app.py` (add rule engine function + 4 routine routes, after product endpoints)

- [ ] **Step 1: Add the deterministic rule engine function**

Append immediately after the product endpoint block:

```python
# ── Skincare Routine Rule Engine (Layer 2 — deterministic, no LLM) ─────────

_CARDIO_TYPES  = {"cardio", "sports"}
_STRENGTH_TYPES = {"strength"}
_MAX_MEDICATED  = 2   # max medicated washes per 24-hour cycle


def _build_routine(products, exercises):
    """
    Pure deterministic routine builder. No I/O, no LLM, no side effects.

    products:  list of SkinProduct ORM objects (ALL products — include face-unsafe for alerts)
    exercises: list of ExerciseEntry ORM objects for the target date

    Returns dict with keys:
      sections: list of section dicts
      alerts:   list of alert strings

    Each section: {key, label, icon, steps, workout_context?}
    Each step:    {step_key, action, product_id, product_name, brand, product_type, reason}
    step_key format: "{section_key}_{zero_based_index}"  e.g. "morning_0", "post_workout_1"
    """
    face_safe = [p for p in products if p.face_safe]

    def first(ptype):
        return next((p for p in face_safe if p.product_type == ptype), None)

    def all_of(ptype):
        return [p for p in face_safe if p.product_type == ptype]

    medicated_list = all_of("medicated_wash")
    gentle         = first("gentle_wash")
    moisturizer    = first("moisturizer")
    sunscreen      = first("sunscreen")

    cardio_today   = [e for e in exercises if e.exercise_type in _CARDIO_TYPES]
    strength_today = [e for e in exercises if e.exercise_type in _STRENGTH_TYPES]
    has_workout    = bool(exercises)

    med_used = [0]   # mutable via closure — tracks how many medicated washes assigned

    def _pick_cleanser(prefer=None):
        """Pick cleanser respecting medicated budget. prefer='bp'|'bha'|None."""
        if prefer == "bp" and med_used[0] < _MAX_MEDICATED:
            bp = next(
                (p for p in medicated_list
                 if p.active_ingredients and "benzoyl" in p.active_ingredients.lower()),
                medicated_list[0] if medicated_list else None,
            )
            if bp:
                med_used[0] += 1
                return bp
        if prefer == "bha" and med_used[0] < _MAX_MEDICATED:
            bha = next(
                (p for p in medicated_list
                 if p.active_ingredients and "salicylic" in p.active_ingredients.lower()),
                medicated_list[0] if medicated_list else None,
            )
            if bha:
                med_used[0] += 1
                return bha
        if medicated_list and med_used[0] < _MAX_MEDICATED:
            idx = min(med_used[0], len(medicated_list) - 1)
            med_used[0] += 1
            return medicated_list[idx]
        return gentle   # fallback (may be None)

    def _step(section_key, idx, action, product, reason):
        return {
            "step_key":     f"{section_key}_{idx}",
            "action":       action,
            "product_id":   product.id           if product else None,
            "product_name": product.product_name if product else None,
            "brand":        product.brand        if product else None,
            "product_type": product.product_type if product else None,
            "reason":       reason,
        }

    sections = []
    alerts   = []

    # ── Morning ────────────────────────────────────────────────────────────
    m = []
    if cardio_today:
        c = gentle
        reason = ("Light pre-workout cleanse — medicated wash reserved for post-cardio"
                  if c else "Water rinse only — medicated wash reserved for post-cardio")
        if c:
            m.append(_step("morning", 0, "Cleanse", c, reason))
    else:
        c = _pick_cleanser()
        if c:
            m.append(_step("morning", 0, "Cleanse", c, "Morning deep-pore cleanse"))
    if moisturizer:
        m.append(_step("morning", len(m), "Moisturize", moisturizer, "Barrier protection"))
    if sunscreen:
        m.append(_step("morning", len(m), "SPF", sunscreen, "Mandatory: UV exposure darkens PIH"))
        alerts.append("SPF is mandatory today — UV locks in hyperpigmentation")
    sections.append({"key": "morning", "label": "Morning", "icon": "🌅", "steps": m})

    # ── Post-Workout (only if workout logged today) ─────────────────────────
    if has_workout:
        pw = []
        if cardio_today:
            c = _pick_cleanser("bp")
            reason = ("Post-cardio rule: BP wash eliminates sweat-activated surface bacteria"
                      if c and c.product_type == "medicated_wash"
                      else "Medicated wash limit reached — gentle cleanse protects barrier")
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
        sections.append({"key": "post_workout", "label": "Post-Workout",
                          "icon": "💪", "steps": pw, "workout_context": ctx})

    # ── Evening ────────────────────────────────────────────────────────────
    ev = []
    c  = _pick_cleanser()
    if c and c.product_type == "medicated_wash":
        ev.append(_step("evening", 0, "Cleanse", c, "End-of-day pore clearing"))
    elif gentle:
        reason = ("Medicated wash limit reached — gentle end-of-day cleanse"
                  if med_used[0] >= _MAX_MEDICATED else "End-of-day cleanse")
        ev.append(_step("evening", 0, "Cleanse", gentle, reason))
    if moisturizer:
        ev.append(_step("evening", len(ev), "Moisturize", moisturizer, "Overnight barrier repair"))
    sections.append({"key": "evening", "label": "Evening", "icon": "🌙", "steps": ev})

    # ── Global alerts ──────────────────────────────────────────────────────
    if med_used[0] >= _MAX_MEDICATED:
        alerts.append("2 medicated washes assigned today — limit reached. Any extra shower: use gentle cleanser only.")
    for p in products:
        if not p.face_safe:
            alerts.append(f"{p.product_name} excluded from face routine — not face-safe.")

    return {"sections": sections, "alerts": alerts}
```

- [ ] **Step 2: Quick sanity-check the rule engine**

```bash
cd backend && python - <<'EOF'
from app import app, _build_routine
with app.app_context():
    result = _build_routine([], [])
    assert "sections" in result
    assert result["sections"][0]["key"] == "morning"
    assert result["sections"][-1]["key"] == "evening"
    print("Rule engine OK. Sections:", [s["key"] for s in result["sections"]])
EOF
```

Expected: `Rule engine OK. Sections: ['morning', 'evening']`

- [ ] **Step 3: Add the internal helper and routine endpoints**

Append after the rule engine function:

```python
# ── Routine Endpoint Helpers ───────────────────────────────────────────────

def _generate_and_persist_routine(target_date):
    """
    Layer 2 helper: run rule engine, call Claude for 2-sentence explanation,
    upsert DailyRoutine. Returns DailyRoutine ORM object.
    """
    products       = SkinProduct.query.all()
    exercises      = ExerciseEntry.query.filter_by(entry_date=target_date).all()
    routine_data   = _build_routine(products, exercises)
    workout_ctx    = (
        ", ".join(f"{e.exercise_type} ({e.created_at.strftime('%I:%M %p')})" for e in exercises)
        or "rest day"
    )

    explanation = None
    api_key     = os.environ.get("ANTHROPIC_API_KEY")
    if api_key and products:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)
            sections_summary = "; ".join(
                f"{s['label']}: " + ", ".join(
                    f"{st['action']} with {st['product_name'] or 'none'}"
                    for st in s["steps"]
                )
                for s in routine_data["sections"]
            )
            resp = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=200,
                messages=[{
                    "role": "user",
                    "content": (
                        f"Today's workout: {workout_ctx}.\n"
                        f"Generated routine: {sections_summary}.\n"
                        f"User goal: treat active breakouts and fade PIH.\n\n"
                        "Write exactly 2 sentences explaining WHY this routine was assembled this way today. "
                        "Be specific about which rules were triggered. Plain text only."
                    ),
                }],
            )
            explanation = resp.content[0].text.strip()
        except Exception:
            pass   # explanation is optional

    existing = DailyRoutine.query.filter_by(routine_date=target_date).first()
    if existing:
        existing.routine_json    = json.dumps(routine_data)
        existing.explanation     = explanation
        existing.workout_context = workout_ctx
        existing.generated_at    = datetime.utcnow()
    else:
        existing = DailyRoutine(
            routine_date    = target_date,
            routine_json    = json.dumps(routine_data),
            explanation     = explanation,
            workout_context = workout_ctx,
        )
        db.session.add(existing)
    db.session.commit()
    return existing


# ── Routine Routes ─────────────────────────────────────────────────────────

@app.route("/api/skincare/routine", methods=["GET"])
def get_skincare_routine():
    """
    Layer 3: return persisted routine for date.
    Generates one if none exists yet (first load).
    Merges step completion state from RoutineStepLog.
    """
    date_str = request.args.get("date") or date.today().isoformat()
    try:
        target_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "invalid date"}), 400

    routine_obj = DailyRoutine.query.filter_by(routine_date=target_date).first()
    if not routine_obj:
        if not SkinProduct.query.first():
            return jsonify({"routine": None, "message": "No products in inventory yet"}), 200
        routine_obj = _generate_and_persist_routine(target_date)

    routine_data = json.loads(routine_obj.routine_json)

    # Merge completion state (idempotent restore)
    step_logs = {
        log.step_key: log.completed
        for log in RoutineStepLog.query.filter_by(log_date=target_date).all()
    }
    for section in routine_data.get("sections", []):
        for step in section.get("steps", []):
            step["completed"] = step_logs.get(step["step_key"], False)

    return jsonify({
        "routine_date":    routine_obj.routine_date.isoformat(),
        "routine":         routine_data,
        "explanation":     routine_obj.explanation,
        "workout_context": routine_obj.workout_context,
        "generated_at":    routine_obj.generated_at.isoformat(),
    })


@app.route("/api/skincare/routine/generate", methods=["POST"])
def regenerate_skincare_routine():
    """Force-regenerate routine for a date (replaces persisted version)."""
    data     = request.get_json(force=True) or {}
    date_str = data.get("date") or date.today().isoformat()
    try:
        target_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "invalid date"}), 400
    if not SkinProduct.query.first():
        return jsonify({"error": "No products in inventory"}), 400
    obj = _generate_and_persist_routine(target_date)
    return jsonify({"ok": True, "generated_at": obj.generated_at.isoformat()})


@app.route("/api/skincare/routine/step-toggle", methods=["POST"])
def toggle_routine_step():
    """Toggle a step's completion. Idempotent — safe to call multiple times."""
    data     = request.get_json(force=True) or {}
    date_str = data.get("date") or date.today().isoformat()
    step_key = str(data.get("step_key") or "").strip()[:50]
    if not step_key:
        return jsonify({"error": "step_key required"}), 400
    try:
        target_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "invalid date"}), 400

    log = RoutineStepLog.query.filter_by(log_date=target_date, step_key=step_key).first()
    if log:
        log.completed    = not log.completed
        log.completed_at = datetime.utcnow() if log.completed else None
    else:
        log = RoutineStepLog(
            log_date     = target_date,
            step_key     = step_key,
            completed    = True,
            completed_at = datetime.utcnow(),
        )
        db.session.add(log)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": str(exc)}), 500
    return jsonify({"step_key": step_key, "completed": log.completed})
```

- [ ] **Step 4: Test the routine endpoints with curl**

Ensure Flask is running locally. First create a test product, then test the routine:

```bash
# Create a product
curl -s -X POST http://localhost:5000/api/skincare/products \
  -H "Content-Type: application/json" \
  -d '{"product_name":"Test Cleanser","product_type":"medicated_wash","active_ingredients":"salicylic acid","face_safe":true}' | python -m json.tool

# Get routine (auto-generates on first call)
curl -s "http://localhost:5000/api/skincare/routine?date=2026-05-24" | python -m json.tool
# Expected: sections with morning and evening

# Toggle a step (use the step_key from the response above, e.g. "morning_0")
curl -s -X POST http://localhost:5000/api/skincare/routine/step-toggle \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-05-24","step_key":"morning_0"}' | python -m json.tool
# Expected: {"step_key":"morning_0","completed":true}

# Get routine again — step should show completed:true
curl -s "http://localhost:5000/api/skincare/routine?date=2026-05-24" | python -m json.tool

# Force regenerate
curl -s -X POST http://localhost:5000/api/skincare/routine/generate \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-05-24"}' | python -m json.tool
# Expected: {"ok":true,"generated_at":"..."}
```

- [ ] **Step 5: Commit**

```bash
git add backend/app.py
git commit -m "feat: add skincare rule engine and routine generate/get/toggle endpoints"
```

---

## Task 4: SkinProductScanner React Component

**Files:**
- Create: `frontend/src/components/SkinProductScanner.jsx`

- [ ] **Step 1: Create `frontend/src/components/SkinProductScanner.jsx`**

```jsx
import React, { useState, useRef } from "react";

const PRODUCT_TYPES = [
  { value: "medicated_wash",  label: "Medicated Wash" },
  { value: "gentle_wash",     label: "Gentle Wash" },
  { value: "moisturizer",     label: "Moisturizer" },
  { value: "sunscreen",       label: "Sunscreen" },
  { value: "heavy_occlusive", label: "Heavy Occlusive" },
  { value: "treatment",       label: "Treatment" },
  { value: "other",           label: "Other" },
];

function compressImage(file) {
  return new Promise((resolve) => {
    const MAX_DIM = 1024;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w > h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
        else       { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const [header, b64] = e.target.result.split(",");
          const mime = header.match(/:(.*?);/)[1];
          resolve({ b64, mime, blob });
        };
        reader.readAsDataURL(blob);
      }, "image/jpeg", 0.82);
    };
    img.src = url;
  });
}

export default function SkinProductScanner({ onSaved, onClose }) {
  const [step,              setStep]              = useState("upload");
  const [image,             setImage]             = useState(null);
  const [productName,       setProductName]       = useState("");
  const [brand,             setBrand]             = useState("");
  const [productType,       setProductType]       = useState("other");
  const [activeIngredients, setActiveIngredients] = useState("");
  const [faceSafe,          setFaceSafe]          = useState(true);
  const [aiSummary,         setAiSummary]         = useState("");
  const [confidence,        setConfidence]        = useState(null);
  const [scanning,          setScanning]          = useState(false);
  const [saving,            setSaving]            = useState(false);
  const [error,             setError]             = useState(null);
  const fileRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    const compressed = await compressImage(file);
    const objectUrl  = URL.createObjectURL(compressed.blob);
    setImage({ ...compressed, objectUrl });
    setError(null);
    await analyze(compressed);
  }

  async function analyze(compressed) {
    setScanning(true);
    setStep("scanning");
    setError(null);
    try {
      const res  = await fetch("/api/skincare/products/scan", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ image: compressed.b64, mime_type: compressed.mime }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setProductName(data.product_name || "");
      setBrand(data.brand || "");
      setProductType(data.product_type || "other");
      setActiveIngredients(data.active_ingredients || "");
      setFaceSafe(data.face_safe !== false);
      setAiSummary(data.ai_summary || "");
      setConfidence(data.confidence || null);
      setStep("review");
    } catch (err) {
      setError(err.message);
      setStep("review");
    } finally {
      setScanning(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!productName.trim()) { setError("Product name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const res  = await fetch("/api/skincare/products", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          product_name:       productName.trim(),
          brand:              brand.trim() || null,
          product_type:       productType,
          active_ingredients: activeIngredients.trim() || null,
          face_safe:          faceSafe,
          ai_summary:         aiSummary.trim() || null,
          photo_b64:          image?.b64 || null,
          photo_mime:         image?.mime || "image/jpeg",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      onSaved(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function resetToUpload() {
    setStep("upload"); setImage(null);
    setProductName(""); setBrand(""); setProductType("other");
    setActiveIngredients(""); setFaceSafe(true); setAiSummary("");
    setConfidence(null); setError(null);
  }

  return (
    <div className="sps-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sps-sheet">
        <div className="sps-handle" />

        {step === "upload" && (
          <>
            <div className="sps-title">📷 Scan Product</div>
            <div className="sps-sub">Photograph the front label or ingredients panel</div>
            <div
              className="sps-dropzone"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
            >
              <span className="sps-dropzone-icon">📦</span>
              <div>Tap to take photo or choose from library</div>
              <div className="sps-dropzone-hint">Front label · Ingredients panel</div>
            </div>
            <input
              ref={fileRef} type="file" accept="image/*" capture="environment"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files[0])}
            />
            <button className="sps-btn-ghost" onClick={onClose} style={{ marginTop: 12 }}>Cancel</button>
          </>
        )}

        {step === "scanning" && (
          <div className="sps-scanning">
            <div className="sps-spinner">🔍</div>
            <div>Identifying product…</div>
          </div>
        )}

        {step === "review" && (
          <form onSubmit={handleSave}>
            <div className="sps-title">Review Product</div>
            <div className="sps-sub">AI identified the following — edit anything that's wrong</div>

            {confidence === "low" && (
              <div className="sps-confidence-warn">
                ⚠️ Low confidence scan — please verify all fields below
              </div>
            )}
            {image?.objectUrl && (
              <img src={image.objectUrl} className="sps-preview-img" alt="Product" />
            )}
            {error && <div className="sps-error">{error}</div>}

            <div className="sps-field">
              <label className="sps-label">Brand</label>
              <input className="sps-input" value={brand}
                onChange={(e) => setBrand(e.target.value)} placeholder="Brand name" />
            </div>
            <div className="sps-field">
              <label className="sps-label">Product Name *</label>
              <input className="sps-input" value={productName} required
                onChange={(e) => setProductName(e.target.value)} placeholder="Full product name" />
            </div>
            <div className="sps-field">
              <label className="sps-label">Product Type</label>
              <div className="sps-type-chips">
                {PRODUCT_TYPES.map((pt) => (
                  <button key={pt.value} type="button"
                    className={`sps-type-chip${productType === pt.value ? " sps-type-chip-active" : ""}`}
                    onClick={() => setProductType(pt.value)}>{pt.label}</button>
                ))}
              </div>
            </div>
            <div className="sps-field">
              <label className="sps-label">Active Ingredients</label>
              <input className="sps-input" value={activeIngredients}
                onChange={(e) => setActiveIngredients(e.target.value)}
                placeholder="e.g. 2% Salicylic Acid, Niacinamide" />
            </div>
            <div className="sps-field">
              <label className="sps-label">Face Safe?</label>
              <div className="sps-face-safe-row">
                <button type="button"
                  className={`sps-safe-btn${faceSafe ? " sps-safe-btn-yes" : ""}`}
                  onClick={() => setFaceSafe(true)}>✓ Safe for Face</button>
                <button type="button"
                  className={`sps-safe-btn${!faceSafe ? " sps-safe-btn-no" : ""}`}
                  onClick={() => setFaceSafe(false)}>🚫 Exclude from Face</button>
              </div>
            </div>
            {aiSummary && (
              <div className="sps-ai-summary">
                <span className="sps-ai-badge">AI</span> {aiSummary}
              </div>
            )}
            <div className="sps-actions">
              <button type="button" className="sps-btn-ghost" onClick={resetToUpload}>← Back</button>
              <button type="submit" className="sps-btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save to Inventory"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/SkinProductScanner.jsx
git commit -m "feat: add SkinProductScanner modal component"
```

---

## Task 5: Update SkinCareModule — Replace AM/PM with AI Routine + Products

**Files:**
- Modify: `frontend/src/components/SkinCareModule.jsx`

The existing module is 880 lines. This task makes surgical replacements to two sections:
(A) The state + handlers block (lines 580–738)
(B) The JSX inside the routine card (lines 785–855)

All other components (DateNavigator, ConditionWidget, HistoryStrip, StreakBadge, SkinAnalysisPanel, AIInsightsCard) remain unchanged.

- [ ] **Step 1: Add SkinProductScanner import at top of SkinCareModule.jsx**

Find line 1:
```jsx
import React, { useState, useEffect, useCallback, useRef } from "react";
```

Add the import immediately after:
```jsx
import SkinProductScanner from "./SkinProductScanner.jsx";
```

- [ ] **Step 2: Replace the state block (lines 580–590)**

Find and replace this exact block:
```jsx
  const [selectedDate, setSelectedDate] = useState(today);
  const [steps,        setSteps]        = useState([]);
  const [logMap,       setLogMap]       = useState({});
  const [condition,    setCondition]    = useState(null);
  const [history,      setHistory]      = useState([]);
  const [streak,       setStreak]       = useState(null);
  const [tab,          setTab]          = useState("am");
  const [loading,      setLoading]      = useState(true);
  const [addingStep,   setAddingStep]   = useState(false);
  const [newStepName,  setNewStepName]  = useState("");
  const addInputRef = useRef(null);
```

Replace with:
```jsx
  const [selectedDate,      setSelectedDate]      = useState(today);
  const [condition,         setCondition]         = useState(null);
  const [history,           setHistory]           = useState([]);
  const [streak,            setStreak]            = useState(null);
  const [tab,               setTab]               = useState("routine");
  const [loading,           setLoading]           = useState(true);
  // AI Routine
  const [routine,           setRoutine]           = useState(null);
  const [routineLoading,    setRoutineLoading]    = useState(false);
  const [routineError,      setRoutineError]      = useState(null);
  const [routineExplanation,setRoutineExplanation]= useState(null);
  // Products
  const [products,          setProducts]          = useState([]);
  const [productsLoading,   setProductsLoading]   = useState(false);
  const [showScanner,       setShowScanner]       = useState(false);
```

- [ ] **Step 3: Replace the fetch functions and useEffects (lines 592–644)**

Find and replace this entire block (from `const fetchSteps` through the three `useEffect` calls ending at line 644):

```jsx
  const fetchSteps = useCallback(async () => {
    ...
  }, []);
  ... (all four fetch functions)
  ... (three useEffects)
  useEffect(() => {
    if (addingStep) addInputRef.current?.focus();
  }, [addingStep]);
```

Replace with:
```jsx
  const fetchCondition = useCallback(async (d) => {
    const r    = await fetch(`/api/skincare/condition?date=${d}`);
    const data = await r.json();
    setCondition(data);
  }, []);

  const fetchHistory = useCallback(async () => {
    const r    = await fetch(`/api/skincare/history?days=14&date=${today}`);
    const data = await r.json();
    setHistory(Array.isArray(data) ? data : []);
  }, [today]);

  const fetchStreak = useCallback(async () => {
    const r    = await fetch(`/api/skincare/streak?date=${today}`);
    const data = await r.json();
    setStreak(data);
  }, [today]);

  const fetchRoutine = useCallback(async (d) => {
    setRoutineLoading(true);
    setRoutineError(null);
    try {
      const res  = await fetch(`/api/skincare/routine?date=${d}`);
      const data = await res.json();
      setRoutine(data.routine || null);
      setRoutineExplanation(data.explanation || null);
    } catch {
      setRoutineError("Failed to load routine");
    } finally {
      setRoutineLoading(false);
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const res  = await fetch("/api/skincare/products");
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch {}
    finally { setProductsLoading(false); }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchCondition(selectedDate),
      fetchHistory(),
      fetchStreak(),
    ]).finally(() => setLoading(false));
  }, [fetchCondition, fetchHistory, fetchStreak]); // eslint-disable-line

  useEffect(() => {
    fetchCondition(selectedDate);
  }, [selectedDate, fetchCondition]);

  useEffect(() => {
    if (tab === "routine") fetchRoutine(selectedDate);
    if (tab === "products") fetchProducts();
  }, [tab, selectedDate, fetchRoutine, fetchProducts]);
```

- [ ] **Step 4: Replace the handlers block (lines 646–715)**

Find and replace all handlers from `async function toggleStep` through `function handleAnalysisApplied`:

```jsx
  async function toggleStep(stepId, currentCompleted) { ... }
  async function saveProduct(stepId, product) { ... }
  async function renameStep(stepId, newName) { ... }
  async function deleteStep(stepId) { ... }
  async function addStep() { ... }
  function handleAddKey(e) { ... }
  function handleConditionChange(updated) { ... }
  function handleAnalysisApplied(updatedCondition) { ... }
```

Replace with:
```jsx
  async function toggleRoutineStep(stepKey) {
    const res = await fetch("/api/skincare/routine/step-toggle", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ date: selectedDate, step_key: stepKey }),
    });
    if (res.ok) {
      const { completed } = await res.json();
      setRoutine(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map(sec => ({
            ...sec,
            steps: sec.steps.map(st =>
              st.step_key === stepKey ? { ...st, completed } : st
            ),
          })),
        };
      });
    }
  }

  async function regenerateRoutine() {
    setRoutineLoading(true);
    try {
      await fetch("/api/skincare/routine/generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ date: selectedDate }),
      });
      await fetchRoutine(selectedDate);
    } catch {
      setRoutineError("Regeneration failed");
      setRoutineLoading(false);
    }
  }

  async function deleteProduct(id) {
    if (!window.confirm("Remove this product from inventory?")) return;
    await fetch(`/api/skincare/products/${id}`, { method: "DELETE" });
    setProducts(prev => prev.filter(p => p.id !== id));
  }

  function handleConditionChange(updated) {
    setCondition(updated);
    fetchHistory();
  }

  function handleAnalysisApplied(updatedCondition) {
    setCondition(updatedCondition);
    fetchHistory();
  }
```

- [ ] **Step 5: Remove derived state lines (lines 717–738)**

Find and delete this block entirely (it referenced steps/logMap/amSteps/pmSteps which are removed):
```jsx
  // ── Derived ───────────────────────────────────────────────────────────────
  const tabSteps   = steps.filter(s => s.time_of_day === tab);
  const amSteps    = ...
  const pmSteps    = ...
  const amDone     = ...
  const pmDone     = ...
  const amPct      = ...
  const pmPct      = ...
  const hasAnyData = ...
  const avgPct     = ...
  const statusColor = ...
  function stepEntry(s) { ... }
```

Replace the deleted block with just:
```jsx
  const routineDone = routine?.sections?.reduce(
    (n, s) => n + s.steps.filter(st => st.completed).length, 0
  ) ?? 0;
  const routineTotal = routine?.sections?.reduce(
    (n, s) => n + s.steps.length, 0
  ) ?? 0;
```

- [ ] **Step 6: Update the header brand-sub (line 752)**

Find:
```jsx
              <div className="brand-sub">
                AM {amDone}/{amSteps.length} · PM {pmDone}/{pmSteps.length}
              </div>
```

Replace with:
```jsx
              <div className="brand-sub">
                {routineTotal > 0 ? `${routineDone}/${routineTotal} steps done` : "AI Routine"}
              </div>
```

Also remove the `StatusDot` usage (line 758) if it referenced `statusColor` — replace `<StatusDot color={statusColor} />` with nothing (just delete that line), or keep `<StatusDot color="var(--text-dim)" />` as a placeholder.

- [ ] **Step 7: Replace the AM/PM card content (lines 785–855) in the JSX**

Find this entire block inside `<div className="card">` (after the `<DateNavigator ... />` element):

```jsx
                {/* AM/PM completion bars */}
                <div className="sc-completion-row">
                  ...
                </div>

                {/* AM/PM tab switcher */}
                <div className="sc-tab-row">
                  <button className={`sc-tab-btn${tab === "am" ? " sc-tab-active" : ""}`}
                    onClick={() => setTab("am")}>
                    ☀️ Morning Routine
                    {amPct === 100 && <span className="sc-tab-badge">✓</span>}
                  </button>
                  <button className={`sc-tab-btn${tab === "pm" ? " sc-tab-active" : ""}`}
                    onClick={() => setTab("pm")}>
                    🌙 Evening Routine
                    {pmPct === 100 && <span className="sc-tab-badge">✓</span>}
                  </button>
                </div>

                {/* Step checklist */}
                <div className="sc-step-list">
                  ...all the step rendering and add step form...
                </div>

                {/* Skin condition widget */}
                <ConditionWidget ... />
              </div>
```

Replace the block from `{/* AM/PM completion bars */}` through `</div>` (closing the card div, before `{/* ── Skin analysis */}`) with:

```jsx
                {/* Tab switcher */}
                <div className="sc-tab-row">
                  <button className={`sc-tab-btn${tab === "routine" ? " sc-tab-active" : ""}`}
                    onClick={() => setTab("routine")}>✨ Today</button>
                  <button className={`sc-tab-btn${tab === "products" ? " sc-tab-active" : ""}`}
                    onClick={() => setTab("products")}>🧴 Products</button>
                </div>

                {/* Disclaimer — permanent, non-dismissible */}
                <div className="sc-disclaimer">
                  Suggestions based on general dermatological patterns. Consult a dermatologist for your specific condition.
                </div>

                {/* TODAY'S ROUTINE */}
                {tab === "routine" && (
                  <div className="sc-routine-panel">
                    {routineLoading && <div className="sc-loading">Generating routine…</div>}
                    {routineError   && <div className="sc-error-msg">{routineError}</div>}
                    {!routineLoading && !routine && !routineError && (
                      <div className="sc-empty-routine">
                        <div className="sc-empty-icon">🧴</div>
                        <div>No products in inventory yet.</div>
                        <div className="sc-empty-hint">Add products in the Products tab to generate a routine.</div>
                      </div>
                    )}
                    {routine && (
                      <>
                        {routineExplanation && (
                          <div className="sc-explanation">{routineExplanation}</div>
                        )}
                        {routine.sections?.map(section => (
                          <div key={section.key} className="sc-routine-section">
                            <div className="sc-routine-section-header">
                              <span className="sc-routine-section-title">
                                {section.icon} {section.label}
                              </span>
                              {section.workout_context && (
                                <span className="sc-workout-badge">{section.workout_context}</span>
                              )}
                            </div>
                            {section.steps.map(step => (
                              <div
                                key={step.step_key}
                                className={`sc-routine-step${step.completed ? " sc-routine-step-done" : ""}`}
                                onClick={() => toggleRoutineStep(step.step_key)}
                              >
                                <div className={`sc-routine-check${step.completed ? " sc-routine-check-done" : ""}`}>
                                  {step.completed ? "✓" : ""}
                                </div>
                                <div className="sc-routine-step-body">
                                  <div className="sc-routine-step-action">{step.action}</div>
                                  {step.product_name && (
                                    <div className="sc-routine-step-product">
                                      {step.brand ? `${step.brand} · ` : ""}{step.product_name}
                                    </div>
                                  )}
                                  {step.reason && (
                                    <div className="sc-routine-step-reason">{step.reason}</div>
                                  )}
                                </div>
                                {step.product_id && (
                                  <img
                                    className="sc-routine-product-thumb"
                                    src={`/api/skincare/products/${step.product_id}/photo`}
                                    alt={step.product_name}
                                    onError={(e) => { e.target.style.display = "none"; }}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        ))}
                        {routine.alerts?.length > 0 && (
                          <div className="sc-alerts">
                            {routine.alerts.map((alert, i) => (
                              <div key={i} className="sc-alert-item">ℹ️ {alert}</div>
                            ))}
                          </div>
                        )}
                        <button className="sc-regenerate-btn" onClick={regenerateRoutine}>
                          ↻ Regenerate for Today
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* PRODUCTS */}
                {tab === "products" && (
                  <div className="sc-products-panel">
                    {showScanner && (
                      <SkinProductScanner
                        onSaved={(product) => {
                          setProducts(prev => [product, ...prev]);
                          setShowScanner(false);
                        }}
                        onClose={() => setShowScanner(false)}
                      />
                    )}
                    <button className="sc-add-product-btn" onClick={() => setShowScanner(true)}>
                      📷 Add Product
                    </button>
                    {productsLoading && <div className="sc-loading">Loading products…</div>}
                    {!productsLoading && products.length === 0 && (
                      <div className="sc-empty-products">
                        No products yet. Tap Add Product to scan your first product.
                      </div>
                    )}
                    <div className="sc-product-grid">
                      {products.map(p => (
                        <div key={p.id} className={`sc-product-card${p.face_safe ? "" : " sc-product-excluded"}`}>
                          {p.has_photo ? (
                            <img
                              className="sc-product-photo"
                              src={`/api/skincare/products/${p.id}/photo`}
                              alt={p.product_name}
                            />
                          ) : (
                            <div className="sc-product-photo sc-product-photo-placeholder">🧴</div>
                          )}
                          <div className="sc-product-info">
                            {p.brand && <div className="sc-product-brand">{p.brand}</div>}
                            <div className="sc-product-name">{p.product_name}</div>
                            <div className="sc-product-type">{p.product_type.replace(/_/g, " ")}</div>
                            {p.active_ingredients && (
                              <div className="sc-product-ingredients">{p.active_ingredients}</div>
                            )}
                            <div className={`sc-product-status${p.face_safe ? " sc-product-safe" : " sc-product-banned"}`}>
                              {p.face_safe ? "✓ Face safe" : "🚫 Face excluded"}
                            </div>
                          </div>
                          <button className="sc-product-del" onClick={() => deleteProduct(p.id)} title="Remove">✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Skin condition widget */}
                <ConditionWidget
                  date={selectedDate}
                  condition={condition}
                  onChange={handleConditionChange}
                />
              </div>
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/SkinCareModule.jsx
git commit -m "feat: replace AM/PM steps with AI routine + products tabs in SkinCareModule"
```

---

## Task 6: CSS

**Files:**
- Modify: `frontend/src/index.css` (append at end of file)

- [ ] **Step 1: Append CSS to `frontend/src/index.css`**

Append the following block at the very end of `frontend/src/index.css`:

```css
/* ═══════════════════════════════════════════════════════════════
   Skincare AI — SkinProductScanner modal
═══════════════════════════════════════════════════════════════ */

.sps-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
  display: flex; align-items: flex-end; justify-content: center; z-index: 200;
}
.sps-sheet {
  width: 100%; max-width: 440px;
  background: var(--bg-card); border-radius: 16px 16px 0 0;
  border-top: 1px solid var(--border);
  padding: 20px 16px 36px; max-height: 90vh; overflow-y: auto;
}
.sps-handle {
  width: 36px; height: 4px; border-radius: 2px;
  background: var(--border); margin: 0 auto 16px;
}
.sps-title { font-size: 17px; font-weight: 700; margin-bottom: 4px; }
.sps-sub   { font-size: 12px; color: var(--text-muted); margin-bottom: 14px; }
.sps-dropzone {
  background: var(--bg-elevated); border: 2px dashed var(--border);
  border-radius: 10px; padding: 28px 16px; text-align: center;
  color: var(--text-muted); font-size: 13px; cursor: pointer; margin-bottom: 12px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  transition: border-color 0.15s;
}
.sps-dropzone:hover { border-color: var(--accent); }
.sps-dropzone-icon  { font-size: 32px; }
.sps-dropzone-hint  { font-size: 11px; }
.sps-scanning {
  padding: 40px 0; text-align: center; color: var(--text-dim);
  font-size: 14px; display: flex; flex-direction: column; align-items: center; gap: 12px;
}
.sps-spinner { font-size: 32px; animation: sps-spin 1.5s linear infinite; }
@keyframes sps-spin { to { transform: rotate(360deg); } }
.sps-confidence-warn {
  background: rgba(240,160,48,0.1); border-left: 3px solid var(--warning);
  color: var(--warning); font-size: 12px; padding: 8px 12px;
  border-radius: 0 6px 6px 0; margin-bottom: 12px;
}
.sps-preview-img {
  width: 80px; height: 80px; object-fit: cover; border-radius: 10px;
  border: 1px solid var(--border); margin-bottom: 14px; display: block;
}
.sps-field { margin-bottom: 12px; }
.sps-label {
  display: block; font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 4px;
}
.sps-input {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: 6px; padding: 7px 10px; color: var(--text-primary); font-size: 13px;
}
.sps-input:focus { border-color: var(--accent); outline: none; }
.sps-type-chips  { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.sps-type-chip {
  padding: 4px 10px; border-radius: 12px; font-size: 11px; cursor: pointer;
  background: var(--bg-elevated); color: var(--text-dim);
  border: 1px solid var(--border); transition: all 0.1s;
}
.sps-type-chip-active {
  background: var(--accent); color: #0d1117; border-color: var(--accent);
}
.sps-face-safe-row { display: flex; gap: 8px; margin-top: 6px; }
.sps-safe-btn {
  flex: 1; padding: 8px; border-radius: 8px; font-size: 12px; cursor: pointer;
  background: var(--bg-elevated); color: var(--text-dim);
  border: 1px solid var(--border); transition: all 0.1s;
}
.sps-safe-btn-yes { background: rgba(63,185,80,0.15);  color: #3fb950;          border-color: rgba(63,185,80,0.3); }
.sps-safe-btn-no  { background: rgba(248,81,73,0.15);  color: var(--danger);    border-color: rgba(248,81,73,0.3); }
.sps-ai-summary {
  font-size: 12px; color: var(--text-dim); background: var(--bg-elevated);
  border-radius: 6px; padding: 8px 10px; margin-bottom: 12px;
  display: flex; gap: 8px; align-items: flex-start;
}
.sps-ai-badge {
  font-size: 9px; background: var(--accent); color: #0d1117;
  padding: 2px 5px; border-radius: 4px; font-weight: 700; flex-shrink: 0; margin-top: 1px;
}
.sps-error {
  color: var(--danger); font-size: 12px; margin-bottom: 10px;
  background: rgba(248,81,73,0.1); border-radius: 6px; padding: 8px 10px;
}
.sps-actions     { display: flex; gap: 8px; margin-top: 16px; }
.sps-btn-primary {
  flex: 1; padding: 11px; border-radius: 8px;
  background: var(--accent); color: #0d1117; border: none;
  cursor: pointer; font-size: 13px; font-weight: 600;
}
.sps-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.sps-btn-ghost {
  padding: 11px 16px; border-radius: 8px; background: none;
  color: var(--text-dim); border: 1px solid var(--border);
  cursor: pointer; font-size: 13px;
}

/* ═══════════════════════════════════════════════════════════════
   Skincare AI — AI Routine panel (inside SkinCareModule)
═══════════════════════════════════════════════════════════════ */

.sc-disclaimer {
  font-size: 11px; color: var(--text-muted); text-align: center;
  padding: 6px 12px; border-bottom: 1px solid var(--border);
  background: rgba(0,212,170,0.04);
}
.sc-routine-panel    { padding: 0; }
.sc-loading          { padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px; }
.sc-error-msg        { color: var(--danger); font-size: 12px; padding: 12px 14px; }
.sc-empty-routine,
.sc-empty-products   { padding: 32px 16px; text-align: center; color: var(--text-muted); font-size: 13px; }
.sc-empty-icon       { font-size: 32px; margin-bottom: 10px; }
.sc-empty-hint       { font-size: 11px; margin-top: 6px; }
.sc-explanation {
  font-size: 12px; color: var(--text-dim); font-style: italic;
  padding: 10px 14px; border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}
.sc-routine-section           { border-bottom: 1px solid var(--border); padding: 10px 14px; }
.sc-routine-section:last-of-type { border-bottom: none; }
.sc-routine-section-header    {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
}
.sc-routine-section-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--text-muted);
}
.sc-workout-badge {
  font-size: 10px; padding: 2px 7px; border-radius: 10px;
  background: rgba(240,160,48,0.15); color: var(--warning);
}
.sc-routine-step {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 8px; margin-bottom: 4px;
  background: var(--bg-elevated); cursor: pointer; transition: background 0.1s;
}
.sc-routine-step:hover         { background: #232a35; }
.sc-routine-step-done          { opacity: 0.55; }
.sc-routine-check {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid var(--border); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 10px;
}
.sc-routine-check-done         { background: var(--accent); border-color: var(--accent); color: #0d1117; }
.sc-routine-step-body          { flex: 1; min-width: 0; }
.sc-routine-step-action        { font-size: 13px; font-weight: 600; }
.sc-routine-step-product       { font-size: 11px; color: var(--accent); margin-top: 1px; }
.sc-routine-step-reason        { font-size: 10px; color: var(--text-muted); font-style: italic; margin-top: 2px; }
.sc-routine-product-thumb {
  width: 36px; height: 36px; border-radius: 6px; object-fit: cover;
  border: 1px solid var(--border); flex-shrink: 0;
}
.sc-alerts        { padding: 10px 14px; }
.sc-alert-item {
  font-size: 11px; color: var(--text-dim); padding: 6px 10px;
  background: var(--bg-elevated); border-radius: 6px;
  border-left: 2px solid var(--accent); margin-bottom: 4px;
}
.sc-regenerate-btn {
  display: block; width: calc(100% - 28px); margin: 10px 14px 14px;
  padding: 9px; border-radius: 8px;
  background: var(--bg-elevated); color: var(--text-dim);
  border: 1px solid var(--border); cursor: pointer; font-size: 12px;
  transition: all 0.15s;
}
.sc-regenerate-btn:hover { border-color: var(--accent); color: var(--accent); }

/* ── Products tab ── */
.sc-products-panel  { padding: 12px 14px; }
.sc-add-product-btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; padding: 10px; border-radius: 8px; margin-bottom: 12px;
  background: var(--bg-elevated); color: var(--accent);
  border: 1px dashed var(--accent); cursor: pointer; font-size: 13px; font-weight: 500;
  transition: background 0.15s;
}
.sc-add-product-btn:hover { background: var(--accent-glow); }
.sc-product-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
}
.sc-product-card {
  background: var(--bg-elevated); border: 1px solid var(--border);
  border-radius: 8px; overflow: hidden; position: relative;
  transition: border-color 0.15s;
}
.sc-product-card:hover     { border-color: var(--accent); }
.sc-product-excluded       { opacity: 0.65; }
.sc-product-photo {
  width: 100%; aspect-ratio: 1; object-fit: cover;
  background: var(--bg-input); display: block;
}
.sc-product-photo-placeholder {
  display: flex; align-items: center; justify-content: center;
  font-size: 28px;
}
.sc-product-info           { padding: 8px; }
.sc-product-brand {
  font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted);
}
.sc-product-name           { font-size: 11px; font-weight: 600; margin-top: 2px; line-height: 1.3; }
.sc-product-type           { font-size: 10px; color: var(--accent); margin-top: 3px; text-transform: capitalize; }
.sc-product-ingredients    { font-size: 9px; color: var(--text-muted); margin-top: 3px; line-height: 1.4; }
.sc-product-status {
  display: inline-block; font-size: 9px; margin-top: 4px; padding: 2px 5px; border-radius: 4px;
}
.sc-product-safe           { background: rgba(63,185,80,0.15);  color: #3fb950; }
.sc-product-banned         { background: rgba(248,81,73,0.15);  color: var(--danger); }
.sc-product-del {
  position: absolute; top: 4px; right: 4px;
  background: rgba(0,0,0,0.5); color: var(--text-muted);
  border: none; border-radius: 50%; width: 20px; height: 20px;
  font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.sc-product-del:hover { background: rgba(248,81,73,0.8); color: white; }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: add CSS for SkinProductScanner and AI routine panel"
```

---

## Task 7: Build, Deploy, and Audit

**Files:** None (build + deploy only)

- [ ] **Step 1: Build frontend and check for errors**

```bash
cd frontend && npm run build
```

Expected: exits 0 with no errors. Any JSX syntax error must be fixed before continuing.

- [ ] **Step 2: Smoke-test locally**

```bash
cd backend && python app.py
# Open http://localhost:5173 in browser
```

Verify:
1. Navigate to Skin Care module
2. "✨ Today" and "🧴 Products" tabs appear at the top of the routine card
3. Disclaimer text is visible below the tabs
4. Products tab shows "No products yet" with an Add Product button
5. Tapping "Add Product" opens the SkinProductScanner sheet
6. Adding a product manually (no photo needed for this test — just fill in the review form) saves and appears in the grid

- [ ] **Step 3: Test routine generation**

After adding at least one product:
1. Switch to the "✨ Today" tab
2. Routine should auto-generate (Morning + Evening sections at minimum)
3. Tap any step — checkmark appears
4. Hard-refresh the page
5. Tap "✨ Today" tab again — checkmark is still there (idempotency confirmed)

- [ ] **Step 4: Test disclaimer is always visible**

Verify the disclaimer "Suggestions based on general dermatological patterns. Consult a dermatologist for your specific condition." is visible in the routine card below the tab buttons and cannot be dismissed.

- [ ] **Step 5: Deploy to Fly.io**

```bash
flyctl deploy --app life-tracker-zach
```

Expected: deployment succeeds, machine reaches `started` state.

- [ ] **Step 6: Verify on production**

Open `https://life-tracker-zach.fly.dev`, navigate to Skin Care, confirm:
- Tabs render correctly
- Disclaimer is visible
- Products tab and Add Product button work
- Routine generates after adding a product

- [ ] **Step 7: Tag release**

```bash
git tag skincare-ai-v1
```
