import base64
import hashlib
import json
import os
import re
import smtplib
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from email.mime.text import MIMEText
from zoneinfo import ZoneInfo
from flask import Flask, jsonify, request, Response, send_from_directory, session
from flask_cors import CORS
from dotenv import load_dotenv

# Load .env before anything else (sets GROQ_API_KEY etc.)
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from models import db, SleepEntry, AICache, FoodEntry, Task, Habit, HabitLog, MoodEntry, ExerciseEntry, HydrationLog, MealTemplate, MealTemplateItem, ExerciseTemplate, ExerciseTemplateItem, WeightEntry, WeeklyReview, Chore, ChoreLog, BodyMeasurement, WeeklyPlan, Supplement, SupplementLog, ScreenTimeEntry, UserProfile, SkincareLog, SkinCareStep, SkinCareStepLog, SkinConditionLog, SkinPhotoAnalysis, ScannedProduct, SkinProduct, DailyRoutine, RoutineStepLog, SkinWorkoutLog, ReminderConfig

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": ["http://localhost:9999", "http://127.0.0.1:9999", "http://localhost:3030", "http://127.0.0.1:3030"]}},
     supports_credentials=True)

BASE_DIR      = os.path.dirname(os.path.abspath(__file__))
DB_PATH       = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "sleep_tracker.db"))
FRONTEND_DIST = os.path.join(BASE_DIR, "..", "frontend", "dist")

app.config["SQLALCHEMY_DATABASE_URI"]        = f"sqlite:///{DB_PATH}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SECRET_KEY"]                     = os.environ.get("SECRET_KEY", "dev-only-secret-not-for-prod")
app.config["SESSION_COOKIE_HTTPONLY"]        = True
app.config["SESSION_COOKIE_SAMESITE"]       = "Lax"
app.config["SESSION_COOKIE_SECURE"]         = bool(os.environ.get("PIN_HASH"))  # HTTPS only in prod

PIN_HASH = os.environ.get("PIN_HASH", "")  # SHA-256 hex of PIN; empty = no lock

# In-memory PIN brute-force protection
_pin_attempts: dict = {}   # {ip: [attempt_timestamp, ...]}
_PIN_MAX_ATTEMPTS = 10
_PIN_LOCKOUT_SECS = 300    # 5-minute window

db.init_app(app)


# ---------------------------------------------------------------------------
# PIN auth gate
# ---------------------------------------------------------------------------

@app.before_request
def require_pin():
    if not PIN_HASH:
        return  # no PIN configured — open access (local dev)
    # always allow: static assets, SPA root, auth routes, sync endpoints
    p = request.path
    if (not p.startswith("/api/")
            or p.startswith("/api/auth/")
            or p.startswith("/api/sync/")
            or p == "/api/reminders/run"):   # token-gated cron endpoint
        return
    if not session.get("pin_ok"):
        return jsonify({"error": "PIN required", "code": "PIN_REQUIRED"}), 401


@app.route("/api/auth/status")
def auth_status():
    return jsonify({
        "pin_required":   bool(PIN_HASH),
        "authenticated":  bool(not PIN_HASH or session.get("pin_ok")),
    })


@app.route("/api/auth/verify", methods=["POST"])
def auth_verify():
    if not PIN_HASH:
        return jsonify({"ok": True})

    ip  = request.remote_addr or "unknown"
    now = datetime.utcnow().timestamp()

    # Prune old attempts outside the window
    _pin_attempts[ip] = [t for t in _pin_attempts.get(ip, []) if now - t < _PIN_LOCKOUT_SECS]

    if len(_pin_attempts[ip]) >= _PIN_MAX_ATTEMPTS:
        retry_after = int(_PIN_LOCKOUT_SECS - (now - _pin_attempts[ip][0]))
        return jsonify({"error": "Too many attempts. Try again later.", "retry_after": retry_after}), 429

    data = request.get_json(force=True) or {}
    pin  = str(data.get("pin", ""))
    if hashlib.sha256(pin.encode()).hexdigest() == PIN_HASH:
        _pin_attempts.pop(ip, None)   # reset on success
        session["pin_ok"] = True
        session.permanent  = True
        return jsonify({"ok": True})

    _pin_attempts.setdefault(ip, []).append(now)
    remaining = _PIN_MAX_ATTEMPTS - len(_pin_attempts[ip])
    return jsonify({"error": "Wrong PIN", "attempts_remaining": remaining}), 403


@app.route("/api/auth/lock", methods=["POST"])
def auth_lock():
    session.pop("pin_ok", None)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CACHE_TTL_DAILY   = timedelta(days=30)
_CACHE_TTL_MONTHLY = timedelta(days=7)


def _is_valid_hhmm(value) -> bool:
    try:
        parts = str(value).split(":")
        if len(parts) != 2:
            return False
        h, m = int(parts[0]), int(parts[1])
        return 0 <= h <= 23 and 0 <= m <= 59
    except (ValueError, AttributeError):
        return False


def time_to_minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def minutes_between(start: str, end: str) -> int:
    s, e = time_to_minutes(start), time_to_minutes(end)
    return (e - s) if e >= s else (1440 - s + e)


def calculate_fields(data: dict) -> dict:
    bed_time   = data.get("bed_time", "")
    sleep_time = data.get("sleep_time", "")
    wake_time  = data.get("wake_time", "")

    if sleep_time and wake_time:
        duration = minutes_between(sleep_time, wake_time)
        data["sleep_duration_minutes"] = duration
        nap_raw = data.get("nap_duration_minutes")
        nap_min = int(nap_raw) if nap_raw not in (None, "") else 0
        data["sleep_cycles"]           = round((duration + nap_min) / 90, 1)
    else:
        data["sleep_duration_minutes"] = None
        data["sleep_cycles"]           = None

    if bed_time and sleep_time:
        data["sleep_latency_minutes"] = minutes_between(bed_time, sleep_time)
    else:
        data["sleep_latency_minutes"] = None

    return data


def validate_entry(data: dict, existing_id: int = None):
    required = ["entry_date", "bed_time", "sleep_time", "wake_time",
                "out_of_bed_time", "inertia_score", "energy_score", "stress_score"]
    for field in required:
        if field not in data or data[field] is None or data[field] == "":
            return False, f"Missing required field: {field}"

    try:
        entry_date = date.fromisoformat(data["entry_date"])
    except ValueError:
        return False, "Invalid entry_date format. Use YYYY-MM-DD."

    for field in ["bed_time", "sleep_time", "wake_time", "out_of_bed_time"]:
        if not _is_valid_hhmm(data.get(field, "")):
            return False, f"{field} must be a valid time in HH:MM format (e.g. 22:30)."

    cct = data.get("caffeine_cutoff_time")
    if cct and not _is_valid_hhmm(cct):
        return False, "caffeine_cutoff_time must be in HH:MM format (e.g. 14:00)."

    q = SleepEntry.query.filter_by(entry_date=entry_date)
    if existing_id:
        q = q.filter(SleepEntry.id != existing_id)
    if q.first():
        return False, f"An entry already exists for {data['entry_date']}."

    latency = minutes_between(data["bed_time"], data["sleep_time"])
    if latency > 240:
        return False, "Sleep latency exceeds 4 hours — check bed time and sleep time."

    duration = minutes_between(data["sleep_time"], data["wake_time"])
    if duration <= 0 or duration > 960:
        return False, "Wake time must be after sleep time and duration under 16 hours."

    oob = minutes_between(data["wake_time"], data["out_of_bed_time"])
    if oob > 240:
        return False, "Out-of-bed time must be within 4 hours of wake time."

    for field in ["inertia_score", "energy_score", "stress_score"]:
        try:
            if not (1 <= int(data[field]) <= 10):
                raise ValueError()
        except (TypeError, ValueError):
            return False, f"{field} must be an integer between 1 and 10."

    return True, None


def entry_from_data(entry: SleepEntry, data: dict) -> SleepEntry:
    data = calculate_fields(data)

    entry.entry_date           = date.fromisoformat(data["entry_date"])
    entry.bed_time             = data["bed_time"]
    entry.sleep_time           = data["sleep_time"]
    entry.wake_time            = data["wake_time"]
    entry.out_of_bed_time      = data["out_of_bed_time"]
    entry.sleep_duration_minutes = data.get("sleep_duration_minutes")
    entry.sleep_cycles         = data.get("sleep_cycles")
    entry.sleep_latency_minutes = data.get("sleep_latency_minutes")
    entry.inertia_score        = int(data["inertia_score"])
    entry.energy_score         = int(data["energy_score"])
    entry.stress_score         = int(data["stress_score"])
    entry.miles_walked         = float(data["miles_walked"]) if data.get("miles_walked") not in (None, "") else None
    entry.caffeine_cutoff_time = data.get("caffeine_cutoff_time") or None
    entry.caffeine_mg          = int(data["caffeine_mg"]) if data.get("caffeine_mg") not in (None, "") else None
    entry.naps                 = bool(data.get("naps", False))
    nap_dur = data.get("nap_duration_minutes")
    entry.nap_duration_minutes = int(nap_dur) if nap_dur not in (None, "") else None
    entry.ankle_notes          = data.get("ankle_notes") or None
    entry.tags                 = data.get("tags") or None
    entry.notes                = data.get("notes") or None
    return entry


def _md5(obj) -> str:
    return hashlib.md5(
        json.dumps(obj, sort_keys=True, default=str).encode()
    ).hexdigest()


# ---------------------------------------------------------------------------
# CRUD Routes
# ---------------------------------------------------------------------------

@app.route("/api/entries", methods=["GET"])
def get_entries():
    limit  = request.args.get("limit",  type=int)
    offset = request.args.get("offset", 0, type=int)
    q = SleepEntry.query.order_by(SleepEntry.entry_date.desc())
    total = q.count()
    if limit:
        q = q.limit(limit).offset(offset)
    entries = q.all()
    return jsonify({
        "total":   total,
        "offset":  offset,
        "limit":   limit,
        "entries": [e.to_dict() for e in entries],
    })


@app.route("/api/entries", methods=["POST"])
def create_entry():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "No JSON body provided."}), 400
    ok, err = validate_entry(data)
    if not ok:
        return jsonify({"error": err}), 422
    entry = entry_from_data(SleepEntry(), data)
    db.session.add(entry)
    db.session.commit()
    return jsonify(entry.to_dict()), 201


@app.route("/api/entries/<int:entry_id>", methods=["GET"])
def get_entry(entry_id):
    return jsonify(SleepEntry.query.get_or_404(entry_id).to_dict())


@app.route("/api/entries/<int:entry_id>", methods=["PUT"])
def update_entry(entry_id):
    entry = SleepEntry.query.get_or_404(entry_id)
    data  = request.get_json(force=True)
    if not data:
        return jsonify({"error": "No JSON body provided."}), 400
    ok, err = validate_entry(data, existing_id=entry_id)
    if not ok:
        return jsonify({"error": err}), 422
    entry = entry_from_data(entry, data)
    db.session.commit()
    # Bust AI cache for this date
    cache = AICache.query.filter_by(cache_key=f"daily-{data['entry_date']}").first()
    if cache:
        db.session.delete(cache)
        db.session.commit()
    return jsonify(entry.to_dict())


@app.route("/api/entries/<int:entry_id>", methods=["DELETE"])
def delete_entry(entry_id):
    entry = SleepEntry.query.get_or_404(entry_id)
    # Bust AI cache for this date
    date_str = entry.entry_date.isoformat()
    cache = AICache.query.filter_by(cache_key=f"daily-{date_str}").first()
    if cache:
        db.session.delete(cache)
    db.session.delete(entry)
    db.session.commit()
    return jsonify({"message": f"Entry {entry_id} deleted."})


@app.route("/api/export/json", methods=["GET"])
def export_json():
    entries = SleepEntry.query.order_by(SleepEntry.entry_date.asc()).all()
    payload = {
        "export_date":    datetime.utcnow().isoformat(),
        "total_entries":  len(entries),
        "entries":        [e.to_dict() for e in entries],
    }
    today = date.today().isoformat()
    return Response(
        json.dumps(payload, indent=2, default=str),
        mimetype="application/json",
        headers={"Content-Disposition": f'attachment; filename="sleep_data_{today}.json"'},
    )


@app.route("/api/stats", methods=["GET"])
def get_stats():
    entries = SleepEntry.query.all()
    total   = len(entries)
    if total == 0:
        return jsonify({
            "total_entries": 0,
            "avg_sleep_duration_minutes": None,
            "avg_sleep_duration_hours":   None,
            "avg_sleep_cycles":           None,
            "avg_inertia_score":          None,
            "avg_energy_score":           None,
            "avg_miles_walked":           None,
            "date_range_start":           None,
            "date_range_end":             None,
        })

    def avg(lst):
        return round(sum(lst) / len(lst), 2) if lst else None

    durations = [e.sleep_duration_minutes for e in entries if e.sleep_duration_minutes is not None]
    cycles    = [e.sleep_cycles   for e in entries if e.sleep_cycles   is not None]
    inertia   = [e.inertia_score  for e in entries if e.inertia_score  is not None]
    energy    = [e.energy_score   for e in entries if e.energy_score   is not None]
    miles     = [e.miles_walked   for e in entries if e.miles_walked   is not None]
    dates     = sorted(e.entry_date for e in entries)
    avg_dur   = avg(durations)

    return jsonify({
        "total_entries":              total,
        "avg_sleep_duration_minutes": avg_dur,
        "avg_sleep_duration_hours":   round(avg_dur / 60, 2) if avg_dur else None,
        "avg_sleep_cycles":           avg(cycles),
        "avg_inertia_score":          avg(inertia),
        "avg_energy_score":           avg(energy),
        "avg_miles_walked":           avg(miles),
        "date_range_start":           dates[0].isoformat()  if dates else None,
        "date_range_end":             dates[-1].isoformat() if dates else None,
    })


# ---------------------------------------------------------------------------
# AI Routes
# ---------------------------------------------------------------------------

@app.route("/api/ai/daily-brief/<string:entry_date>", methods=["GET"])
def daily_brief(entry_date):
    from ai_service import get_daily_brief

    try:
        d = date.fromisoformat(entry_date)
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD."}), 400

    entry = SleepEntry.query.filter_by(entry_date=d).first()
    if not entry:
        return jsonify({"error": f"No entry found for {entry_date}."}), 404

    entry_dict = entry.to_dict()
    entry_hash = _md5(entry_dict)
    cache_key  = f"daily-{entry_date}"

    cached = AICache.query.filter_by(cache_key=cache_key).first()
    cache_fresh = (
        cached and
        cached.entry_hash == entry_hash and
        (datetime.utcnow() - cached.generated_at) < _CACHE_TTL_DAILY
    )
    if cache_fresh:
        return jsonify({
            "cached":       True,
            "generated_at": cached.generated_at.isoformat(),
            **json.loads(cached.response_json),
        })

    # Fetch 7 days of history prior to this entry
    history = (
        SleepEntry.query
        .filter(SleepEntry.entry_date < d)
        .order_by(SleepEntry.entry_date.desc())
        .limit(7)
        .all()
    )
    history_dicts = [h.to_dict() for h in reversed(history)]

    try:
        brief = get_daily_brief(entry_dict, history_dicts)
    except Exception as exc:
        return jsonify({"error": f"AI service error: {exc}"}), 500

    # Persist to cache
    if cached:
        cached.response_json = json.dumps(brief)
        cached.entry_hash    = entry_hash
        cached.generated_at  = datetime.utcnow()
    else:
        db.session.add(AICache(
            cache_key     = cache_key,
            response_json = json.dumps(brief),
            entry_hash    = entry_hash,
        ))
    db.session.commit()

    return jsonify({
        "cached":       False,
        "generated_at": datetime.utcnow().isoformat(),
        **brief,
    })


@app.route("/api/ai/analyze-month", methods=["POST"])
def analyze_month():
    from ai_service import get_monthly_analysis

    entries = SleepEntry.query.order_by(SleepEntry.entry_date.asc()).all()
    if not entries:
        return jsonify({"error": "No entries to analyze."}), 400

    cache_key  = "monthly-analysis"
    data_hash  = _md5([e.entry_date.isoformat() for e in entries])

    cached = AICache.query.filter_by(cache_key=cache_key).first()
    cache_fresh = (
        cached and
        cached.entry_hash == data_hash and
        (datetime.utcnow() - cached.generated_at) < _CACHE_TTL_MONTHLY
    )
    if cache_fresh:
        return jsonify({
            "cached":       True,
            "generated_at": cached.generated_at.isoformat(),
            **json.loads(cached.response_json),
        })

    try:
        analysis = get_monthly_analysis([e.to_dict() for e in entries])
    except Exception as exc:
        return jsonify({"error": f"AI service error: {exc}"}), 500

    if cached:
        cached.response_json = json.dumps(analysis)
        cached.entry_hash    = data_hash
        cached.generated_at  = datetime.utcnow()
    else:
        db.session.add(AICache(
            cache_key     = cache_key,
            response_json = json.dumps(analysis),
            entry_hash    = data_hash,
        ))
    db.session.commit()

    return jsonify({
        "cached":       False,
        "generated_at": datetime.utcnow().isoformat(),
        **analysis,
    })


# ---------------------------------------------------------------------------
# Sleep Debt & REM Calculator
# ---------------------------------------------------------------------------

# REM minutes per cycle (cycles 1-6).
# Based on research: 20-25% of total sleep is REM, distributed exponentially
# across cycles (early cycles are NREM-heavy; later cycles are REM-heavy).
_REM_PER_CYCLE = [5, 13, 20, 28, 38, 45]   # minutes of REM for cycle 1..6


def _estimate_rem(sleep_minutes: float) -> int:
    """Estimate total REM in minutes for a given sleep duration."""
    if not sleep_minutes:
        return 0
    cycles     = sleep_minutes / 90
    full       = int(min(cycles, len(_REM_PER_CYCLE)))
    partial    = cycles - int(cycles)
    rem        = sum(_REM_PER_CYCLE[:full])
    if full < len(_REM_PER_CYCLE):
        rem += partial * _REM_PER_CYCLE[full]
    return round(rem)


def _calc_bedtime(wake_hhmm: str, cycles: float, latency_min: int) -> str:
    """Return ideal bedtime (HH:MM) to hit the given cycle count."""
    h, m   = map(int, wake_hhmm.split(":"))
    total  = h * 60 + m - round(cycles * 90) - latency_min
    if total < 0:
        total += 1440
    return f"{total // 60:02d}:{total % 60:02d}"


@app.route("/api/sleep-debt", methods=["GET"])
def sleep_debt():
    """
    Rolling sleep-debt calculator.

    Query params:
        optimal  – target sleep in minutes (default 480 = 8 h)
    """
    optimal = int(request.args.get("optimal", 480))
    entries = (
        SleepEntry.query
        .filter(SleepEntry.sleep_duration_minutes.isnot(None))
        .order_by(SleepEntry.entry_date.asc())
        .all()
    )

    if not entries:
        return jsonify({"error": "No entries with sleep data yet."}), 404

    dicts = [e.to_dict() for e in entries]

    # ── Per-night debt (positive = deficit, negative = surplus) ──────────────
    nightly = []
    for d in dicts:
        actual = d.get("sleep_duration_minutes") or 0
        nightly.append({
            "date":           d["entry_date"],
            "actual_minutes": actual,
            "optimal_minutes": optimal,
            "debt_minutes":   optimal - actual,          # + = deficit
            "rem_minutes":    _estimate_rem(actual),
            "cycles":         d.get("sleep_cycles"),
        })

    # ── Rolling accumulated debt (surplus pays down debt, floor 0) ───────────
    # Research: recovery isn't 1:1 — surplus recovers debt at ~50% efficiency
    # to model the "exponential decay" finding (single recovery night isn't enough).
    def rolling_debt(window_days: int) -> int:
        subset   = nightly[-window_days:]
        debt     = 0.0
        for n in subset:
            if n["debt_minutes"] > 0:          # deficit night
                debt += n["debt_minutes"]
            else:                              # surplus — recovers at 50%
                debt -= abs(n["debt_minutes"]) * 0.5
        return max(0, round(debt))

    debt_7d  = rolling_debt(7)
    debt_14d = rolling_debt(14)

    # ── Trend: last 3 nights vs prior 3 ──────────────────────────────────────
    if len(nightly) >= 6:
        recent_avg = sum(n["debt_minutes"] for n in nightly[-3:]) / 3
        prior_avg  = sum(n["debt_minutes"] for n in nightly[-6:-3]) / 3
        if   recent_avg < prior_avg - 5:  debt_trend = "improving"
        elif recent_avg > prior_avg + 5:  debt_trend = "worsening"
        else:                             debt_trend = "stable"
    else:
        debt_trend = "insufficient_data"

    # ── Recovery ETA ─────────────────────────────────────────────────────────
    # Uses the same 50% efficiency rule as rolling_debt().
    # Find the smallest surplus among cycle options that don't add to debt,
    # then project nights needed: ceil(debt / (surplus * 0.5)).
    # Falls back to the "4 days per hour" heuristic if no surplus option exists.
    _DEBT_WINDOW = 7  # days — must match rolling_debt(7) call above

    def _recovery_eta(debt_min: int, cycle_options) -> tuple[int, float | None]:
        surplus_opts = [(opt["debt_impact_minutes"], opt["cycles"]) for opt in cycle_options
                        if opt["debt_impact_minutes"] < 0]
        if not surplus_opts or debt_min == 0:
            return 0 if debt_min == 0 else _DEBT_WINDOW, None
        # Most conservative (smallest absolute surplus) to give an honest ceiling
        best_impact, best_cycles = min(surplus_opts, key=lambda x: abs(x[0]))
        nightly_recovery = abs(best_impact) * 0.5
        days = -(-debt_min // nightly_recovery)  # ceiling division
        # Hard cap: after _DEBT_WINDOW surplus nights every current deficit entry has
        # rolled off the window, so debt is guaranteed zero by then.
        return min(int(days), _DEBT_WINDOW), best_cycles

    recovery_days, recovery_basis_cycles = _recovery_eta(debt_7d, [
        {"debt_impact_minutes": optimal - round(cyc * 90), "cycles": cyc}
        for cyc in [4.5, 5.0, 5.5, 6.0]
    ])

    # ── REM summary ──────────────────────────────────────────────────────────
    last        = nightly[-1]
    rem_values  = [n["rem_minutes"] for n in nightly]
    avg_rem     = round(sum(rem_values) / len(rem_values))
    rem_deficit = max(0, round(optimal * 0.22) - last["rem_minutes"])  # 22% of optimal = target REM

    # ── Bedtime calculator ────────────────────────────────────────────────────
    latencies   = [e.get("sleep_latency_minutes") for e in dicts if e.get("sleep_latency_minutes")]
    avg_latency = round(sum(latencies) / len(latencies)) if latencies else 15

    # Use the most recent entry's wake time as the target wake
    target_wake = dicts[-1].get("wake_time", "07:00")

    bedtime_options = []
    for cyc in [4.5, 5.0, 5.5, 6.0]:
        dur_min      = round(cyc * 90)
        debt_impact  = optimal - dur_min          # + = adds to debt, - = surplus
        # Surplus recovers debt at 50% efficiency; deficits are full cost
        actual_debt_change = round(debt_impact * 0.5) if debt_impact < 0 else debt_impact
        bedtime_options.append({
            "cycles":                    cyc,
            "bedtime":                   _calc_bedtime(target_wake, cyc, avg_latency),
            "sleep_duration_minutes":    dur_min,
            "sleep_duration_label":      f"{dur_min // 60}h {dur_min % 60}m" if dur_min % 60 else f"{dur_min // 60}h",
            "estimated_rem_minutes":     _estimate_rem(dur_min),
            "debt_impact_minutes":       debt_impact,
            "actual_debt_change_minutes": actual_debt_change,  # true nightly debt delta after 50% efficiency
            # Only recommend cycles that don't add to debt; prefer 5.0 then 5.5 per research
            "is_optimal":                cyc in (5.0, 5.5) and debt_impact <= 0,
        })

    return jsonify({
        "optimal_minutes":              optimal,
        "target_wake_time":             target_wake,
        "avg_sleep_latency_minutes":    avg_latency,
        # Debt
        "rolling_7d_debt_minutes":      debt_7d,
        "rolling_14d_debt_minutes":     debt_14d,
        "debt_trend":                   debt_trend,
        "recovery_eta_days":            recovery_days,
        "recovery_basis_cycles":        recovery_basis_cycles,  # which cycle count the ETA assumes
        # Last night
        "last_night_date":              last["date"],
        "last_night_actual_minutes":    last["actual_minutes"],
        "last_night_debt_minutes":      last["debt_minutes"],
        "last_night_rem_minutes":       last["rem_minutes"],
        "last_night_rem_pct":           round(last["rem_minutes"] / last["actual_minutes"] * 100) if last["actual_minutes"] else 0,
        # Averages
        "avg_rem_per_night_minutes":    avg_rem,
        "rem_deficit_last_night":       rem_deficit,
        # Bedtime calc
        "bedtime_recommendations":      bedtime_options,
        # 14-day history for chart
        "daily_history":                nightly[-14:],
    })


# ---------------------------------------------------------------------------
# Calorie Routes
# ---------------------------------------------------------------------------

@app.route("/api/food", methods=["GET"])
def get_food_entries():
    date_str = request.args.get("date")
    if date_str:
        try:
            d = date.fromisoformat(date_str)
        except ValueError:
            return jsonify({"error": "Invalid date format. Use YYYY-MM-DD."}), 400
        entries = FoodEntry.query.filter_by(entry_date=d).order_by(FoodEntry.created_at.asc()).all()
    else:
        entries = FoodEntry.query.order_by(FoodEntry.entry_date.desc(), FoodEntry.created_at.asc()).all()
    return jsonify([e.to_dict() for e in entries])


@app.route("/api/food", methods=["POST"])
def create_food_entry():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "No JSON body provided."}), 400
    for field in ["entry_date", "food_name", "calories", "meal_type"]:
        if not data.get(field) and data.get(field) != 0:
            return jsonify({"error": f"Missing required field: {field}"}), 422
    try:
        entry_date = date.fromisoformat(data["entry_date"])
    except ValueError:
        return jsonify({"error": "Invalid entry_date format. Use YYYY-MM-DD."}), 422
    try:
        calories = int(data["calories"])
        if not (0 <= calories <= 10000):
            raise ValueError()
    except (TypeError, ValueError):
        return jsonify({"error": "calories must be an integer between 0 and 10000."}), 422
    meal_type = data.get("meal_type", "snack")
    if meal_type not in ("breakfast", "lunch", "dinner", "snack"):
        return jsonify({"error": "meal_type must be breakfast, lunch, dinner, or snack."}), 422

    def _opt_float(key):
        v = data.get(key)
        return float(v) if v not in (None, "") else None

    entry = FoodEntry(
        entry_date = entry_date,
        meal_type  = meal_type,
        food_name  = str(data["food_name"])[:200],
        calories   = calories,
        protein_g  = _opt_float("protein_g"),
        carbs_g    = _opt_float("carbs_g"),
        fat_g      = _opt_float("fat_g"),
        notes      = data.get("notes") or None,
    )
    db.session.add(entry)
    db.session.commit()
    return jsonify(entry.to_dict()), 201


@app.route("/api/food/<int:entry_id>", methods=["DELETE"])
def delete_food_entry(entry_id):
    entry = FoodEntry.query.get_or_404(entry_id)
    db.session.delete(entry)
    db.session.commit()
    return jsonify({"message": f"Food entry {entry_id} deleted."})


# ── Food photo analysis helpers ──────────────────────────────────────────────

def _strip_json_fences(text):
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text  = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    return text.strip()


def _lookup_usda(query, usda_key):
    """Query USDA FoodData Central for macros per 100 g.
    Returns ({"calories", "protein", "carbs", "fat"}, matched_name) or (None, query).
    """
    import urllib.request, urllib.parse
    encoded = urllib.parse.quote(query)
    url = (
        "https://api.nal.usda.gov/fdc/v1/foods/search"
        f"?query={encoded}&api_key={usda_key}&pageSize=1"
        "&dataType=SR%20Legacy,Foundation"
    )
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read())
        foods = data.get("foods", [])
        if not foods:
            return None, query
        food = foods[0]
        nm = {
            n["nutrientId"]: float(n.get("value", 0))
            for n in food.get("foodNutrients", [])
            if "nutrientId" in n
        }
        # USDA nutrient IDs: 1008=Energy(kcal) 1003=Protein 1005=Carbs 1004=Fat
        return (
            {"calories": nm.get(1008, 0), "protein": nm.get(1003, 0),
             "carbs":    nm.get(1005, 0), "fat":     nm.get(1004, 0)},
            food.get("description", query),
        )
    except Exception:
        return None, query


def _estimate_ingredient_macros(name, client):
    """Ask Claude to estimate macros per 100 g when USDA lookup fails."""
    try:
        msg = client.messages.create(
            model      = "claude-haiku-4-5-20251001",
            max_tokens = 128,
            messages   = [{
                "role":    "user",
                "content": (
                    f'Estimate macros per 100g for: "{name}". '
                    'Return ONLY JSON (no markdown): {"calories": N, "protein": N, "carbs": N, "fat": N}'
                ),
            }],
        )
        d = json.loads(_strip_json_fences(msg.content[0].text))
        return {k: float(d.get(k, 0)) for k in ("calories", "protein", "carbs", "fat")}
    except Exception:
        return None


@app.route("/api/food/identify-ingredients", methods=["POST"])
def identify_food_ingredients():
    data      = request.get_json(force=True) or {}
    image_b64 = data.get("image")
    mime_type = data.get("mime_type", "image/jpeg")

    if not image_b64:
        return jsonify({"error": "No image provided"}), 400

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "Vision AI not configured"}), 503

    try:
        import anthropic
        client  = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model      = "claude-haiku-4-5-20251001",
            max_tokens = 768,
            messages   = [{
                "role": "user",
                "content": [
                    {
                        "type":   "image",
                        "source": {
                            "type":       "base64",
                            "media_type": mime_type,
                            "data":       image_b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "Analyze this food photo. Identify every distinct ingredient or food component.\n\n"
                            "Return ONLY a valid JSON object — no markdown, no explanation:\n"
                            '{"dish_name": "name", "description": "one sentence", '
                            '"ingredients": [{"name": "ingredient for db lookup", "estimated_grams": 150}]}\n\n'
                            "Guidelines:\n"
                            "- Specific searchable names: 'white rice cooked', 'chicken breast grilled', 'olive oil'\n"
                            "- Estimate grams from plate size, density, and typical portions\n"
                            "- Include sauces, dressings, toppings as separate items\n"
                            "- List 1–8 ingredients maximum"
                        ),
                    },
                ],
            }],
        )
        result = json.loads(_strip_json_fences(message.content[0].text))
        ingredients = [
            {
                "name":             str(i.get("name", "")).strip(),
                "estimated_grams":  round(float(i.get("estimated_grams", 100))),
            }
            for i in result.get("ingredients", [])
            if str(i.get("name", "")).strip()
        ]
        return jsonify({
            "dish_name":   str(result.get("dish_name",   "Food"))[:200],
            "description": str(result.get("description", ""))[:500],
            "ingredients": ingredients,
        })
    except json.JSONDecodeError:
        return jsonify({"error": "AI returned unexpected format, please try again"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/food/calculate-nutrition", methods=["POST"])
def calculate_nutrition():
    data        = request.get_json(force=True) or {}
    ingredients = data.get("ingredients", [])

    if not ingredients:
        return jsonify({"error": "No ingredients provided"}), 400

    usda_key  = os.environ.get("USDA_API_KEY")
    anthr_key = os.environ.get("ANTHROPIC_API_KEY")
    claude_client = None
    if anthr_key:
        import anthropic
        claude_client = anthropic.Anthropic(api_key=anthr_key)

    enriched = []
    for ing in ingredients:
        name  = str(ing.get("name", "")).strip()
        grams = float(ing.get("estimated_grams", 100))
        if not name:
            continue

        per100       = None
        matched      = False
        matched_name = name

        if usda_key:
            per100, matched_name = _lookup_usda(name, usda_key)
            if per100:
                matched = True

        if not per100 and claude_client:
            per100 = _estimate_ingredient_macros(name, claude_client)

        if not per100:
            per100 = {"calories": 0, "protein": 0, "carbs": 0, "fat": 0}

        r = grams / 100.0
        enriched.append({
            "name":              name,
            "usda_name":         matched_name,
            "estimated_grams":   round(grams),
            "usda_matched":      matched,
            "calories_per_100g": round(per100["calories"], 1),
            "protein_per_100g":  round(per100["protein"],  1),
            "carbs_per_100g":    round(per100["carbs"],    1),
            "fat_per_100g":      round(per100["fat"],      1),
            "calories":          round(per100["calories"]  * r),
            "protein_g":         round(per100["protein"]   * r, 1),
            "carbs_g":           round(per100["carbs"]     * r, 1),
            "fat_g":             round(per100["fat"]       * r, 1),
        })

    return jsonify({
        "ingredients": enriched,
        "totals": {
            "calories":  round(sum(i["calories"]  for i in enriched)),
            "protein_g": round(sum(i["protein_g"] for i in enriched), 1),
            "carbs_g":   round(sum(i["carbs_g"]   for i in enriched), 1),
            "fat_g":     round(sum(i["fat_g"]     for i in enriched), 1),
        },
    })


@app.route("/api/food/analyze-photo", methods=["POST"])
def analyze_food_photo():
    data      = request.get_json(force=True) or {}
    image_b64 = data.get("image")
    mime_type = data.get("mime_type", "image/jpeg")

    if not image_b64:
        return jsonify({"error": "No image provided"}), 400

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "Vision AI not configured"}), 503

    try:
        import anthropic
        client  = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model      = "claude-haiku-4-5-20251001",
            max_tokens = 512,
            messages   = [{
                "role": "user",
                "content": [
                    {
                        "type":   "image",
                        "source": {
                            "type":       "base64",
                            "media_type": mime_type,
                            "data":       image_b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "Analyze this food photo and estimate the nutritional content.\n"
                            "Return ONLY a valid JSON object — no markdown, no explanation:\n"
                            "{\n"
                            '  "food_name": "descriptive name of the dish",\n'
                            '  "calories": integer,\n'
                            '  "protein_g": float,\n'
                            '  "carbs_g": float,\n'
                            '  "fat_g": float,\n'
                            '  "description": "one sentence describing what you see"\n'
                            "}\n"
                            "If multiple items are visible, estimate combined totals. "
                            "Use realistic home-cooking or restaurant portion sizes."
                        ),
                    },
                ],
            }],
        )
        text   = _strip_json_fences(message.content[0].text)
        result = json.loads(text)
        return jsonify({
            "food_name":   str(result.get("food_name", "Unknown food"))[:200],
            "calories":    max(0, min(10000, int(result.get("calories") or 0))),
            "protein_g":   round(float(result.get("protein_g") or 0), 1),
            "carbs_g":     round(float(result.get("carbs_g") or 0), 1),
            "fat_g":       round(float(result.get("fat_g") or 0), 1),
            "description": str(result.get("description", ""))[:500],
        })
    except json.JSONDecodeError:
        return jsonify({"error": "AI returned unexpected format, please try again"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/food/scan-label", methods=["POST"])
def scan_nutrition_label():
    data      = request.get_json(force=True) or {}
    image_b64 = data.get("image")
    mime_type = data.get("mime_type", "image/jpeg")

    if not image_b64:
        return jsonify({"error": "No image provided"}), 400

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "Vision AI not configured"}), 503

    try:
        import anthropic
        client  = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model      = "claude-sonnet-4-6",
            max_tokens = 512,
            messages   = [{
                "role": "user",
                "content": [
                    {
                        "type":   "image",
                        "source": {
                            "type":       "base64",
                            "media_type": mime_type,
                            "data":       image_b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "This is a photo of a nutrition facts label from a food package. "
                            "Extract the nutritional information and return ONLY valid JSON — no markdown, no explanation:\n"
                            "{\n"
                            '  "product_name": "brand and product name if visible, otherwise best description",\n'
                            '  "serving_size_text": "serving size exactly as printed, e.g. \'1 bar (68g)\' or \'1 cup (240ml)\'",\n'
                            '  "calories": integer per serving,\n'
                            '  "protein_g": float per serving,\n'
                            '  "carbs_g": float per serving (use Total Carbohydrate, not net carbs),\n'
                            '  "fat_g": float per serving (use Total Fat)\n'
                            "}\n\n"
                            "Rules:\n"
                            "- Use per-serving values (first column if multiple shown)\n"
                            "- product_name: include brand if visible, e.g. 'Clif Bar - Chocolate Chip'\n"
                            "- If a macro value is not visible, use 0\n"
                            "- serving_size_text: copy exactly as printed on the label"
                        ),
                    },
                ],
            }],
        )
        text   = _strip_json_fences(message.content[0].text)
        result = json.loads(text)
        return jsonify({
            "product_name":      str(result.get("product_name") or "Packaged Food")[:200],
            "serving_size_text": str(result.get("serving_size_text") or "1 serving")[:100],
            "calories":          max(0, int(result.get("calories") or 0)),
            "protein_g":         round(float(result.get("protein_g") or 0), 1),
            "carbs_g":           round(float(result.get("carbs_g")   or 0), 1),
            "fat_g":             round(float(result.get("fat_g")     or 0), 1),
        })
    except json.JSONDecodeError:
        return jsonify({"error": "Could not read label — try a clearer, well-lit photo"}), 500
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/food/scanned-products", methods=["GET"])
def get_scanned_products():
    products = ScannedProduct.query.order_by(
        ScannedProduct.last_used.desc()
    ).limit(8).all()
    return jsonify([p.to_dict() for p in products])


@app.route("/api/food/scanned-products", methods=["POST"])
def upsert_scanned_product():
    data = request.get_json(force=True) or {}
    name = str(data.get("product_name") or "").strip()[:200]
    if not name:
        return jsonify({"error": "product_name required"}), 400

    existing = ScannedProduct.query.filter_by(product_name=name).first()
    if existing:
        existing.calories          = max(0, min(10000, int(data.get("calories") or existing.calories)))
        existing.protein_g         = float(data.get("protein_g") or existing.protein_g or 0)
        existing.carbs_g           = float(data.get("carbs_g")   or existing.carbs_g   or 0)
        existing.fat_g             = float(data.get("fat_g")     or existing.fat_g     or 0)
        existing.serving_size_text = data.get("serving_size_text", existing.serving_size_text)
        existing.use_count        += 1
        existing.last_used         = datetime.utcnow()
    else:
        existing = ScannedProduct(
            product_name      = name,
            serving_size_text = data.get("serving_size_text"),
            calories          = max(0, min(10000, int(data.get("calories") or 0))),
            protein_g         = float(data.get("protein_g") or 0),
            carbs_g           = float(data.get("carbs_g")   or 0),
            fat_g             = float(data.get("fat_g")     or 0),
        )
        db.session.add(existing)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": str(exc)}), 500
    return jsonify(existing.to_dict())


@app.route("/api/food/chat", methods=["POST"])
def food_chat():
    data    = request.get_json(force=True) or {}
    message = (data.get("message") or "").strip()
    history = data.get("history") or []          # [{role, content}, …]
    today_logged  = data.get("today_logged") or ""
    calorie_goal  = int(data.get("calorie_goal") or 0)
    consumed      = int(data.get("consumed") or 0)
    burned        = int(data.get("burned") or 0)

    if not message:
        return jsonify({"error": "message required"}), 400

    system_prompt = (
        "You are a knowledgeable nutrition and fitness assistant embedded in a personal health tracker. "
        "Answer questions about calories, macronutrients (protein, carbs, fat), meal planning, and exercise. "
        "Always give specific numbers for typical serving sizes — never say 'it depends' without also providing a concrete example. "
        "When suggesting foods or meals, factor in the user's remaining calorie budget for the day. "
        "Keep every reply under 120 words. Plain text only — no markdown headers or bold.\n\n"
        "IMPORTANT: When your reply includes specific calorie or macro numbers for one or more named foods, "
        "append a ```drafts block on a new line AFTER your reply text — and ONLY when specific numbers are present. "
        "Do NOT include it for general advice or replies without specific food calorie data. Format:\n"
        "```drafts\n"
        '[{"food_name":"<name>","calories":<int>,"protein_g":<float or null>,"carbs_g":<float or null>,"fat_g":<float or null>}]\n'
        "```"
    )

    context_parts = []
    if calorie_goal > 0:
        context_parts.append(f"daily calorie goal: {calorie_goal} cal")
    if consumed > 0:
        context_parts.append(f"consumed today: {consumed} cal")
    if burned > 0:
        context_parts.append(f"burned through exercise today: {burned} cal")
    if calorie_goal > 0 and consumed > 0:
        net = consumed - burned
        remaining = calorie_goal - net
        context_parts.append(f"net calories: {net} cal, remaining budget: {remaining} cal")
    if today_logged:
        context_parts.append(f"logged so far: {today_logged}")

    if context_parts:
        system_prompt += "\n\nUser's current status — " + "; ".join(context_parts) + "."

    messages = [{"role": "system", "content": system_prompt}]
    for h in history[-8:]:          # last 4 exchanges for context
        role = h.get("role")
        content = (h.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})

    try:
        import re, json as _json
        from ai_service import _get_client, _call_with_retry
        client = _get_client()
        resp = _call_with_retry(lambda: client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=messages,
            max_tokens=320,
            temperature=0.45,
        ))
        raw = resp.choices[0].message.content.strip()

        drafts = []
        draft_pattern = r'```drafts\s*([\s\S]*?)```'
        match = re.search(draft_pattern, raw)
        if match:
            try:
                parsed = _json.loads(match.group(1).strip())
                if isinstance(parsed, list):
                    drafts = [
                        {
                            "food_name": str(d.get("food_name", "")).strip(),
                            "calories":  int(d.get("calories") or 0),
                            "protein_g": float(d["protein_g"]) if d.get("protein_g") is not None else None,
                            "carbs_g":   float(d["carbs_g"])   if d.get("carbs_g")   is not None else None,
                            "fat_g":     float(d["fat_g"])     if d.get("fat_g")     is not None else None,
                        }
                        for d in parsed if d.get("food_name") and d.get("calories")
                    ]
            except Exception:
                pass
            clean_reply = re.sub(draft_pattern, "", raw).strip()
        else:
            clean_reply = raw

        result = {"reply": clean_reply}
        if drafts:
            result["drafts"] = drafts
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/food/templates", methods=["GET"])
def get_templates():
    templates = MealTemplate.query.order_by(MealTemplate.created_at.asc()).all()
    return jsonify([t.to_dict() for t in templates])


@app.route("/api/food/templates", methods=["POST"])
def create_template():
    data  = request.get_json(force=True) or {}
    name  = (data.get("name") or "").strip()[:100]
    if not name:
        return jsonify({"error": "name required"}), 422
    items_data = data.get("items") or []
    if not items_data:
        return jsonify({"error": "at least one item required"}), 422

    template = MealTemplate(
        name      = name,
        meal_type = data.get("meal_type") or None,
    )
    db.session.add(template)
    db.session.flush()   # populate template.id before adding items

    def _opt_float(item, key):
        v = item.get(key)
        return float(v) if v not in (None, "") else None

    for idx, item in enumerate(items_data):
        food_name = (item.get("food_name") or "").strip()
        try:
            calories = int(item.get("calories", 0))
        except (TypeError, ValueError):
            calories = 0
        if not food_name:
            continue
        db.session.add(MealTemplateItem(
            template_id = template.id,
            food_name   = food_name[:200],
            calories    = max(0, calories),
            protein_g   = _opt_float(item, "protein_g"),
            carbs_g     = _opt_float(item, "carbs_g"),
            fat_g       = _opt_float(item, "fat_g"),
            sort_order  = idx,
        ))

    db.session.commit()
    return jsonify(template.to_dict()), 201


@app.route("/api/food/templates/<int:template_id>", methods=["DELETE"])
def delete_template(template_id):
    template = MealTemplate.query.get_or_404(template_id)
    db.session.delete(template)
    db.session.commit()
    return jsonify({"message": f"Template {template_id} deleted."})


@app.route("/api/food/templates/<int:template_id>/apply", methods=["POST"])
def apply_template(template_id):
    template  = MealTemplate.query.get_or_404(template_id)
    data      = request.get_json(force=True) or {}
    date_str  = (data.get("entry_date") or date.today().isoformat()).strip()
    meal_type = data.get("meal_type") or template.meal_type or "snack"
    if meal_type not in ("breakfast", "lunch", "dinner", "snack"):
        meal_type = "snack"
    try:
        entry_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid entry_date"}), 400

    created = []
    for item in sorted(template.items, key=lambda x: x.sort_order):
        entry = FoodEntry(
            entry_date = entry_date,
            meal_type  = meal_type,
            food_name  = item.food_name,
            calories   = item.calories,
            protein_g  = item.protein_g,
            carbs_g    = item.carbs_g,
            fat_g      = item.fat_g,
        )
        db.session.add(entry)
        created.append(entry)

    db.session.commit()
    return jsonify([e.to_dict() for e in created]), 201


@app.route("/api/food/daily-summary", methods=["GET"])
def food_daily_summary():
    """Per-day calorie and macro totals — used by the calorie calendar."""
    cutoff  = date.today() - timedelta(days=730)
    entries = FoodEntry.query.filter(FoodEntry.entry_date >= cutoff).all()
    by_date = {}
    for e in entries:
        k = e.entry_date.isoformat()
        if k not in by_date:
            by_date[k] = {"calories": 0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0, "items": 0}
        by_date[k]["calories"]  += e.calories
        by_date[k]["protein_g"] += e.protein_g or 0
        by_date[k]["carbs_g"]   += e.carbs_g   or 0
        by_date[k]["fat_g"]     += e.fat_g      or 0
        by_date[k]["items"]     += 1
    return jsonify(by_date)


_MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
_CAL_PER_LB   = 3500.0   # ~kcal energy in one pound of body weight


def _resolve_baseline(p, override):
    """Pick the per-day maintenance baseline used for energy balance.

    Returns (baseline_per_day, source, goal, tdee). Prefers TDEE (true
    maintenance from the profile) and falls back to the calorie goal — or the
    2000 default — when TDEE inputs are missing. `override` ("goal"|"tdee")
    lets the client force a baseline when the data is available.
    """
    goal = int(p.calorie_goal) if (p and p.calorie_goal) else 2000
    tdee = None
    if p:
        _, tdee, _ = _compute_tdee(p)
    if override == "goal":
        return goal, "goal", goal, tdee
    if override == "tdee" and tdee:
        return tdee, "tdee", goal, tdee
    if tdee:
        return tdee, "tdee", goal, tdee
    return goal, "goal", goal, tdee


def _bucket_for(d, granularity):
    """Return (key, label, start_date, end_date) for the period containing d."""
    if granularity == "week":
        start = d - timedelta(days=d.weekday())        # Monday
        end   = start + timedelta(days=6)              # Sunday
        if start.month == end.month:
            label = f"{_MONTHS_SHORT[start.month-1]} {start.day}–{end.day}"
        else:
            label = f"{_MONTHS_SHORT[start.month-1]} {start.day} – {_MONTHS_SHORT[end.month-1]} {end.day}"
        if end.year != date.today().year:
            label += f", {end.year}"
        return start.isoformat(), label, start, end
    if granularity == "year":
        return str(d.year), str(d.year), date(d.year, 1, 1), date(d.year, 12, 31)
    # month (default)
    start = date(d.year, d.month, 1)
    if d.month == 12:
        end = date(d.year, 12, 31)
    else:
        end = date(d.year, d.month + 1, 1) - timedelta(days=1)
    return f"{d.year}-{d.month:02d}", f"{_MONTHS_SHORT[d.month-1]} {d.year}", start, end


@app.route("/api/energy-balance", methods=["GET"])
def energy_balance():
    """All-time energy balance, bucketed by week / month / year.

    Energy balance = calories consumed − calories expended, where daily
    expenditure = maintenance baseline (TDEE or goal) + exercise burned.
    Only days that actually have food logged ("tracked days") contribute, so
    un-logged days never inflate the surplus/deficit. A positive balance is a
    surplus (predicted weight gain); negative is a deficit (predicted loss).
    """
    from collections import defaultdict

    granularity = request.args.get("granularity", "month")
    if granularity not in ("week", "month", "year"):
        granularity = "month"

    # Client local "today" (Fly runs UTC) — never count future-dated rows.
    try:
        today = date.fromisoformat(request.args["date"]) if request.args.get("date") else date.today()
    except ValueError:
        today = date.today()

    p = UserProfile.query.first()
    baseline, baseline_source, goal, tdee = _resolve_baseline(p, request.args.get("baseline"))

    # Per-day calories consumed — a day is "tracked" only if it has food rows.
    consumed_by_day = defaultdict(int)
    for f in FoodEntry.query.all():
        if f.entry_date and f.entry_date <= today:
            consumed_by_day[f.entry_date] += f.calories or 0

    # Per-day calories burned via logged exercise.
    burned_by_day = defaultdict(int)
    for e in ExerciseEntry.query.all():
        if e.entry_date and e.entry_date <= today:
            burned_by_day[e.entry_date] += e.calories_burned or 0

    def _blank(key, label, start, end):
        return {
            "key": key, "label": label,
            "start": start.isoformat(), "end": end.isoformat(),
            "tracked_days": 0, "consumed": 0, "burned": 0,
        }

    buckets = {}
    overall = {"tracked_days": 0, "consumed": 0, "burned": 0}

    for d in sorted(consumed_by_day.keys()):
        consumed = consumed_by_day[d]
        burned   = burned_by_day.get(d, 0)
        key, label, start, end = _bucket_for(d, granularity)
        b = buckets.get(key) or _blank(key, label, start, end)
        b["tracked_days"] += 1
        b["consumed"]     += consumed
        b["burned"]       += burned
        buckets[key] = b
        overall["tracked_days"] += 1
        overall["consumed"]     += consumed
        overall["burned"]       += burned

    def _finalize(b):
        baseline_total = baseline * b["tracked_days"]
        expenditure    = baseline_total + b["burned"]
        bal            = b["consumed"] - expenditure
        b["baseline_total"]    = baseline_total
        b["expenditure"]       = expenditure
        b["balance"]           = bal
        b["avg_daily_balance"] = round(bal / b["tracked_days"]) if b["tracked_days"] else 0
        b["weight_change_lbs"] = round(bal / _CAL_PER_LB, 2)
        return b

    bucket_list = [_finalize(b) for b in sorted(buckets.values(), key=lambda x: x["start"])]
    overall.update({"key": "all", "label": "All time",
                    "start": bucket_list[0]["start"] if bucket_list else None,
                    "end":   bucket_list[-1]["end"]  if bucket_list else None})
    _finalize(overall)

    return jsonify({
        "granularity":     granularity,
        "baseline_source": baseline_source,   # "tdee" | "goal"
        "baseline_per_day": baseline,
        "goal":            goal,
        "tdee":            tdee,
        "today":           today.isoformat(),
        "buckets":         bucket_list,
        "overall":         overall,
    })


# ---------------------------------------------------------------------------
# Task Routes
# ---------------------------------------------------------------------------

@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    status    = request.args.get("status")
    list_name = request.args.get("list")
    q = Task.query
    if status:
        q = q.filter_by(status=status)
    if list_name:
        q = q.filter_by(list_name=list_name)
    tasks = q.order_by(Task.priority.asc(), Task.created_at.asc()).all()
    return jsonify([t.to_dict() for t in tasks])


@app.route("/api/tasks", methods=["POST"])
def create_task():
    data = request.get_json(force=True)
    if not data or not str(data.get("title", "")).strip():
        return jsonify({"error": "title is required."}), 422
    priority = int(data.get("priority", 3))
    if priority not in (1, 2, 3, 4):
        return jsonify({"error": "priority must be 1 (critical), 2 (high), 3 (medium), or 4 (low)."}), 422
    due = None
    if data.get("due_date"):
        try:
            due = date.fromisoformat(data["due_date"])
        except ValueError:
            return jsonify({"error": "Invalid due_date format. Use YYYY-MM-DD."}), 422
    list_name = data.get("list_name", "work")
    if list_name not in ("work", "personal"):
        list_name = "work"
    task = Task(
        title       = str(data["title"]).strip()[:300],
        description = data.get("description") or None,
        priority    = priority,
        status      = data.get("status", "todo"),
        list_name   = list_name,
        due_date    = due,
        tags        = data.get("tags") or None,
    )
    db.session.add(task)
    db.session.commit()
    return jsonify(task.to_dict()), 201


@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
def update_task(task_id):
    task = Task.query.get_or_404(task_id)
    data = request.get_json(force=True)
    if "title" in data:
        task.title = str(data["title"]).strip()[:300]
    if "description" in data:
        task.description = data["description"] or None
    if "priority" in data:
        task.priority = int(data["priority"])
    if "status" in data:
        task.status = data["status"]
        if data["status"] == "done" and not task.completed_at:
            task.completed_at = datetime.utcnow()
        elif data["status"] != "done":
            task.completed_at = None
    if "due_date" in data:
        task.due_date = date.fromisoformat(data["due_date"]) if data.get("due_date") else None
    if "tags" in data:
        task.tags = data["tags"] or None
    if "list_name" in data and data["list_name"] in ("work", "personal"):
        task.list_name = data["list_name"]
    task.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify(task.to_dict())


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    task = Task.query.get_or_404(task_id)
    db.session.delete(task)
    db.session.commit()
    return jsonify({"message": f"Task {task_id} deleted."})


@app.route("/api/tasks/stats", methods=["GET"])
def task_stats():
    all_tasks = Task.query.all()
    total = len(all_tasks)
    by_status   = {"todo": 0, "in_progress": 0, "done": 0}
    by_priority = {1: 0, 2: 0, 3: 0, 4: 0}
    for t in all_tasks:
        by_status[t.status]     = by_status.get(t.status, 0) + 1
        by_priority[t.priority] = by_priority.get(t.priority, 0) + 1
    return jsonify({
        "total":           total,
        "by_status":       by_status,
        "by_priority":     {str(k): v for k, v in by_priority.items()},
        "completion_rate": round(by_status["done"] / total * 100) if total else 0,
    })


def _extract_json(raw: str) -> dict:
    """Strip markdown fences and parse JSON from a Groq response."""
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.lower().startswith("json"):
            raw = raw[4:]
    # Find the first { ... } block in case there's extra prose
    start = raw.find("{")
    end   = raw.rfind("}") + 1
    if start != -1 and end > start:
        raw = raw[start:end]
    return json.loads(raw)


@app.route("/api/tasks/chat", methods=["POST"])
def tasks_chat():
    data      = request.get_json(force=True) or {}
    message   = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message required"}), 400

    list_name = data.get("list_name") or "work"
    if list_name not in ("work", "personal"):
        list_name = "work"

    pending_edit_id = data.get("pending_edit_id")

    existing = Task.query.filter(
        Task.status   != "done",
        Task.list_name == list_name,
    ).order_by(Task.priority, Task.created_at).all()

    list_label      = "Work" if list_name == "work" else "Personal"
    priority_labels = {1: "Critical", 2: "High", 3: "Medium", 4: "Low"}

    def fmt_tasks(tasks):
        if not tasks:
            return f"No active {list_label} tasks yet."
        return "\n".join(
            f"- [P{t.priority} {priority_labels.get(t.priority,'Medium')}] {t.title}"
            + (f", due {t.due_date}" if t.due_date else "")
            for t in tasks
        )

    tasks_text = fmt_tasks(existing)
    wants_add  = "add" in message.lower()

    try:
        from ai_service import _get_client, _call_with_retry
        client = _get_client()

        # ── Pending edit: user replied to a follow-up question ──────────────
        if pending_edit_id:
            task_to_edit = Task.query.get(int(pending_edit_id))
            if task_to_edit:
                today_str = date.today().isoformat()
                edit_prompt = f"""Today is {today_str}.
A user added a task and was asked if they want to set a due date or urgency level.
Task: "{task_to_edit.title}"
User's reply: "{message}"

Extract any date or priority mentioned. Reply with ONLY valid JSON — no prose, no markdown:
{{"due_date": "<YYYY-MM-DD or null>", "priority": <1-4 or null>, "dismissed": <true if user declined or topic is unrelated>, "reply": "<1 sentence: confirm what was updated, or acknowledge no change>"}}

Priority scale: 1=Critical, 2=High, 3=Medium, 4=Low. Convert relative dates to absolute ISO dates."""

                resp   = _call_with_retry(lambda: client.chat.completions.create(
                    model="llama-3.1-8b-instant",
                    messages=[{"role": "user", "content": edit_prompt}],
                    max_tokens=150,
                    temperature=0.2,
                ))
                parsed     = _extract_json(resp.choices[0].message.content)
                new_date   = parsed.get("due_date")
                new_pri    = parsed.get("priority")
                dismissed  = parsed.get("dismissed", False)
                edit_reply = str(parsed.get("reply", "Got it!"))

                if not dismissed and (new_date or new_pri in (1, 2, 3, 4)):
                    if new_date:
                        try:
                            task_to_edit.due_date = date.fromisoformat(new_date)
                        except ValueError:
                            pass
                    if new_pri in (1, 2, 3, 4):
                        task_to_edit.priority = int(new_pri)
                    db.session.commit()
                    return jsonify({"reply": edit_reply, "updated_task": task_to_edit.to_dict()})

                # Dismissed or no info extracted — fall through to normal processing
                if dismissed:
                    return jsonify({"reply": edit_reply or "No problem, task stays as is!"})

        # ── Add intent: create task immediately, then offer follow-up ────────
        if wants_add:
            today_str = date.today().isoformat()
            add_prompt = f"""Today is {today_str}. You are a task management assistant for a {list_label} task list.

Existing {list_label} tasks (ordered by priority):
{tasks_text}

User message: "{message}"

Extract task details. Reply with ONLY valid JSON — no prose, no markdown fences:
{{"title": "<concise task title>", "priority": <1-4>, "due_date": "<YYYY-MM-DD or null>", "has_explicit_priority": <true if user stated urgency/importance/priority>, "has_explicit_date": <true if user mentioned a date or timeframe>, "reply": "<confirmation message>"}}

Priority scale: 1=Critical (urgent/blocking), 2=High (important), 3=Medium (normal), 4=Low (nice to have). Default to 3 if not mentioned.
Convert relative dates to absolute ISO dates using today={today_str}. Set null if no date mentioned.

For the reply field:
- If BOTH date and urgency were explicitly stated: confirm briefly. Example: "Added 'submit report' — due May 30, High priority."
- If EITHER is missing: confirm with defaults, then offer to update. Example: "Added 'buy groceries' — no deadline, Medium priority. Want to change either? (e.g. 'Friday, high' or 'no thanks')" """

            resp   = _call_with_retry(lambda: client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": add_prompt}],
                max_tokens=260,
                temperature=0.3,
            ))
            parsed               = _extract_json(resp.choices[0].message.content)
            title                = str(parsed.get("title", "")).strip()[:300]
            priority             = int(parsed.get("priority", 3))
            due_date_str         = parsed.get("due_date")
            has_explicit_priority = bool(parsed.get("has_explicit_priority", False))
            has_explicit_date    = bool(parsed.get("has_explicit_date", False))
            reply                = str(parsed.get("reply", f"Added '{title}' to your {list_label} list."))

            if not title or priority not in (1, 2, 3, 4):
                return jsonify({"error": "Could not parse task from that message."}), 422

            due_date = None
            if due_date_str:
                try:
                    due_date = date.fromisoformat(due_date_str)
                except ValueError:
                    pass

            new_task = Task(title=title, priority=priority, due_date=due_date, list_name=list_name, status="todo")
            db.session.add(new_task)
            db.session.commit()

            ask_followup = not has_explicit_priority or not has_explicit_date
            return jsonify({
                "reply":        reply,
                "created_task": new_task.to_dict(),
                "ask_followup": ask_followup,
            })

        # ── Regular prioritization chat ───────────────────────────────────────
        prompt = (
            f"You are a concise productivity assistant for the user's {list_label} tasks.\n"
            f"Active {list_label} tasks:\n{tasks_text}\n\n"
            f"User: {message}\n\n"
            "Respond helpfully in under 120 words. "
            "If asked to prioritize, name the specific task to tackle first and why. "
            "Never repeat the task list verbatim."
        )
        resp = _call_with_retry(lambda: client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=250,
            temperature=0.7,
        ))
        return jsonify({"reply": resp.choices[0].message.content.strip()})

    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/tasks/completed", methods=["DELETE"])
def clear_completed_tasks():
    list_name = request.args.get("list")
    q = Task.query.filter_by(status="done")
    if list_name in ("work", "personal"):
        q = q.filter_by(list_name=list_name)
    count = q.delete()
    db.session.commit()
    return jsonify({"deleted": count})


# ---------------------------------------------------------------------------
# Weight Routes
# ---------------------------------------------------------------------------

@app.route("/api/weight", methods=["GET"])
def get_weight():
    limit    = request.args.get("limit", 730, type=int)
    from_str = request.args.get("from")
    q = WeightEntry.query.order_by(WeightEntry.entry_date.desc())
    if from_str:
        try:
            q = q.filter(WeightEntry.entry_date >= date.fromisoformat(from_str))
        except ValueError:
            pass
    entries = q.limit(limit).all()
    return jsonify([e.to_dict() for e in reversed(entries)])  # ascending for charts


@app.route("/api/weight", methods=["POST"])
def upsert_weight():
    data     = request.get_json(force=True) or {}
    date_str = (data.get("entry_date") or date.today().isoformat()).strip()
    try:
        entry_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid entry_date"}), 400
    try:
        weight_lbs = float(data.get("weight_lbs", 0))
        if not (0 < weight_lbs <= 1500):
            raise ValueError()
    except (TypeError, ValueError):
        return jsonify({"error": "weight_lbs must be a number between 0 and 1500"}), 422

    bfp = data.get("body_fat_pct")
    try:
        bfp = float(bfp) if bfp not in (None, "") else None
        if bfp is not None and not (0 <= bfp <= 100):
            return jsonify({"error": "body_fat_pct must be between 0 and 100"}), 422
    except (TypeError, ValueError):
        return jsonify({"error": "body_fat_pct must be a number"}), 422

    entry = WeightEntry.query.filter_by(entry_date=entry_date).first()
    if entry:
        entry.weight_lbs   = weight_lbs
        entry.body_fat_pct = bfp
        entry.notes        = data.get("notes") or entry.notes
    else:
        entry = WeightEntry(
            entry_date   = entry_date,
            weight_lbs   = weight_lbs,
            body_fat_pct = bfp,
            notes        = data.get("notes"),
        )
        db.session.add(entry)
    db.session.commit()

    # Sync UserProfile.weight_lbs to the most recent weight entry
    latest = WeightEntry.query.order_by(WeightEntry.entry_date.desc()).first()
    if latest:
        profile = UserProfile.query.first()
        if profile:
            profile.weight_lbs = latest.weight_lbs
            db.session.commit()

    return jsonify(entry.to_dict()), 200


@app.route("/api/weight/<int:entry_id>", methods=["DELETE"])
def delete_weight(entry_id):
    entry = WeightEntry.query.get_or_404(entry_id)
    db.session.delete(entry)
    db.session.commit()
    return jsonify({"message": f"Weight entry {entry_id} deleted."})


@app.route("/api/weight/stats", methods=["GET"])
def weight_stats():
    date_str = request.args.get("date")
    entries = WeightEntry.query.order_by(WeightEntry.entry_date.asc()).all()
    if not entries:
        return jsonify({"has_data": False})
    today = date.fromisoformat(date_str) if date_str else date.today()
    latest  = entries[-1]
    first   = entries[0]
    # 7-day change
    week_ago_entry = next(
        (e for e in reversed(entries[:-1])
         if (today - e.entry_date).days >= 5), None
    )
    # 30-day change
    month_ago_entry = next(
        (e for e in reversed(entries[:-1])
         if (today - e.entry_date).days >= 25), None
    )
    return jsonify({
        "has_data":    True,
        "current":     latest.to_dict(),
        "first":       first.to_dict(),
        "total_change": round(latest.weight_lbs - first.weight_lbs, 1),
        "week_change":  round(latest.weight_lbs - week_ago_entry.weight_lbs, 1)
                        if week_ago_entry else None,
        "month_change": round(latest.weight_lbs - month_ago_entry.weight_lbs, 1)
                        if month_ago_entry else None,
        "count":       len(entries),
    })


# ---------------------------------------------------------------------------
# Weekly Review Routes
# ---------------------------------------------------------------------------

def _week_bounds(ref_date):
    """Return (Monday, Sunday) for the week containing ref_date."""
    monday = ref_date - timedelta(days=ref_date.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


def _week_stats(week_start, week_end, cal_goal=2000):
    """Aggregate health data for the given week window."""
    sleep_entries = SleepEntry.query.filter(
        SleepEntry.entry_date >= week_start,
        SleepEntry.entry_date <= week_end,
    ).all()
    food_entries = FoodEntry.query.filter(
        FoodEntry.entry_date >= week_start,
        FoodEntry.entry_date <= week_end,
    ).all()
    cal_by_day = {}
    for f in food_entries:
        k = f.entry_date.isoformat()
        cal_by_day[k] = cal_by_day.get(k, 0) + f.calories
    ex_entries = ExerciseEntry.query.filter(
        ExerciseEntry.entry_date >= week_start,
        ExerciseEntry.entry_date <= week_end,
    ).all()
    mood_entries = MoodEntry.query.filter(
        MoodEntry.entry_date >= week_start,
        MoodEntry.entry_date <= week_end,
    ).all()
    habits = Habit.query.filter_by(is_active=True).all()
    habit_logs = HabitLog.query.filter(
        HabitLog.log_date >= week_start,
        HabitLog.log_date <= week_end,
        HabitLog.habit_id.in_([h.id for h in habits]),
    ).count()
    habit_possible = len(habits) * 7

    return {
        "sleep": {
            "nights":    len(sleep_entries),
            "avg_hours": round(sum((e.sleep_duration_minutes or 0) for e in sleep_entries) / len(sleep_entries) / 60, 1)
                         if sleep_entries else None,
            "avg_energy": round(sum(e.energy_score for e in sleep_entries) / len(sleep_entries), 1)
                          if sleep_entries else None,
        },
        "nutrition": {
            "days_tracked": len(cal_by_day),
            "avg_calories": int(sum(cal_by_day.values()) / len(cal_by_day)) if cal_by_day else None,
            "goal":         cal_goal,
            "days_over":    sum(1 for c in cal_by_day.values() if c > cal_goal * 1.1),
        },
        "exercise": {
            "sessions":     len(ex_entries),
            "workout_days": len(set(e.entry_date for e in ex_entries)),
            "total_mins":   sum(e.duration_minutes for e in ex_entries),
        },
        "mood": {
            "days_logged": len(mood_entries),
            "avg_score":   round(sum(e.mood_score for e in mood_entries) / len(mood_entries), 1)
                           if mood_entries else None,
        },
        "habits": {
            "total_habits":  len(habits),
            "logs":          habit_logs,
            "possible":      habit_possible,
            "pct":           int(habit_logs / habit_possible * 100) if habit_possible else 0,
        },
    }


def _score_plan(plan, stats):
    """Return traffic-light results for each plan target: green/yellow/red/gray."""
    if not plan:
        return {}
    results = {}

    if plan.target_sleep_hours:
        t = plan.target_sleep_hours
        a = stats["sleep"].get("avg_hours")
        if a is None:
            results["sleep"] = {"light": "gray",   "actual": None, "target": t, "unit": "h avg"}
        elif a >= t:
            results["sleep"] = {"light": "green",  "actual": a,    "target": t, "unit": "h avg"}
        elif a >= t * 0.88:
            results["sleep"] = {"light": "yellow", "actual": a,    "target": t, "unit": "h avg"}
        else:
            results["sleep"] = {"light": "red",    "actual": a,    "target": t, "unit": "h avg"}

    if plan.target_workouts:
        t = plan.target_workouts
        a = stats["exercise"]["workout_days"]
        if a >= t:
            results["workouts"] = {"light": "green",  "actual": a, "target": t, "unit": "days"}
        elif a >= t - 1:
            results["workouts"] = {"light": "yellow", "actual": a, "target": t, "unit": "days"}
        else:
            results["workouts"] = {"light": "red",    "actual": a, "target": t, "unit": "days"}

    if plan.target_calorie_days:
        t = plan.target_calorie_days
        a = stats["nutrition"]["days_tracked"]
        if a >= t:
            results["calorie_days"] = {"light": "green",  "actual": a, "target": t, "unit": "days"}
        elif a >= t - 1:
            results["calorie_days"] = {"light": "yellow", "actual": a, "target": t, "unit": "days"}
        else:
            results["calorie_days"] = {"light": "red",    "actual": a, "target": t, "unit": "days"}

    if plan.target_habit_pct:
        t = plan.target_habit_pct
        a = stats["habits"]["pct"]
        if a >= t:
            results["habit_pct"] = {"light": "green",  "actual": a, "target": t, "unit": "%"}
        elif a >= t * 0.85:
            results["habit_pct"] = {"light": "yellow", "actual": a, "target": t, "unit": "%"}
        else:
            results["habit_pct"] = {"light": "red",    "actual": a, "target": t, "unit": "%"}

    return results


@app.route("/api/weekly-review/current", methods=["GET"])
def get_current_review():
    cal_goal = request.args.get("cal_goal", 2000, type=int)
    date_str = request.args.get("date")
    try:
        today = date.fromisoformat(date_str) if date_str else date.today()
    except ValueError:
        today = date.today()
    ws, we   = _week_bounds(today)
    review   = WeeklyReview.query.filter_by(week_start=ws).first()
    stats    = _week_stats(ws, we, cal_goal)
    plan     = WeeklyPlan.query.filter_by(week_start=ws).first()

    # Previous week's plan for carry-forward
    prev_ws  = ws - timedelta(days=7)
    prev_plan = WeeklyPlan.query.filter_by(week_start=prev_ws).first()

    return jsonify({
        "review":      review.to_dict() if review else None,
        "week_start":  ws.isoformat(),
        "week_end":    we.isoformat(),
        "stats":       stats,
        "plan":        plan.to_dict() if plan else None,
        "prev_plan":   prev_plan.to_dict() if prev_plan else None,
        "plan_scores": _score_plan(plan, stats),
    })


@app.route("/api/weekly-review", methods=["GET"])
def list_reviews():
    reviews = WeeklyReview.query.order_by(WeeklyReview.week_start.desc()).all()
    return jsonify([r.to_dict() for r in reviews])


@app.route("/api/weekly-review", methods=["POST"])
def save_review():
    data     = request.get_json(force=True) or {}
    date_str = (data.get("week_start") or "").strip()
    try:
        ws = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid week_start (YYYY-MM-DD)"}), 400
    _, we = _week_bounds(ws)

    def _opt_int(key):
        v = data.get(key)
        try:
            i = int(v)
            return i if 1 <= i <= 5 else None
        except (TypeError, ValueError):
            return None

    review = WeeklyReview.query.filter_by(week_start=ws).first()
    if review:
        review.week_end         = we
        review.rating_sleep     = _opt_int("rating_sleep")
        review.rating_nutrition = _opt_int("rating_nutrition")
        review.rating_exercise  = _opt_int("rating_exercise")
        review.rating_mood      = _opt_int("rating_mood")
        review.rating_habits    = _opt_int("rating_habits")
        review.rating_overall   = _opt_int("rating_overall")
        review.went_well        = data.get("went_well")  or review.went_well
        review.fell_apart       = data.get("fell_apart") or review.fell_apart
        review.next_focus       = data.get("next_focus") or review.next_focus
    else:
        review = WeeklyReview(
            week_start       = ws,
            week_end         = we,
            rating_sleep     = _opt_int("rating_sleep"),
            rating_nutrition = _opt_int("rating_nutrition"),
            rating_exercise  = _opt_int("rating_exercise"),
            rating_mood      = _opt_int("rating_mood"),
            rating_habits    = _opt_int("rating_habits"),
            rating_overall   = _opt_int("rating_overall"),
            went_well        = data.get("went_well"),
            fell_apart       = data.get("fell_apart"),
            next_focus       = data.get("next_focus"),
        )
        db.session.add(review)
    db.session.commit()
    return jsonify(review.to_dict())


@app.route("/api/weekly-review/<int:review_id>/generate-summary", methods=["POST"])
def generate_review_summary(review_id):
    review   = WeeklyReview.query.get_or_404(review_id)
    cal_goal = request.get_json(force=True).get("cal_goal", 2000) if request.data else 2000
    stats    = _week_stats(review.week_start, review.week_end, cal_goal)

    star = lambda r: ("★" * r + "☆" * (5 - r)) if r else "Not rated"
    s = stats

    prompt = (
        "You are a warm, direct wellness coach writing a concise weekly review summary.\n\n"
        f"WEEK: {review.week_start} to {review.week_end}\n\n"
        "ACTUAL DATA:\n"
        f"  Sleep:     {s['sleep']['nights']}/7 nights, avg {s['sleep']['avg_hours']}h, "
        f"avg energy {s['sleep']['avg_energy']}/10\n"
        f"  Nutrition: {s['nutrition']['days_tracked']}/7 days tracked, "
        f"avg {s['nutrition']['avg_calories']} cal (goal {s['nutrition']['goal']}), "
        f"{s['nutrition']['days_over']} days over\n"
        f"  Exercise:  {s['exercise']['sessions']} sessions, {s['exercise']['total_mins']} min\n"
        f"  Mood:      {s['mood']['days_logged']}/7 days, avg {s['mood']['avg_score']}/10\n"
        f"  Habits:    {s['habits']['pct']}% completion ({s['habits']['logs']}/{s['habits']['possible']})\n\n"
        "SELF-RATINGS:\n"
        f"  Sleep {star(review.rating_sleep)}  Nutrition {star(review.rating_nutrition)}  "
        f"Exercise {star(review.rating_exercise)}  Mood {star(review.rating_mood)}  "
        f"Habits {star(review.rating_habits)}  Overall {star(review.rating_overall)}\n\n"
        f"REFLECTIONS:\n"
        f"  Went well:  {review.went_well or '(not filled)'}\n"
        f"  Fell apart: {review.fell_apart or '(not filled)'}\n"
        f"  Next focus: {review.next_focus or '(not filled)'}\n\n"
        "Write a 120–160 word weekly summary that:\n"
        "1. Opens with a one-sentence overall verdict\n"
        "2. Calls out 1-2 specific wins (reference real numbers)\n"
        "3. Flags any gap between a high self-rating and underwhelming data (or vice versa)\n"
        "4. Closes with ONE clear, specific action for next week\n"
        "Tone: coach-like, warm, honest. No bullet lists."
    )

    try:
        from ai_service import _get_client, _call_with_retry
        client  = _get_client()
        resp    = _call_with_retry(lambda: client.chat.completions.create(
            model       = "llama-3.1-8b-instant",
            messages    = [{"role": "user", "content": prompt}],
            max_tokens  = 300,
            temperature = 0.65,
        ))
        summary = resp.choices[0].message.content.strip()
        review.ai_summary = summary
        db.session.commit()
        return jsonify({"summary": summary})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/weekly-plan", methods=["GET"])
def get_weekly_plan():
    week_start_str = request.args.get("week_start", "").strip()
    if not week_start_str:
        date_str = request.args.get("date", "").strip()
        try:
            ref = date.fromisoformat(date_str) if date_str else date.today()
        except ValueError:
            ref = date.today()
        ws, _ = _week_bounds(ref)
        week_start_str = ws.isoformat()
    try:
        week_start_d = date.fromisoformat(week_start_str)
    except ValueError:
        return jsonify(None)
    plan = WeeklyPlan.query.filter_by(week_start=week_start_d).first()
    return jsonify(plan.to_dict() if plan else None)


@app.route("/api/weekly-plan", methods=["POST"])
def upsert_weekly_plan():
    data = request.get_json(force=True) or {}
    week_start_str = (data.get("week_start") or "").strip()
    if not week_start_str:
        date_str = (data.get("date") or "").strip()
        try:
            ref = date.fromisoformat(date_str) if date_str else date.today()
        except ValueError:
            ref = date.today()
        ws, _ = _week_bounds(ref)
        week_start_d = ws
    else:
        try:
            week_start_d = date.fromisoformat(week_start_str)
        except ValueError:
            return jsonify({"error": "Invalid week_start (YYYY-MM-DD)"}), 400

    def _opt_float(key):
        v = data.get(key)
        try:
            return float(v) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None

    def _opt_int(key):
        v = data.get(key)
        try:
            return int(v) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None

    plan = WeeklyPlan.query.filter_by(week_start=week_start_d).first()
    if plan is None:
        plan = WeeklyPlan(week_start=week_start_d)
        db.session.add(plan)

    plan.target_sleep_hours  = _opt_float("target_sleep_hours")
    plan.target_workouts     = _opt_int("target_workouts")
    plan.target_calorie_days = _opt_int("target_calorie_days")
    plan.target_habit_pct    = _opt_int("target_habit_pct")
    plan.notes               = (data.get("notes") or "").strip() or None
    db.session.commit()
    return jsonify(plan.to_dict())


# ---------------------------------------------------------------------------
# Today Snapshot
# ---------------------------------------------------------------------------

@app.route("/api/today")
def today_snapshot():
    date_str = request.args.get("date")
    try:
        today = date.fromisoformat(date_str) if date_str else date.today()
    except ValueError:
        today = date.today()
    cal_goal  = request.args.get("cal_goal", type=int) or 2000
    if cal_goal <= 0:
        cal_goal = 2000

    last_sleep = SleepEntry.query.order_by(SleepEntry.entry_date.desc()).first()
    sleep_data = None
    if last_sleep:
        hrs = round((last_sleep.sleep_duration_minutes or 0) / 60, 1)
        sleep_data = {
            "date":             last_sleep.entry_date.isoformat(),
            "duration_hours":   hrs,
            "energy_score":     last_sleep.energy_score,
            "inertia_score":    last_sleep.inertia_score,
            "is_last_night":    last_sleep.entry_date >= today - timedelta(days=1),
        }

    food_today = FoodEntry.query.filter_by(entry_date=today).all()
    cal_today  = sum(f.calories for f in food_today)

    active_tasks    = Task.query.filter(Task.status != "done").order_by(Task.priority, Task.created_at).all()
    top             = active_tasks[0] if active_tasks else None
    work_count      = sum(1 for t in active_tasks if t.list_name == "work")
    personal_count  = sum(1 for t in active_tasks if t.list_name == "personal")

    habits     = Habit.query.filter_by(is_active=True).all()
    done_today = sum(1 for h in habits if h.logged_today(today))

    mood_today       = MoodEntry.query.filter_by(entry_date=today).first()
    exercise_today    = ExerciseEntry.query.filter_by(entry_date=today).all()
    exercise_minutes  = sum(e.duration_minutes for e in exercise_today)
    exercise_calories = sum(e.calories_burned or 0 for e in exercise_today)
    hydration         = HydrationLog.query.filter_by(log_date=today).first()

    # Weight
    latest_weight = WeightEntry.query.order_by(WeightEntry.entry_date.desc()).first()
    prev_weight   = None
    if latest_weight:
        prev_weight = (WeightEntry.query
                       .filter(WeightEntry.entry_date < latest_weight.entry_date)
                       .order_by(WeightEntry.entry_date.desc()).first())

    # Weekly review status
    week_start     = today - timedelta(days=today.weekday())
    current_review = WeeklyReview.query.filter_by(week_start=week_start).first()

    net_calories = cal_today - exercise_calories

    # Yesterday deltas
    yesterday         = today - timedelta(days=1)
    yday_sleep        = SleepEntry.query.filter_by(entry_date=yesterday).first()
    yday_mood         = MoodEntry.query.filter_by(entry_date=yesterday).first()
    yday_hydration    = HydrationLog.query.filter_by(log_date=yesterday).first()
    yday_habits_done  = sum(1 for h in habits if h.logged_today(yesterday))
    yday_habit_pct    = round(yday_habits_done / len(habits) * 100) if habits else None
    yday_sleep_hrs    = round((yday_sleep.sleep_duration_minutes or 0) / 60, 1) if yday_sleep else None

    return jsonify({
        "sleep":    sleep_data,
        "calories": {
            "total":     cal_today,
            "goal":      cal_goal,
            "remaining": cal_goal - cal_today,
            "items":     len(food_today),
        },
        "tasks":    {
            "active":   len(active_tasks),
            "work":     work_count,
            "personal": personal_count,
            "top_task":     top.title    if top else None,
            "top_priority": top.priority if top else None,
        },
        "habits":   {"done": done_today, "total": len(habits)},
        "mood":     {"score": mood_today.mood_score, "energy": mood_today.energy_score, "anxiety": mood_today.anxiety_score} if mood_today else None,
        "exercise": {
            "sessions":       len(exercise_today),
            "total_minutes":  exercise_minutes,
            "calories_burned": exercise_calories,
        },
        "hydration":    {"glasses": hydration.glasses if hydration else 0, "goal": hydration.goal if hydration else 8},
        "weight": {
            "current":     round(latest_weight.weight_lbs, 1) if latest_weight else None,
            "date":        latest_weight.entry_date.isoformat() if latest_weight else None,
            "prev":        round(prev_weight.weight_lbs, 1) if prev_weight else None,
            "change":      round(latest_weight.weight_lbs - prev_weight.weight_lbs, 1)
                           if (latest_weight and prev_weight) else None,
        },
        "weekly_review": {
            "week_start":     week_start.isoformat(),
            "completed":      current_review is not None,
            "overall_rating": current_review.rating_overall if current_review else None,
        },
        "energy_balance": {
            "consumed":    cal_today,
            "burned":      exercise_calories,
            "net":         net_calories,
            "goal":        cal_goal,
            "balance":     cal_goal - net_calories,   # positive = deficit, negative = surplus
            "has_exercise": exercise_calories > 0,
        },
        "yesterday": {
            "sleep_hours":       yday_sleep_hrs,
            "mood_score":        yday_mood.mood_score if yday_mood else None,
            "habit_pct":         yday_habit_pct,
            "hydration_glasses": yday_hydration.glasses if yday_hydration else None,
        },
    })


# ---------------------------------------------------------------------------
# Habits
# ---------------------------------------------------------------------------

@app.route("/api/habits", methods=["GET"])
def get_habits():
    date_str = request.args.get("date")
    try:
        today = date.fromisoformat(date_str) if date_str else date.today()
    except ValueError:
        today = date.today()
    habits = Habit.query.filter_by(is_active=True).order_by(Habit.created_at).all()
    return jsonify([h.to_dict(today=today) for h in habits])


@app.route("/api/habits", methods=["POST"])
def create_habit():
    data  = request.get_json(force=True) or {}
    name  = (data.get("name") or "").strip()[:100]
    if not name:
        return jsonify({"error": "name required"}), 422
    icon  = (data.get("icon") or "⭐")[:10]
    color = (data.get("color") or "#00d4aa")[:7]
    habit = Habit(name=name, icon=icon, color=color)
    db.session.add(habit)
    db.session.commit()
    return jsonify(habit.to_dict()), 201


@app.route("/api/habits/<int:habit_id>", methods=["DELETE"])
def delete_habit(habit_id):
    habit = Habit.query.get_or_404(habit_id)
    habit.is_active = False
    db.session.commit()
    return jsonify({"message": "Habit deactivated."})


@app.route("/api/habits/log", methods=["POST"])
def toggle_habit_log():
    data      = request.get_json(force=True) or {}
    habit_id  = data.get("habit_id")
    date_str  = data.get("log_date") or date.today().isoformat()
    if not habit_id:
        return jsonify({"error": "habit_id required"}), 422
    habit    = Habit.query.get_or_404(habit_id)
    log_date = date.fromisoformat(date_str)
    existing = HabitLog.query.filter_by(habit_id=habit_id, log_date=log_date).first()
    if existing:
        db.session.delete(existing)
        logged = False
    else:
        db.session.add(HabitLog(habit_id=habit_id, log_date=log_date))
        logged = True
    db.session.commit()
    # Reload logs for streak calc, use the client's date so streak is correct
    db.session.refresh(habit)
    return jsonify({"logged": logged, "streak": habit.current_streak(log_date)})


@app.route("/api/habits/grid")
def habits_grid():
    days     = min(int(request.args.get("days", 84)), 365)
    date_str = request.args.get("date")
    try:
        today = date.fromisoformat(date_str) if date_str else date.today()
    except ValueError:
        today = date.today()
    start = today - timedelta(days=days - 1)

    habits = Habit.query.filter_by(is_active=True).order_by(Habit.created_at).all()
    if not habits:
        return jsonify({"days": days, "start_date": start.isoformat(), "habits": []})

    logs = HabitLog.query.filter(
        HabitLog.log_date >= start,
        HabitLog.habit_id.in_([h.id for h in habits]),
    ).all()

    logs_by_habit = {}
    for l in logs:
        logs_by_habit.setdefault(l.habit_id, set()).add(l.log_date.isoformat())

    return jsonify({
        "days":       days,
        "start_date": start.isoformat(),
        "habits": [
            {
                "id":     h.id,
                "name":   h.name,
                "icon":   h.icon,
                "color":  h.color,
                "streak": h.current_streak(today),
                "logs":   sorted(logs_by_habit.get(h.id, [])),
            }
            for h in habits
        ],
    })


# ---------------------------------------------------------------------------
# Mood Routes
# ---------------------------------------------------------------------------

@app.route("/api/mood", methods=["GET"])
def get_mood():
    date_str = request.args.get("date")
    if date_str:
        try:
            d = date.fromisoformat(date_str)
        except ValueError:
            return jsonify({"error": "Invalid date"}), 400
        entry = MoodEntry.query.filter_by(entry_date=d).first()
        return jsonify(entry.to_dict() if entry else None)
    limit   = request.args.get("limit", 30, type=int)
    entries = MoodEntry.query.order_by(MoodEntry.entry_date.desc()).limit(limit).all()
    return jsonify([e.to_dict() for e in entries])


@app.route("/api/mood", methods=["POST"])
def upsert_mood():
    data       = request.get_json(force=True) or {}
    date_str   = (data.get("entry_date") or date.today().isoformat()).strip()
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid entry_date"}), 400

    try:
        mood_score = int(data.get("mood_score", 5))
        if not (1 <= mood_score <= 10):
            raise ValueError()
    except (TypeError, ValueError):
        return jsonify({"error": "mood_score must be 1–10"}), 422

    def _opt_int(key):
        v = data.get(key)
        return int(v) if v not in (None, "") else None

    # Validate tags — must be a list of known strings
    raw_tags = data.get("tags") or []
    if isinstance(raw_tags, str):
        try:
            raw_tags = json.loads(raw_tags)
        except Exception:
            raw_tags = []
    tags_json = json.dumps([t for t in raw_tags if isinstance(t, str)][:20])

    entry = MoodEntry.query.filter_by(entry_date=d).first()
    if entry:
        entry.mood_score    = mood_score
        entry.energy_score  = _opt_int("energy_score")
        entry.anxiety_score = _opt_int("anxiety_score")
        entry.note          = data.get("note") or entry.note
        entry.tags          = tags_json
    else:
        entry = MoodEntry(
            entry_date    = d,
            mood_score    = mood_score,
            energy_score  = _opt_int("energy_score"),
            anxiety_score = _opt_int("anxiety_score"),
            note          = data.get("note"),
            tags          = tags_json,
        )
        db.session.add(entry)
    db.session.commit()
    return jsonify(entry.to_dict())


# ---------------------------------------------------------------------------
# Exercise Routes
# ---------------------------------------------------------------------------

EXERCISE_TYPES = ("cardio", "strength", "flexibility", "sports", "other")


@app.route("/api/exercise", methods=["GET"])
def get_exercise():
    date_str = request.args.get("date")
    if date_str:
        try:
            d = date.fromisoformat(date_str)
        except ValueError:
            return jsonify({"error": "Invalid date"}), 400
        entries = ExerciseEntry.query.filter_by(entry_date=d).order_by(ExerciseEntry.created_at).all()
    else:
        limit   = request.args.get("limit", 60, type=int)
        entries = ExerciseEntry.query.order_by(
            ExerciseEntry.entry_date.desc(), ExerciseEntry.created_at.desc()
        ).limit(limit).all()
    return jsonify([e.to_dict() for e in entries])


@app.route("/api/exercise", methods=["POST"])
def create_exercise():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 422

    ex_type = data.get("exercise_type", "other")
    if ex_type not in EXERCISE_TYPES:
        ex_type = "other"

    is_strength = ex_type == "strength"
    try:
        duration = int(data.get("duration_minutes") or 0)
        if duration < 0:
            duration = 0
        if not is_strength and duration <= 0:
            raise ValueError()
    except (TypeError, ValueError):
        return jsonify({"error": "duration_minutes must be a positive integer"}), 422

    try:
        entry_date = date.fromisoformat(data.get("entry_date") or date.today().isoformat())
    except ValueError:
        return jsonify({"error": "Invalid entry_date"}), 400

    def _opt_int(key):
        v = data.get(key)
        return int(v) if v not in (None, "") else None

    def _opt_float(key):
        v = data.get(key)
        return float(v) if v not in (None, "") else None

    group_name = (data.get("group_name") or "").strip() or None

    entry = ExerciseEntry(
        entry_date       = entry_date,
        exercise_type    = ex_type,
        name             = name[:100],
        duration_minutes = duration,
        intensity        = _opt_int("intensity"),
        calories_burned  = _opt_int("calories_burned"),
        sets             = _opt_int("sets"),
        reps             = _opt_int("reps"),
        weight_lbs       = _opt_float("weight_lbs"),
        group_name       = group_name[:100] if group_name else None,
        notes            = data.get("notes"),
    )
    db.session.add(entry)
    db.session.commit()
    return jsonify(entry.to_dict()), 201


@app.route("/api/exercise/<int:entry_id>", methods=["DELETE"])
def delete_exercise(entry_id):
    entry = ExerciseEntry.query.get_or_404(entry_id)
    db.session.delete(entry)
    db.session.commit()
    return jsonify({"message": f"Exercise entry {entry_id} deleted."})


@app.route("/api/exercise/rename-group", methods=["PATCH"])
def rename_exercise_group():
    data     = request.get_json(force=True) or {}
    date_str = (data.get("date") or "").strip()
    old_name = (data.get("old_name") or "").strip()
    new_name = (data.get("new_name") or "").strip() or None
    if not date_str or not old_name:
        return jsonify({"error": "date and old_name required"}), 400
    try:
        entry_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid date"}), 400
    entries = ExerciseEntry.query.filter_by(entry_date=entry_date, group_name=old_name).all()
    for e in entries:
        e.group_name = new_name[:100] if new_name else None
    db.session.commit()
    return jsonify({"updated": len(entries)})


@app.route("/api/exercise/ai-summary", methods=["POST"])
def exercise_ai_summary():
    data     = request.get_json(force=True) or {}
    date_str = (data.get("date") or date.today().isoformat()).strip()
    try:
        entry_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid date"}), 400

    last_weight = WeightEntry.query.order_by(WeightEntry.entry_date.desc()).first()
    body_lbs    = float(last_weight.weight_lbs) if last_weight else 175.0
    body_kg     = round(body_lbs / 2.2046, 1)
    # Calories burned per minute at MET 1.0 for this athlete
    cal_per_min_per_met = round((3.5 * body_kg) / 200.0, 4)

    def _strength_duration_min(sets, reps):
        """Realistic working time for one strength exercise (sets×reps)."""
        s = max(1, int(sets or 3))
        r = max(1, int(reps or 8))
        # Rest between sets: longer for heavy/neural, shorter for high-rep
        rest_sec = 150 if r <= 5 else (60 if r >= 13 else 90)
        tut_sec  = s * r * 3          # 3 s per rep (eccentric + concentric)
        rest_total = (s - 1) * rest_sec
        return round((tut_sec + rest_total + 30) / 60.0, 1)

    # Accept pre-form exercises (not yet saved to DB) so the Add modal
    # can get a summary of what the user is currently filling in.
    raw_exercises = data.get("exercises")

    if raw_exercises:
        ex_lines = []
        for e in raw_exercises:
            name = (e.get("name") or "").strip()
            if not name:
                continue
            if e.get("sets"):
                dur = _strength_duration_min(e.get("sets"), e.get("reps"))
                wt  = f"{e['weight_lbs']} lbs" if e.get("weight_lbs") else "bodyweight"
                detail = f"{e['sets']}×{e.get('reps') or '?'} @ {wt} | working time: {dur} min"
            else:
                parts = [f"{e.get('duration_minutes') or 0} min"]
                if e.get("intensity"):
                    parts.append(f"intensity {e['intensity']}/10")
                if e.get("calories_burned"):
                    parts.append(f"{e['calories_burned']} cal logged")
                detail = ", ".join(parts)
            prefix = f"[{e['group_name']}] " if e.get("group_name") else ""
            ex_lines.append(f"  {prefix}{name}: {detail}")
        if not ex_lines:
            return jsonify({"error": "No valid exercises provided"}), 400
    else:
        exercises = ExerciseEntry.query.filter_by(entry_date=entry_date).all()
        if not exercises:
            return jsonify({"error": "No exercises logged for this date"}), 400
        ex_lines = []
        for e in exercises:
            if e.sets:
                dur = _strength_duration_min(e.sets, e.reps)
                wt  = f"{e.weight_lbs} lbs" if e.weight_lbs else "bodyweight"
                detail = f"{e.sets}×{e.reps or '?'} @ {wt} | working time: {dur} min"
            else:
                parts = [f"{e.duration_minutes} min"]
                if e.intensity:
                    parts.append(f"intensity {e.intensity}/10")
                if e.calories_burned:
                    parts.append(f"{e.calories_burned} cal logged")
                detail = ", ".join(parts)
            prefix = f"[{e.group_name}] " if e.group_name else ""
            ex_lines.append(f"  {prefix}{e.name}: {detail}")

    food_today  = FoodEntry.query.filter_by(entry_date=entry_date).all()
    cal_consumed = sum(f.calories for f in food_today)

    week_ago = entry_date - timedelta(days=7)
    week_ex  = ExerciseEntry.query.filter(
        ExerciseEntry.entry_date >= week_ago,
        ExerciseEntry.entry_date <  entry_date,
    ).all()
    week_sessions = len(set(e.entry_date for e in week_ex))
    week_mins     = sum(e.duration_minutes for e in week_ex)

    prompt = (
        f"You are an exercise scientist. Estimate calories burned for each exercise using the MET formula, "
        f"then give a brief workout analysis.\n\n"
        f"ATHLETE: {body_lbs} lbs ({body_kg} kg)\n"
        f"CALORIE FORMULA: calories = MET × {cal_per_min_per_met} × working_time_min\n\n"
        f"MET REFERENCE TABLE (strength lifts only — do NOT use these for cardio):\n"
        f"  7.5 — Heavy compound: squat, deadlift, Romanian deadlift, power clean, trap bar deadlift, hip thrust\n"
        f"  6.0 — Moderate compound: bench press, overhead press, incline press, barbell/dumbbell row, "
        f"pull-up, chin-up, dip, lunge, Bulgarian split squat, kettlebell swing\n"
        f"  5.0 — Machine/cable compound: leg press, lat pulldown, cable row, chest press machine, "
        f"seated row, hack squat\n"
        f"  3.8 — Upper-body isolation: curl, tricep extension/pushdown, lateral raise, front raise, "
        f"face pull, chest fly, shrug, reverse fly\n"
        f"  4.2 — Lower-body isolation: leg extension, leg curl, calf raise, hip abduction/adduction\n"
        f"For cardio/sports: use appropriate MET (running 8–11, cycling 6–9, yoga 2.5, sports 5–8) × actual duration.\n\n"
        f"TODAY'S WORKOUT ({entry_date}):\n" + "\n".join(ex_lines) + "\n\n"
        f"CRITICAL: For strength exercises, the 'working time' shown above is already calculated from "
        f"(sets × reps × 3 s/rep + rest between sets). Use that number — do NOT assume a 45-60 min session. "
        f"A single 3×8 bench press takes ~5 working minutes, NOT 45.\n\n"
        f"FOOD CONSUMED TODAY: {cal_consumed} cal\n"
        f"RECENT TRAINING: {week_sessions} sessions, {week_mins} total minutes in the past 7 days\n\n"
        f"Provide exactly 3 lines:\n"
        f"1. Estimated calories burned: X cal — per-exercise breakdown (name: cal each)\n"
        f"2. Energy balance: {cal_consumed} consumed − X burned = Y net cal\n"
        f"3. Training note: 1–2 sentences on effort, recovery, or next session suggestion\n\n"
        f"Be specific with numbers. Total response under 110 words."
    )

    try:
        from ai_service import _get_client, _call_with_retry
        client = _get_client()
        resp = _call_with_retry(lambda: client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=260,
            temperature=0.2,
        ))
        return jsonify({"summary": resp.choices[0].message.content.strip()})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Exercise MET lookup table — keyword matching, most-specific first
# MET tiers: 7.5 heavy compound, 6.0 moderate compound, 5.0 machine/cable,
#            4.2 lower-body isolation, 3.8 upper-body isolation
# ---------------------------------------------------------------------------
_STRENGTH_MET_TABLE = [
    # Multi-word patterns checked before their component words
    ("hack squat",          5.0),
    ("split squat",         6.0),
    ("hip thrust",          7.5),
    ("power clean",         7.5),
    ("trap bar",            7.5),
    ("romanian deadlift",   7.5),
    ("rdl",                 7.5),
    ("sumo deadlift",       7.5),
    ("bench press",         6.0),
    ("overhead press",      6.0),
    ("incline press",       6.0),
    ("decline press",       6.0),
    ("chest press",         5.0),
    ("lat pulldown",        5.0),
    ("cable pullover",      5.0),
    ("cable row",           5.0),
    ("seated row",          5.0),
    ("leg press",           5.0),
    ("leg extension",       4.2),
    ("leg curl",            4.2),
    ("calf raise",          4.2),
    ("glute kickback",      4.2),
    ("hip abduction",       4.2),
    ("hip adduction",       4.2),
    ("lateral raise",       3.8),
    ("front raise",         3.8),
    ("face pull",           3.8),
    ("pec deck",            3.8),
    ("reverse fly",         3.8),
    ("wrist curl",          3.8),
    ("tricep extension",    3.8),
    ("overhead extension",  3.8),
    ("pull-up",             6.0),
    ("pull up",             6.0),
    ("chin-up",             6.0),
    ("chin up",             6.0),
    ("step-up",             6.0),
    ("step up",             6.0),
    ("kb swing",            6.0),
    # Single-word patterns
    ("pullup",              6.0),
    ("chinup",              6.0),
    ("deadlift",            7.5),
    ("clean",               7.5),
    ("snatch",              7.5),
    ("squat",               7.5),
    ("pulldown",            5.0),
    ("pullover",            5.0),
    ("row",                 6.0),
    ("dip",                 6.0),
    ("lunge",               6.0),
    ("kettlebell",          6.0),
    ("swing",               6.0),
    ("press",               6.0),
    ("curl",                3.8),
    ("tricep",              3.8),
    ("pushdown",            3.8),
    ("fly",                 3.8),
    ("shrug",               3.8),
    ("raise",               3.8),
    ("extension",           3.8),
    ("glute",               4.2),
    ("calf",                4.2),
    ("abduction",           4.2),
    ("adduction",           4.2),
]
_DEFAULT_MET = 4.0


def _lookup_met(name: str) -> float:
    n = name.lower()
    for keyword, met in _STRENGTH_MET_TABLE:
        if keyword in n:
            return met
    return _DEFAULT_MET


@app.route("/api/exercise/estimate-calories", methods=["POST"])
def exercise_estimate_calories():
    data      = request.get_json(force=True) or {}
    exercises = data.get("exercises") or []

    valid_ex = [e for e in exercises if (e.get("name") or "").strip()]
    if not valid_ex:
        return jsonify({"error": "No exercises provided"}), 400

    last_weight = WeightEntry.query.order_by(WeightEntry.entry_date.desc()).first()
    body_lbs    = float(last_weight.weight_lbs) if last_weight else 175.0
    body_kg     = round(body_lbs / 2.2046, 1)
    cal_per_min_per_met = (3.5 * body_kg) / 200.0

    computed = []
    ex_summary_lines = []
    for e in valid_ex:
        name   = (e.get("name") or "").strip()
        sets   = max(1, int(e.get("sets")  or 3))
        reps   = max(1, int(e.get("reps")  or 8))
        weight = e.get("weight_lbs") or None

        if reps <= 5:
            rest_sec, load_mult = 150, 1.15
        elif reps >= 13:
            rest_sec, load_mult = 60,  0.90
        else:
            rest_sec, load_mult = 90,  1.0

        tut_sec      = sets * reps * 3
        rest_total   = (sets - 1) * rest_sec
        duration_min = (tut_sec + rest_total + 30) / 60.0

        met      = _lookup_met(name)
        calories = round(met * cal_per_min_per_met * duration_min * load_mult)

        computed.append({"name": name, "calories": calories})
        weight_str = f"{weight} lbs" if weight else "bodyweight"
        ex_summary_lines.append(f"- {name} {sets}×{reps} @ {weight_str}: {calories} cal")

    total = sum(ex["calories"] for ex in computed)

    # LLM used only for the one-sentence note
    note = ""
    try:
        from ai_service import _get_client, _call_with_retry
        ex_list = "\n".join(ex_summary_lines)
        note_prompt = (
            f"Athlete {body_lbs:.0f} lbs. Today's strength session ({total} cal total):\n{ex_list}\n\n"
            f"Write one short sentence about session intensity or primary muscle groups worked."
        )
        client = _get_client()
        resp = _call_with_retry(lambda: client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": note_prompt}],
            max_tokens=60,
            temperature=0.5,
        ))
        note = resp.choices[0].message.content.strip()
    except Exception:
        pass

    return jsonify({"exercises": computed, "total": total, "note": note})


# ---------------------------------------------------------------------------
# Exercise Template Routes
# ---------------------------------------------------------------------------

@app.route("/api/exercise/templates", methods=["GET"])
def get_exercise_templates():
    templates = ExerciseTemplate.query.order_by(ExerciseTemplate.created_at.desc()).all()
    return jsonify([t.to_dict() for t in templates])


@app.route("/api/exercise/templates", methods=["POST"])
def create_exercise_template():
    data  = request.get_json(force=True) or {}
    name  = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    items_data = data.get("items") or []
    if not items_data:
        return jsonify({"error": "at least one exercise item required"}), 400

    template = ExerciseTemplate(
        name    = name[:100],
        day_tag = (data.get("day_tag") or "").strip()[:20] or None,
        notes   = (data.get("notes") or "").strip() or None,
    )
    db.session.add(template)
    db.session.flush()

    for idx, item in enumerate(items_data):
        ex_name = (item.get("name") or "").strip()
        if not ex_name:
            continue
        ex_type = item.get("exercise_type", "other")
        if ex_type not in ("cardio","strength","flexibility","sports","other"):
            ex_type = "other"
        try:
            dur = int(item.get("duration_minutes") or 0)
            if dur < 0:
                dur = 0
            if ex_type != "strength" and dur < 1:
                dur = 30
        except (TypeError, ValueError):
            dur = 0 if ex_type == "strength" else 30
        db.session.add(ExerciseTemplateItem(
            template_id      = template.id,
            name             = ex_name[:100],
            exercise_type    = ex_type,
            duration_minutes = dur,
            intensity        = int(item["intensity"]) if item.get("intensity") else None,
            calories_burned  = int(item["calories_burned"]) if item.get("calories_burned") else None,
            sets             = int(item["sets"]) if item.get("sets") else None,
            reps             = int(item["reps"]) if item.get("reps") else None,
            weight_lbs       = float(item["weight_lbs"]) if item.get("weight_lbs") not in (None, "") else None,
            sort_order       = idx,
        ))

    db.session.commit()
    return jsonify(template.to_dict()), 201


@app.route("/api/exercise/templates/<int:template_id>", methods=["DELETE"])
def delete_exercise_template(template_id):
    template = ExerciseTemplate.query.get_or_404(template_id)
    db.session.delete(template)
    db.session.commit()
    return jsonify({"message": f"Exercise template {template_id} deleted."})


@app.route("/api/exercise/strength-history", methods=["GET"])
def get_strength_history():
    """Most recent strength entry per exercise name, for progressive overload display."""
    date_str = request.args.get("before")
    try:
        before_date = date.fromisoformat(date_str) if date_str else date.today()
    except ValueError:
        before_date = date.today()

    entries = (
        ExerciseEntry.query
        .filter(ExerciseEntry.sets.isnot(None))
        .filter(ExerciseEntry.entry_date < before_date)
        .order_by(ExerciseEntry.entry_date.desc(), ExerciseEntry.created_at.desc())
        .all()
    )
    seen = {}
    for e in entries:
        if e.name not in seen:
            seen[e.name] = e.to_dict()
    return jsonify(seen)


@app.route("/api/exercise/templates/<int:template_id>/apply", methods=["POST"])
def apply_exercise_template(template_id):
    template = ExerciseTemplate.query.get_or_404(template_id)
    data      = request.get_json(force=True) or {}
    date_str  = (data.get("entry_date") or date.today().isoformat()).strip()
    try:
        entry_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid entry_date"}), 400

    created = []
    for item in sorted(template.items, key=lambda x: x.sort_order):
        entry = ExerciseEntry(
            entry_date       = entry_date,
            exercise_type    = item.exercise_type,
            name             = item.name,
            duration_minutes = item.duration_minutes,
            intensity        = item.intensity,
            calories_burned  = item.calories_burned,
            sets             = item.sets,
            reps             = item.reps,
            weight_lbs       = item.weight_lbs,
        )
        db.session.add(entry)
        created.append(entry)

    db.session.commit()
    return jsonify([e.to_dict() for e in created]), 201


# ---------------------------------------------------------------------------
# Hydration Routes
# ---------------------------------------------------------------------------

@app.route("/api/hydration", methods=["GET"])
def get_hydration():
    date_str = request.args.get("date") or date.today().isoformat()
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid date"}), 400
    log = HydrationLog.query.filter_by(log_date=d).first()
    if not log:
        return jsonify({"log_date": date_str, "glasses": 0, "goal": 8, "pct": 0})
    return jsonify(log.to_dict())


@app.route("/api/hydration", methods=["POST"])
def update_hydration():
    data = request.get_json(force=True) or {}
    date_str = (data.get("log_date") or date.today().isoformat()).strip()
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid log_date"}), 400
    glasses = max(0, int(data.get("glasses", 0)))
    goal    = max(1, int(data.get("goal", 8)))
    log     = HydrationLog.query.filter_by(log_date=d).first()
    if log:
        log.glasses = glasses
        log.goal    = goal
    else:
        log = HydrationLog(log_date=d, glasses=glasses, goal=goal)
        db.session.add(log)
    db.session.commit()
    return jsonify(log.to_dict())


@app.route("/api/hydration/history", methods=["GET"])
def hydration_history():
    days     = min(int(request.args.get("days", 7)), 90)
    date_str = request.args.get("date")
    try:
        today = date.fromisoformat(date_str) if date_str else date.today()
    except ValueError:
        today = date.today()
    start = today - timedelta(days=days - 1)
    logs  = HydrationLog.query.filter(HydrationLog.log_date >= start).order_by(HydrationLog.log_date).all()
    by_date = {l.log_date.isoformat(): l.to_dict() for l in logs}
    result  = []
    for i in range(days):
        d   = (start + timedelta(days=i)).isoformat()
        result.append(by_date.get(d, {"log_date": d, "glasses": 0, "goal": 8, "pct": 0}))
    return jsonify(result)


# ---------------------------------------------------------------------------
# Skincare Routes
# ---------------------------------------------------------------------------

@app.route("/api/skincare/steps", methods=["GET"])
def get_skincare_steps():
    steps = SkinCareStep.query.filter_by(is_active=True).order_by(
        SkinCareStep.time_of_day, SkinCareStep.order_index
    ).all()
    return jsonify([s.to_dict() for s in steps])


@app.route("/api/skincare/steps", methods=["POST"])
def create_skincare_step():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    tod = (data.get("time_of_day") or "am").strip().lower()
    if tod not in ("am", "pm"):
        return jsonify({"error": "time_of_day must be am or pm"}), 400
    max_order = db.session.query(db.func.max(SkinCareStep.order_index)).filter_by(
        time_of_day=tod, is_active=True).scalar() or 0
    step = SkinCareStep(name=name, time_of_day=tod, order_index=max_order + 1)
    db.session.add(step)
    db.session.commit()
    return jsonify(step.to_dict()), 201


@app.route("/api/skincare/steps/<int:step_id>", methods=["PATCH"])
def update_skincare_step(step_id):
    step = SkinCareStep.query.get_or_404(step_id)
    data = request.get_json(force=True) or {}
    if "name" in data:
        step.name = (data["name"] or "").strip() or step.name
    if "is_active" in data:
        step.is_active = bool(data["is_active"])
    if "order_index" in data:
        step.order_index = int(data["order_index"])
    db.session.commit()
    return jsonify(step.to_dict())


@app.route("/api/skincare/log", methods=["GET"])
def get_skincare_log():
    date_str = (request.args.get("date") or date.today().isoformat()).strip()
    try:
        log_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid date"}), 400
    steps = SkinCareStep.query.filter_by(is_active=True).order_by(
        SkinCareStep.time_of_day, SkinCareStep.order_index
    ).all()
    step_logs = {
        sl.step_id: sl
        for sl in SkinCareStepLog.query.filter_by(log_date=log_date).all()
    }
    result = []
    for s in steps:
        sl = step_logs.get(s.id)
        result.append({
            "step_id":      s.id,
            "name":         s.name,
            "time_of_day":  s.time_of_day,
            "order_index":  s.order_index,
            "completed":    sl.completed if sl else False,
            "product_used": sl.product_used if sl else None,
        })
    return jsonify(result)


@app.route("/api/skincare/log/toggle", methods=["POST"])
def toggle_skincare_step():
    data     = request.get_json(force=True) or {}
    date_str = (data.get("date") or "").strip()
    step_id  = data.get("step_id")
    completed    = bool(data.get("completed", False))
    product_used = (data.get("product_used") or "").strip() or None
    try:
        log_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid date"}), 400
    if not step_id:
        return jsonify({"error": "step_id required"}), 400
    step = SkinCareStep.query.get(step_id)
    if not step:
        return jsonify({"error": "Step not found"}), 404
    log = SkinCareStepLog.query.filter_by(log_date=log_date, step_id=step_id).first()
    if log:
        log.completed    = completed
        log.product_used = product_used
    else:
        log = SkinCareStepLog(log_date=log_date, step_id=step_id,
                              completed=completed, product_used=product_used)
        db.session.add(log)
    db.session.commit()
    return jsonify(log.to_dict())


@app.route("/api/skincare/ai-insights", methods=["POST"])
def skincare_ai_insights():
    data     = request.get_json(force=True) or {}
    date_str = (data.get("date") or date.today().isoformat()).strip()
    try:
        anchor = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid date"}), 400

    since = anchor - timedelta(days=13)  # 14-day window

    # Skincare completion per day
    step_logs = SkinCareStepLog.query.filter(
        SkinCareStepLog.log_date >= since,
        SkinCareStepLog.log_date <= anchor,
    ).all()
    steps_by_id = {s.id: s for s in SkinCareStep.query.filter_by(is_active=True).all()}
    am_steps_total = sum(1 for s in steps_by_id.values() if s.time_of_day == "am")
    pm_steps_total = sum(1 for s in steps_by_id.values() if s.time_of_day == "pm")

    daily_sc: dict = {}
    for sl in step_logs:
        d = sl.log_date.isoformat()
        if d not in daily_sc:
            daily_sc[d] = {"am_done": 0, "pm_done": 0}
        step = steps_by_id.get(sl.step_id)
        if sl.completed and step:
            if step.time_of_day == "am":
                daily_sc[d]["am_done"] += 1
            else:
                daily_sc[d]["pm_done"] += 1

    # Hydration per day
    hydration = {
        h.log_date.isoformat(): h.glasses
        for h in HydrationLog.query.filter(
            HydrationLog.log_date >= since,
            HydrationLog.log_date <= anchor,
        ).all()
    }

    # Sleep quality per day
    sleep_rows = SleepEntry.query.filter(
        SleepEntry.entry_date >= since,
        SleepEntry.entry_date <= anchor,
    ).all()
    sleep_data = {s.entry_date.isoformat(): s for s in sleep_rows}

    # Skin condition per day
    cond_rows = SkinConditionLog.query.filter(
        SkinConditionLog.log_date >= since,
        SkinConditionLog.log_date <= anchor,
    ).all()
    cond_data = {c.log_date.isoformat(): c for c in cond_rows}
    has_condition_data = bool(cond_rows)

    # Build data table
    rows = []
    for i in range(14):
        d = (since + timedelta(days=i)).isoformat()
        sc  = daily_sc.get(d, {"am_done": 0, "pm_done": 0})
        am_pct = f"{round(sc['am_done']/am_steps_total*100)}%" if am_steps_total else "N/A"
        pm_pct = f"{round(sc['pm_done']/pm_steps_total*100)}%" if pm_steps_total else "N/A"
        sl   = sleep_data.get(d)
        hyd  = hydration.get(d, "—")
        cond = cond_data.get(d)
        cond_str = ""
        if cond:
            cond_str = (
                f" · skin_feel={cond.feel_score}/5"
                + (f" · breakouts={cond.breakout_count}" if cond.breakout_count is not None else "")
                + (f" · oiliness={cond.oiliness_score}/5" if cond.oiliness_score is not None else "")
            )
        rows.append(
            f"  {d}: AM {am_pct} · PM {pm_pct} · "
            f"sleep={sl.energy_score if sl else '—'}/10 energy · "
            f"hydration={hyd} glasses{cond_str}"
        )

    if has_condition_data:
        prompt = (
            "You are a skincare and wellness expert analyzing 14 days of personal biometric data.\n\n"
            "DATA (date: AM completion · PM completion · sleep energy · hydration · skin condition):\n"
            + "\n".join(rows) + "\n\n"
            "Provide exactly 3 lines:\n"
            "1. Pattern: What correlation do you see between routine consistency or biometrics and skin feel scores?\n"
            "2. Trigger: On which specific conditions (sleep, hydration, skipped routine) does skin feel worst?\n"
            "3. Action: One specific, testable change based on this data.\n\n"
            "Be concrete. Reference actual numbers from the data. Total under 120 words."
        )
    else:
        prompt = (
            "You are a skincare and wellness expert. Analyze the following 14 days of data and "
            "identify meaningful correlations between skincare routine consistency and biometrics.\n\n"
            "DATA (date: AM completion · PM completion · sleep energy score · hydration):\n"
            + "\n".join(rows) + "\n\n"
            "Provide exactly 3 lines:\n"
            "1. Pattern: What correlation (if any) do you see between routine consistency and sleep/hydration?\n"
            "2. Strength: On high-hydration or high-sleep days, how does routine completion compare?\n"
            "3. Tip: One specific, actionable recommendation based on this data.\n\n"
            "Be concrete and data-driven. Total under 100 words."
        )

    try:
        from ai_service import _get_client, _call_with_retry
        client = _get_client()
        resp = _call_with_retry(lambda: client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=250,
            temperature=0.4,
        ))
        return jsonify({"insights": resp.choices[0].message.content.strip()})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/skincare/condition", methods=["GET"])
def get_skin_condition():
    date_str = (request.args.get("date") or date.today().isoformat()).strip()
    try:
        log_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid date"}), 400
    entry = SkinConditionLog.query.filter_by(log_date=log_date).first()
    return jsonify(entry.to_dict() if entry else {
        "log_date": date_str, "feel_score": None, "breakout_count": None,
        "oiliness_score": None, "notes": None,
    })


@app.route("/api/skincare/condition", methods=["POST"])
def save_skin_condition():
    data     = request.get_json(force=True) or {}
    date_str = (data.get("date") or date.today().isoformat()).strip()
    try:
        log_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid date"}), 400

    def _clamp(val, lo, hi):
        try:
            v = int(val)
            return max(lo, min(hi, v))
        except (TypeError, ValueError):
            return None

    feel      = _clamp(data.get("feel_score"), 1, 5)
    breakouts = _clamp(data.get("breakout_count"), 0, 3)
    oiliness  = _clamp(data.get("oiliness_score"), 1, 5)
    notes     = (data.get("notes") or "").strip() or None

    entry = SkinConditionLog.query.filter_by(log_date=log_date).first()
    if entry:
        entry.feel_score     = feel
        entry.breakout_count = breakouts
        entry.oiliness_score = oiliness
        entry.notes          = notes
    else:
        entry = SkinConditionLog(log_date=log_date, feel_score=feel,
                                 breakout_count=breakouts, oiliness_score=oiliness,
                                 notes=notes)
        db.session.add(entry)
    db.session.commit()
    return jsonify(entry.to_dict())


@app.route("/api/skincare/history")
def skincare_history():
    days_str = request.args.get("days", "14")
    try:
        days = max(7, min(90, int(days_str)))
    except ValueError:
        days = 14

    date_str = request.args.get("date", date.today().isoformat())
    try:
        anchor = date.fromisoformat(date_str)
    except ValueError:
        anchor = date.today()

    since = anchor - timedelta(days=days - 1)

    steps        = SkinCareStep.query.filter_by(is_active=True).all()
    am_total     = sum(1 for s in steps if s.time_of_day == "am")
    pm_total     = sum(1 for s in steps if s.time_of_day == "pm")
    steps_by_id  = {s.id: s for s in steps}

    step_logs = SkinCareStepLog.query.filter(
        SkinCareStepLog.log_date >= since,
        SkinCareStepLog.log_date <= anchor,
    ).all()

    cond_logs = {
        c.log_date: c
        for c in SkinConditionLog.query.filter(
            SkinConditionLog.log_date >= since,
            SkinConditionLog.log_date <= anchor,
        ).all()
    }

    # Aggregate step completions per day
    daily: dict = {}
    for sl in step_logs:
        d = sl.log_date
        if d not in daily:
            daily[d] = {"am_done": 0, "pm_done": 0}
        s = steps_by_id.get(sl.step_id)
        if sl.completed and s:
            if s.time_of_day == "am":
                daily[d]["am_done"] += 1
            else:
                daily[d]["pm_done"] += 1

    result = []
    for i in range(days):
        d = since + timedelta(days=i)
        sc  = daily.get(d, {"am_done": 0, "pm_done": 0})
        cond = cond_logs.get(d)
        result.append({
            "date":           d.isoformat(),
            "am_done":        sc["am_done"],
            "am_total":       am_total,
            "pm_done":        sc["pm_done"],
            "pm_total":       pm_total,
            "am_pct":         round(sc["am_done"] / am_total * 100) if am_total else None,
            "pm_pct":         round(sc["pm_done"] / pm_total * 100) if pm_total else None,
            "feel_score":     cond.feel_score     if cond else None,
            "breakout_count": cond.breakout_count if cond else None,
            "oiliness_score": cond.oiliness_score if cond else None,
        })
    return jsonify(result)


@app.route("/api/skincare/streak")
def skincare_streak():
    date_str = request.args.get("date", date.today().isoformat())
    try:
        today = date.fromisoformat(date_str)
    except ValueError:
        today = date.today()

    steps    = SkinCareStep.query.filter_by(is_active=True).all()
    am_total = sum(1 for s in steps if s.time_of_day == "am")
    pm_total = sum(1 for s in steps if s.time_of_day == "pm")
    total    = am_total + pm_total
    if total == 0:
        return jsonify({"current_streak": 0, "longest_streak": 0, "threshold_pct": 80})

    steps_by_id = {s.id: s for s in steps}
    since_90    = today - timedelta(days=89)

    logs = SkinCareStepLog.query.filter(
        SkinCareStepLog.log_date >= since_90,
        SkinCareStepLog.log_date <= today,
    ).all()

    daily: dict = {}
    for sl in logs:
        d = sl.log_date
        if d not in daily:
            daily[d] = 0
        if sl.completed:
            daily[d] += 1

    current = 0
    longest = 0
    run     = 0
    for i in range(89, -1, -1):
        d    = today - timedelta(days=i)
        done = daily.get(d, 0)
        pct  = done / total * 100
        if pct >= 80:
            run += 1
            longest = max(longest, run)
            if i == 0 or current > 0 or run > 0:
                # Only count current streak from today backwards consecutively
                pass
        else:
            run = 0

    # Recalculate current streak (consecutive days ending today)
    current = 0
    for i in range(0, 90):
        d    = today - timedelta(days=i)
        done = daily.get(d, 0)
        pct  = done / total * 100
        if pct >= 80:
            current += 1
        else:
            break

    return jsonify({
        "current_streak": current,
        "longest_streak": longest,
        "threshold_pct":  80,
    })


# ---------------------------------------------------------------------------
# Skin photo analysis
# ---------------------------------------------------------------------------

@app.route("/api/skincare/photo-analysis", methods=["POST"])
def skincare_photo_analysis():
    import anthropic as _anthr, base64 as _b64
    data      = request.get_json(force=True) or {}
    image_b64 = data.get("image")
    mime_type = data.get("mime_type", "image/jpeg")
    date_str  = (data.get("date") or date.today().isoformat()).strip()

    if not image_b64:
        return jsonify({"error": "No image provided"}), 400

    try:
        photo_date = date.fromisoformat(date_str)
    except ValueError:
        photo_date = date.today()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "Vision AI not configured"}), 503

    def _c(val, lo, hi):
        try:
            return max(lo, min(hi, int(val)))
        except (TypeError, ValueError):
            return None

    try:
        client  = _anthr.Anthropic(api_key=api_key)
        message = client.messages.create(
            model      = "claude-sonnet-4-6",
            max_tokens = 1024,
            system     = (
                "You are an expert dermatologist performing a visual skin assessment. "
                "Analyze the face photo provided and return a JSON object with your findings. "
                "Be objective and clinical. Score each dimension based only on what is visible in the photo."
            ),
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type":   "image",
                        "source": {
                            "type":       "base64",
                            "media_type": mime_type,
                            "data":       image_b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "Analyze this face photo and return ONLY a valid JSON object — no markdown, no explanation:\n"
                            "{\n"
                            '  "feel_score": <1-5, overall skin health, 5=excellent>,\n'
                            '  "breakout_count": <0=none visible, 1=1-2 spots, 2=3-5 spots, 3=6+ spots>,\n'
                            '  "oiliness_score": <1=very oily/shiny, 3=balanced, 5=very dry/matte>,\n'
                            '  "redness": <1=significant inflammation/redness, 5=no visible redness>,\n'
                            '  "texture": <1=very rough or uneven, 5=smooth and even>,\n'
                            '  "hydration": <1=visibly dehydrated/flaky, 5=well-hydrated and plump>,\n'
                            '  "report": "<2-3 sentence clinical assessment: key observations and one actionable recommendation>"\n'
                            "}"
                        ),
                    },
                ],
            }],
        )
        parsed = json.loads(_strip_json_fences(message.content[0].text))
    except Exception as e:
        return jsonify({"error": f"Analysis failed: {str(e)}"}), 500

    try:
        photo_bytes = _b64.b64decode(image_b64)
    except Exception:
        photo_bytes = b""

    entry = SkinPhotoAnalysis(
        photo_date     = photo_date,
        photo_data     = photo_bytes,
        photo_mime     = mime_type,
        feel_score     = _c(parsed.get("feel_score"),     1, 5),
        breakout_count = _c(parsed.get("breakout_count"), 0, 3),
        oiliness_score = _c(parsed.get("oiliness_score"), 1, 5),
        redness        = _c(parsed.get("redness"),        1, 5),
        texture        = _c(parsed.get("texture"),        1, 5),
        hydration      = _c(parsed.get("hydration"),      1, 5),
        report         = str(parsed.get("report", ""))[:2000],
    )
    db.session.add(entry)
    db.session.commit()
    return jsonify(entry.to_dict())


@app.route("/api/skincare/photo-analyses", methods=["GET"])
def skincare_photo_analyses_list():
    days  = int(request.args.get("days", 60))
    since = date.today() - timedelta(days=days - 1)
    rows  = (SkinPhotoAnalysis.query
             .filter(SkinPhotoAnalysis.photo_date >= since)
             .order_by(SkinPhotoAnalysis.photo_date.desc(),
                       SkinPhotoAnalysis.created_at.desc())
             .all())
    return jsonify([r.to_dict() for r in rows])


@app.route("/api/skincare/photo-analyses/<int:analysis_id>/photo", methods=["GET"])
def skincare_photo_serve(analysis_id):
    entry = SkinPhotoAnalysis.query.get_or_404(analysis_id)
    return Response(entry.photo_data, mimetype=entry.photo_mime)


@app.route("/api/skincare/photo-analyses/<int:analysis_id>/apply", methods=["POST"])
def skincare_photo_apply(analysis_id):
    analysis = SkinPhotoAnalysis.query.get_or_404(analysis_id)
    data     = request.get_json(force=True) or {}
    date_str = (data.get("date") or analysis.photo_date.isoformat()).strip()
    try:
        target_date = date.fromisoformat(date_str)
    except ValueError:
        target_date = analysis.photo_date

    log = SkinConditionLog.query.filter_by(log_date=target_date).first()
    if not log:
        log = SkinConditionLog(log_date=target_date)
        db.session.add(log)

    if analysis.feel_score is not None:
        log.feel_score = analysis.feel_score
    if analysis.breakout_count is not None:
        log.breakout_count = analysis.breakout_count
    if analysis.oiliness_score is not None:
        log.oiliness_score = analysis.oiliness_score

    db.session.commit()
    return jsonify(log.to_dict())


# ── Skin Product Inventory ─────────────────────────────────────────────────

SKIN_PRODUCT_TYPES = (
    "medicated_wash", "gentle_wash", "moisturizer",
    "sunscreen", "heavy_occlusive", "treatment", "other",
)
ALLOWED_PHOTO_MIMES = {"image/jpeg", "image/png", "image/webp"}


@app.route("/api/skincare/products/scan", methods=["POST"])
def scan_skin_product():
    """Layer 1: Claude vision — runs once per product at upload time, never again."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "AI not available"}), 503
    data = request.get_json(force=True) or {}
    img  = data.get("image")
    mime = data.get("mime_type", "image/jpeg")
    if mime not in ALLOWED_PHOTO_MIMES:
        mime = "image/jpeg"
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
    raw = ""
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
    photo_mime = str(data.get("photo_mime", "image/jpeg"))[:20]
    if photo_mime not in ALLOWED_PHOTO_MIMES:
        photo_mime = "image/jpeg"
    if photo_b64:
        import base64
        try:
            photo_data = base64.b64decode(photo_b64)
        except Exception:
            return jsonify({"error": "Invalid photo_b64 encoding"}), 400

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

_CARDIO_TYPES   = {"cardio", "sports"}
_STRENGTH_TYPES = {"strength"}
_MAX_MEDICATED  = 2   # max medicated washes per 24-hour cycle

# Sweat intensity ranking (stored as "sweat_level=X" prefix in ExerciseEntry.notes)
_SWEAT_LEVELS = {"high": 2, "medium": 1, "low": 0, "none": -1}


def _sweat_level_str(entry):
    """Read sweat_level from a SkinWorkoutLog or legacy ExerciseEntry."""
    # SkinWorkoutLog has a direct sweat_level field
    if hasattr(entry, "sweat_level") and entry.sweat_level in _SWEAT_LEVELS:
        return entry.sweat_level
    # Legacy ExerciseEntry: parse from notes prefix
    notes = getattr(entry, "notes", "") or ""
    if notes.startswith("sweat_level="):
        level = notes.split("=", 1)[1].split(";")[0].strip()
        return level if level in _SWEAT_LEVELS else "medium"
    if entry.exercise_type in _CARDIO_TYPES or entry.exercise_type in _STRENGTH_TYPES:
        return "medium"
    return "low"


def _max_sweat(exercises):
    """Return highest sweat_level string across all exercises. 'none' if list is empty."""
    if not exercises:
        return "none"
    return max((_sweat_level_str(e) for e in exercises),
               key=lambda s: _SWEAT_LEVELS.get(s, -1))


def _build_routine(products, exercises, medicated_done=0):
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

    med_used = [medicated_done]  # start at already-completed medicated count for today
    max_sweat = _max_sweat(exercises)

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
            _e = cardio_today[0]
            _time_str = getattr(_e, "logged_at_pst", None)
            if not _time_str:
                from zoneinfo import ZoneInfo as _ZI
                from datetime import timezone as _tz2
                _t_local = _e.created_at.replace(tzinfo=_tz2.utc).astimezone(_ZI("America/Los_Angeles"))
                _time_str = _t_local.strftime("%I:%M %p")
            ctx = f"cardio · logged {_time_str}"
        elif strength_today:
            ctx = "strength workout"
        else:
            ctx = "workout"
        sweat_badge = f" · {max_sweat} sweat" if max_sweat not in ("none", "medium") else ""
        sections.append({"key": "post_workout", "label": "Post-Workout",
                          "icon": "💪", "steps": pw,
                          "workout_context": ctx + sweat_badge})

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


# ── Routine Endpoint Helpers ───────────────────────────────────────────────

def _generate_and_persist_routine(target_date, skip_explanation=False):
    """
    Layer 2 helper: run rule engine, optionally call Claude for 2-sentence
    explanation, upsert DailyRoutine. Returns DailyRoutine ORM object.

    skip_explanation=True skips the Anthropic call (used for background
    regeneration triggered by workout-chat to avoid memory pressure).
    """
    products  = SkinProduct.query.all()
    # Only use exercises logged via the skincare workout chat (notes start with "sweat_level=")
    exercises = SkinWorkoutLog.query.filter_by(
        log_date=target_date,
    ).order_by(SkinWorkoutLog.created_at.desc()).all()

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

    def _logged_time(entry):
        if getattr(entry, "logged_at_pst", None):
            return entry.logged_at_pst
        from zoneinfo import ZoneInfo
        from datetime import timezone as _tz
        pst = ZoneInfo("America/Los_Angeles")
        local_dt = entry.created_at.replace(tzinfo=_tz.utc).astimezone(pst)
        return local_dt.strftime("%I:%M %p")

    workout_ctx = (
        ", ".join(f"{e.name or e.exercise_type} at {_logged_time(e)}" for e in exercises)
        or "rest day"
    )

    new_explanation = None
    if not skip_explanation:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
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
                    model="claude-haiku-4-5-20251001",
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
                new_explanation = resp.content[0].text.strip()
            except Exception:
                pass   # explanation is optional

    existing = DailyRoutine.query.filter_by(routine_date=target_date).first()
    if existing:
        existing.routine_json    = json.dumps(routine_data)
        existing.workout_context = workout_ctx
        existing.generated_at    = datetime.utcnow()
        if not skip_explanation:
            existing.explanation = new_explanation
    else:
        existing = DailyRoutine(
            routine_date    = target_date,
            routine_json    = json.dumps(routine_data),
            explanation     = new_explanation,
            workout_context = workout_ctx,
        )
        db.session.add(existing)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
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

    resp = jsonify({
        "routine_date":    routine_obj.routine_date.isoformat(),
        "routine":         routine_data,
        "explanation":     routine_obj.explanation,
        "workout_context": routine_obj.workout_context,
        "generated_at":    routine_obj.generated_at.isoformat(),
    })
    resp.headers["Cache-Control"] = "no-store"
    return resp


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


@app.route("/api/skincare/workout-chat", methods=["POST"])
def skincare_workout_chat():
    """
    Layer 2 trigger: parse a natural-language workout description, create an
    ExerciseEntry with sweat_level stored in notes, and regenerate the routine.

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

    message   = (data.get("message") or "").strip()[:500]
    sweat_lvl = (data.get("sweat_level") or "").strip().lower()
    ex_type   = (data.get("exercise_type") or "cardio").strip().lower()
    name      = (data.get("name") or "Workout").strip()[:100]
    duration  = data.get("duration_minutes")
    logged_at = (data.get("logged_at") or "").strip()[:10]   # client local time "HH:MM AM/PM"

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
            name      = (str(parsed.get("name", "")) or "Workout").strip()[:100]
            raw_dur   = parsed.get("duration_minutes")
            duration  = max(0, int(raw_dur)) if raw_dur is not None else None
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
    cutoff = datetime.utcnow() - timedelta(seconds=60)
    recent = SkinWorkoutLog.query.filter(
        SkinWorkoutLog.log_date      == target_date,
        SkinWorkoutLog.exercise_type == ex_type,
        SkinWorkoutLog.created_at    >= cutoff,
    ).first()

    if recent:
        existing_entry = recent
    else:
        existing_entry = SkinWorkoutLog(
            log_date         = target_date,
            exercise_type    = ex_type,
            name             = name,
            sweat_level      = sweat_lvl,
            logged_at_pst    = logged_at or None,
            duration_minutes = duration or None,
        )
        db.session.add(existing_entry)
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            return jsonify({"error": "Failed to save workout"}), 500

    # Regenerate skincare routine — skip Anthropic explanation to avoid memory pressure
    try:
        _generate_and_persist_routine(target_date, skip_explanation=True)
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


# ---------------------------------------------------------------------------
# Hub today-status — single round-trip for all tile badges
# ---------------------------------------------------------------------------

@app.route("/api/hub/today-status")
def hub_today_status():
    date_str = request.args.get("date", date.today().isoformat())
    try:
        today = date.fromisoformat(date_str)
    except ValueError:
        today = date.today()

    today_iso = today.isoformat()

    # Sleep
    sleep_entry = SleepEntry.query.filter_by(entry_date=today).first()

    # Mood
    mood_entry = MoodEntry.query.filter_by(entry_date=today).first()

    # Habits
    habits     = Habit.query.filter_by(is_active=True).all()
    habit_logs = HabitLog.query.filter_by(log_date=today).all()
    h_done_ids = {l.habit_id for l in habit_logs}
    h_total    = len(habits)
    h_done     = sum(1 for h in habits if h.id in h_done_ids)

    # Hydration
    hyd = HydrationLog.query.filter_by(log_date=today).first()

    # Tasks — overdue + total active
    all_tasks     = Task.query.filter(Task.status != "done").all()
    active_count  = len(all_tasks)
    overdue_count = sum(1 for t in all_tasks if t.due_date and t.due_date.isoformat() < today_iso)

    return jsonify({
        "sleep":     {"logged": sleep_entry is not None},
        "mood":      {"logged": mood_entry is not None,
                      "score":  mood_entry.mood_score if mood_entry else None},
        "habits":    {"done": h_done, "total": h_total,
                      "pct": round(h_done / h_total * 100) if h_total else 0},
        "hydration": {"glasses": hyd.glasses if hyd else 0,
                      "goal":    hyd.goal    if hyd else 8},
        "tasks":     {"active": active_count, "overdue": overdue_count},
    })


# ---------------------------------------------------------------------------
# Health AI Coach Chat
# ---------------------------------------------------------------------------

@app.route("/api/health/chat", methods=["POST"])
def health_chat():
    data     = request.get_json(force=True) or {}
    message  = (data.get("message") or "").strip()
    history  = data.get("history") or []
    cal_goal = int(data.get("cal_goal") or 2000)

    if not message:
        return jsonify({"error": "message required"}), 400

    date_str = (data.get("date") or "").strip()
    try:
        today = date.fromisoformat(date_str) if date_str else date.today()
    except ValueError:
        today = date.today()
    week_ago  = today - timedelta(days=7)
    week_ago_dt = datetime.combine(week_ago, datetime.min.time())

    # ── Pull all health data ───────────────────────────────────────────────
    sleep_entries = (SleepEntry.query
                     .filter(SleepEntry.entry_date >= week_ago)
                     .order_by(SleepEntry.entry_date.desc()).all())

    food_week  = FoodEntry.query.filter(FoodEntry.entry_date >= week_ago).all()
    cal_by_day = {}
    for f in food_week:
        k = f.entry_date.isoformat()
        cal_by_day[k] = cal_by_day.get(k, 0) + f.calories
    today_cal = cal_by_day.get(today.isoformat(), 0)

    exercise_week = (ExerciseEntry.query
                     .filter(ExerciseEntry.entry_date >= week_ago)
                     .order_by(ExerciseEntry.entry_date.desc()).all())
    today_burned  = sum(e.calories_burned or 0 for e in exercise_week
                        if e.entry_date == today)

    hydration_week = HydrationLog.query.filter(HydrationLog.log_date >= week_ago).all()
    today_hyd      = HydrationLog.query.filter_by(log_date=today).first()

    mood_entries = (MoodEntry.query
                    .filter(MoodEntry.entry_date >= week_ago)
                    .order_by(MoodEntry.entry_date.desc()).all())

    habits           = Habit.query.filter_by(is_active=True).all()
    habit_logs_week  = HabitLog.query.filter(HabitLog.log_date >= week_ago, HabitLog.habit_id.in_([h.id for h in habits])).count()
    habit_possible   = len(habits) * 7

    active_tasks   = (Task.query.filter(Task.status != "done")
                      .order_by(Task.priority, Task.created_at).limit(10).all())
    completed_week = Task.query.filter(
        Task.status == "done", Task.completed_at >= week_ago_dt
    ).count()

    # ── Build context string ───────────────────────────────────────────────
    sections = [f"Today: {today.strftime('%A, %B %d, %Y')}"]

    # Sleep
    if sleep_entries:
        lines = []
        for e in sleep_entries[:7]:
            hrs = round((e.sleep_duration_minutes or 0) / 60, 1)
            lines.append(
                f"  {e.entry_date} ({e.entry_date.strftime('%a')}): "
                f"{hrs}h sleep, energy {e.energy_score}/10, "
                f"stress {e.stress_score}/10, inertia {e.inertia_score}/10"
            )
        sections.append("SLEEP (last 7 nights):\n" + "\n".join(lines))
    else:
        sections.append("SLEEP: No data logged this week.")

    # Nutrition
    if cal_by_day:
        avg_cal   = int(sum(cal_by_day.values()) / len(cal_by_day))
        over_days = sum(1 for c in cal_by_day.values() if c > cal_goal * 1.1)
        sections.append(
            f"NUTRITION: Goal {cal_goal} cal/day | "
            f"Avg {avg_cal} cal/day this week ({len(cal_by_day)}/7 days tracked) | "
            f"Today: {today_cal} consumed, {today_burned} burned, "
            f"net {today_cal - today_burned} cal | "
            f"Days exceeding goal: {over_days}/7"
        )
    else:
        sections.append(
            f"NUTRITION: Goal {cal_goal} cal/day | "
            "Nothing logged this week. Today: nothing logged yet."
        )

    # Exercise
    if exercise_week:
        ex_mins  = sum(e.duration_minutes for e in exercise_week)
        ex_cal   = sum(e.calories_burned or 0 for e in exercise_week)
        ex_types = {}
        for e in exercise_week:
            ex_types[e.exercise_type] = ex_types.get(e.exercise_type, 0) + 1
        type_str = ", ".join(
            f"{k} x{v}" for k, v in sorted(ex_types.items(), key=lambda x: -x[1])
        )
        sections.append(
            f"EXERCISE: {len(exercise_week)} sessions, {ex_mins} min total"
            + (f", ~{ex_cal} cal burned" if ex_cal else "")
            + f" | Types: {type_str}"
        )
    else:
        sections.append("EXERCISE: No sessions logged this week.")

    # Hydration
    if hydration_week:
        avg_gl   = round(sum(l.glasses for l in hydration_week) / len(hydration_week), 1)
        hyd_goal = hydration_week[0].goal
        t_gl     = today_hyd.glasses if today_hyd else 0
        sections.append(
            f"HYDRATION: Goal {hyd_goal} glasses/day | "
            f"Avg {avg_gl} glasses/day this week | "
            f"Today: {t_gl}/{hyd_goal} glasses"
        )
    else:
        sections.append("HYDRATION: Not tracked this week.")

    # Mood
    if mood_entries:
        avg_mood = round(sum(e.mood_score for e in mood_entries) / len(mood_entries), 1)
        en_vals  = [e.energy_score  for e in mood_entries if e.energy_score]
        ax_vals  = [e.anxiety_score for e in mood_entries if e.anxiety_score]
        avg_en   = round(sum(en_vals) / len(en_vals), 1) if en_vals else "N/A"
        avg_ax   = round(sum(ax_vals) / len(ax_vals), 1) if ax_vals else "N/A"
        latest   = mood_entries[0]
        sections.append(
            f"MOOD ({len(mood_entries)}/7 days logged): "
            f"Avg mood {avg_mood}/10, avg energy {avg_en}/10, avg anxiety {avg_ax}/10 | "
            f"Latest ({latest.entry_date}): mood {latest.mood_score}, "
            f"energy {latest.energy_score or 'N/A'}, anxiety {latest.anxiety_score or 'N/A'}"
        )
    else:
        sections.append("MOOD: No data logged this week.")

    # Habits
    if habits:
        habit_rate = int(habit_logs_week / habit_possible * 100) if habit_possible else 0
        lines = []
        for h in habits:
            streak = h.current_streak(today)
            done   = h.logged_today(today)
            lines.append(
                f"  {h.icon} {h.name}: "
                f"{'✓ done today' if done else '✗ not done today'}, "
                f"{streak}-day streak"
            )
        sections.append(
            f"HABITS ({habit_rate}% consistency this week):\n" + "\n".join(lines)
        )
    else:
        sections.append("HABITS: None configured.")

    # Tasks
    pri_labels = {1: "Critical", 2: "High", 3: "Medium", 4: "Low"}
    if active_tasks:
        task_lines = [
            f"  [P{t.priority} {pri_labels.get(t.priority, 'Medium')}] {t.title}"
            + (f" — due {t.due_date}" if t.due_date else "")
            for t in active_tasks[:8]
        ]
        sections.append(
            f"ACTIVE TASKS ({len(active_tasks)} open, {completed_week} completed this week):\n"
            + "\n".join(task_lines)
        )
    else:
        sections.append(
            f"TASKS: No open tasks ({completed_week} completed this week)."
        )

    context = "\n\n".join(sections)

    system_prompt = (
        "You are a personal wellness and productivity coach embedded in the user's health tracker. "
        "You have real-time access to their health data from the past 7 days.\n\n"
        "Core guidelines:\n"
        "- Reference SPECIFIC numbers from the data — not vague generalities\n"
        "- Spot correlations across metrics (e.g. low sleep nights → next-day mood dip)\n"
        "- Prioritize the highest-impact, most actionable recommendations first\n"
        "- Be warm and encouraging, but honest about areas needing work\n"
        "- Keep each response under 220 words; use short paragraphs or a numbered list when giving multiple tips\n"
        "- For 'what to do today' questions, give 2-3 specific actions, not a laundry list\n"
        "- Never make medical diagnoses or recommend medications\n\n"
        f"=== USER HEALTH DATA (past 7 days) ===\n{context}"
    )

    messages_list = [{"role": "system", "content": system_prompt}]
    for h in history[-12:]:
        role    = h.get("role")
        content = (h.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages_list.append({"role": role, "content": content})
    messages_list.append({"role": "user", "content": message})

    try:
        from ai_service import _get_client, _call_with_retry
        client = _get_client()
        resp   = _call_with_retry(lambda: client.chat.completions.create(
            model       = "llama-3.1-8b-instant",
            messages    = messages_list,
            max_tokens  = 420,
            temperature = 0.65,
        ))
        return jsonify({"reply": resp.choices[0].message.content.strip()})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Weekly AI Insights
# ---------------------------------------------------------------------------

@app.route("/api/insights/weekly")
def weekly_insights():
    date_str = request.args.get("date")
    today    = date.fromisoformat(date_str) if date_str else date.today()
    week_ago = today - timedelta(days=7)

    # ── Core existing modules ─────────────────────────────────────────────────
    sleep_entries = SleepEntry.query.filter(SleepEntry.entry_date >= week_ago).all()
    food_entries  = FoodEntry.query.filter(FoodEntry.entry_date  >= week_ago).all()

    cal_by_day:   dict = {}
    macro_by_day: dict = {}
    for f in food_entries:
        k = f.entry_date.isoformat()
        cal_by_day[k] = cal_by_day.get(k, 0) + f.calories
        if k not in macro_by_day:
            macro_by_day[k] = {"protein": 0.0, "carbs": 0.0, "fat": 0.0}
        macro_by_day[k]["protein"] += f.protein_g or 0.0
        macro_by_day[k]["carbs"]   += f.carbs_g   or 0.0
        macro_by_day[k]["fat"]     += f.fat_g     or 0.0

    week_ago_dt      = datetime.combine(week_ago, datetime.min.time())
    tasks_completed  = Task.query.filter(Task.status == "done", Task.completed_at >= week_ago_dt).count()
    tasks_active     = Task.query.filter(Task.status != "done").count()

    habits           = Habit.query.filter_by(is_active=True).all()
    habit_logs_count = HabitLog.query.filter(HabitLog.log_date >= week_ago, HabitLog.habit_id.in_([h.id for h in habits])).count()
    habit_possible   = len(habits) * 7

    mood_entries  = MoodEntry.query.filter(MoodEntry.entry_date >= week_ago).all()
    ex_entries    = ExerciseEntry.query.filter(ExerciseEntry.entry_date >= week_ago).all()
    ex_minutes    = sum(e.duration_minutes for e in ex_entries)
    ex_cal_burned = sum(e.calories_burned or 0 for e in ex_entries)
    hydration_wk  = HydrationLog.query.filter(HydrationLog.log_date >= week_ago).all()

    # ── New modules ───────────────────────────────────────────────────────────
    week_start   = today - timedelta(days=today.weekday())
    weekly_plan  = WeeklyPlan.query.filter_by(week_start=week_start).first()

    weight_wk    = WeightEntry.query.filter(WeightEntry.entry_date >= week_ago).order_by(WeightEntry.entry_date).all()
    skincare_wk  = SkincareLog.query.filter(SkincareLog.log_date >= week_ago).all()
    skin_cond_wk = SkinConditionLog.query.filter(SkinConditionLog.log_date >= week_ago).all()

    active_supps  = Supplement.query.filter_by(is_active=True).all()
    supp_logs_wk  = (SupplementLog.query.filter(
        SupplementLog.log_date >= week_ago,
        SupplementLog.supplement_id.in_([s.id for s in active_supps])
    ).all() if active_supps else [])

    chore_logs_wk = ChoreLog.query.filter(ChoreLog.log_date >= week_ago, ChoreLog.completed == True).count()
    active_chores = Chore.query.filter_by(active=True).count()

    screen_wk    = ScreenTimeEntry.query.filter(ScreenTimeEntry.entry_date >= week_ago).all()
    body_meas_wk = BodyMeasurement.query.filter(BodyMeasurement.entry_date >= week_ago).order_by(BodyMeasurement.entry_date).all()

    # ── Build strings ─────────────────────────────────────────────────────────
    if sleep_entries:
        avg_hrs    = sum((e.sleep_duration_minutes or 0) for e in sleep_entries) / len(sleep_entries) / 60
        avg_energy = sum(e.energy_score for e in sleep_entries) / len(sleep_entries)
        avg_stress = sum(e.stress_score for e in sleep_entries) / len(sleep_entries)
        latency_vals = [e.sleep_latency_minutes for e in sleep_entries if e.sleep_latency_minutes is not None]
        latency_str  = f", avg latency {sum(latency_vals)/len(latency_vals):.0f}min" if latency_vals else ""
        sleep_str  = (f"{len(sleep_entries)}/7 nights logged, avg {avg_hrs:.1f}h, "
                      f"energy {avg_energy:.1f}/10, stress {avg_stress:.1f}/10{latency_str}")
    else:
        sleep_str = "No sleep data this week"

    cal_str = (
        f"Avg {int(sum(cal_by_day.values()) / len(cal_by_day))} cal/day, {len(cal_by_day)}/7 days tracked"
        if cal_by_day else "No calorie data this week"
    )
    if macro_by_day:
        avg_p = sum(d["protein"] for d in macro_by_day.values()) / len(macro_by_day)
        avg_c = sum(d["carbs"]   for d in macro_by_day.values()) / len(macro_by_day)
        avg_f = sum(d["fat"]     for d in macro_by_day.values()) / len(macro_by_day)
        macro_str = f"{avg_p:.0f}g protein, {avg_c:.0f}g carbs, {avg_f:.0f}g fat avg/day"
    else:
        macro_str = None

    task_str   = f"{tasks_completed} completed this week, {tasks_active} still active"
    habit_rate = int(habit_logs_count / habit_possible * 100) if habit_possible else 0
    habit_str  = (
        f"{habit_logs_count}/{habit_possible} completions ({habit_rate}% consistency)"
        if habits else "No habits configured yet"
    )

    if mood_entries:
        avg_mood    = sum(e.mood_score for e in mood_entries) / len(mood_entries)
        avg_anxiety = (sum(e.anxiety_score for e in mood_entries if e.anxiety_score) /
                       max(1, sum(1 for e in mood_entries if e.anxiety_score)))
        mood_str = f"{len(mood_entries)}/7 days logged, avg mood {avg_mood:.1f}/10, avg anxiety {avg_anxiety:.1f}/10"
    else:
        mood_str = "No mood data this week"

    ex_parts = [f"{len(ex_entries)} sessions, {ex_minutes} total minutes"]
    if ex_cal_burned:
        ex_parts.append(f"{ex_cal_burned} cal burned")
    ex_str = ", ".join(ex_parts) if ex_entries else "No exercise logged this week"

    if hydration_wk:
        avg_glasses   = sum(l.glasses for l in hydration_wk) / len(hydration_wk)
        hydration_str = f"{len(hydration_wk)}/7 days tracked, avg {avg_glasses:.1f} glasses/day"
    else:
        hydration_str = "No hydration data this week"

    # Weight
    if weight_wk:
        avg_w  = sum(e.weight_lbs for e in weight_wk) / len(weight_wk)
        trend  = weight_wk[-1].weight_lbs - weight_wk[0].weight_lbs if len(weight_wk) >= 2 else None
        bf_vals = [e.body_fat_pct for e in weight_wk if e.body_fat_pct is not None]
        w_parts = [f"{len(weight_wk)} weigh-in(s), avg {avg_w:.1f} lbs"]
        if trend is not None:
            w_parts.append(f"trend {trend:+.1f} lbs")
        if bf_vals:
            w_parts.append(f"avg body fat {sum(bf_vals)/len(bf_vals):.1f}%")
        weight_str = ", ".join(w_parts)
    else:
        weight_str = None

    # Skincare routine adherence
    if skincare_wk:
        am_done = sum(1 for s in skincare_wk if s.am_done)
        pm_done = sum(1 for s in skincare_wk if s.pm_done)
        skincare_str = (f"{len(skincare_wk)}/7 days logged, "
                        f"AM {am_done}/{len(skincare_wk)}, PM {pm_done}/{len(skincare_wk)}")
    else:
        skincare_str = None

    # Skin condition scores
    if skin_cond_wk:
        feel_vals     = [e.feel_score      for e in skin_cond_wk if e.feel_score      is not None]
        breakout_vals = [e.breakout_count  for e in skin_cond_wk if e.breakout_count  is not None]
        oiliness_vals = [e.oiliness_score  for e in skin_cond_wk if e.oiliness_score  is not None]
        sc_parts = [f"{len(skin_cond_wk)}/7 days logged"]
        if feel_vals:
            sc_parts.append(f"avg feel {sum(feel_vals)/len(feel_vals):.1f}/5")
        if breakout_vals:
            sc_parts.append(f"avg breakouts {sum(breakout_vals)/len(breakout_vals):.1f}/3")
        if oiliness_vals:
            sc_parts.append(f"avg oiliness {sum(oiliness_vals)/len(oiliness_vals):.1f}/5")
        skin_cond_str = ", ".join(sc_parts)
    else:
        skin_cond_str = None

    # Supplements
    if active_supps:
        supp_possible = len(active_supps) * 7
        supp_rate     = int(len(supp_logs_wk) / supp_possible * 100) if supp_possible else 0
        supp_str = (f"{len(active_supps)} active, "
                    f"{len(supp_logs_wk)}/{supp_possible} doses taken ({supp_rate}% adherence)")
    else:
        supp_str = None

    # Chores
    chore_str = (f"{chore_logs_wk} completions this week ({active_chores} active chores)"
                 if active_chores > 0 else None)

    # Screen time
    if screen_wk:
        focus_vals  = [e.focus_hours  for e in screen_wk if e.focus_hours  is not None]
        screen_vals = [e.screen_hours for e in screen_wk if e.screen_hours is not None]
        sc_t_parts  = [f"{len(screen_wk)}/7 days logged"]
        if focus_vals:
            sc_t_parts.append(f"avg focus {sum(focus_vals)/len(focus_vals):.1f}h/day")
        if screen_vals:
            sc_t_parts.append(f"avg screen {sum(screen_vals)/len(screen_vals):.1f}h/day")
        screen_str = ", ".join(sc_t_parts)
    else:
        screen_str = None

    # Body measurements (only latest this week)
    if body_meas_wk:
        latest   = body_meas_wk[-1]
        bm_parts = []
        if latest.waist_in:      bm_parts.append(f"waist {latest.waist_in}\"")
        if latest.chest_in:      bm_parts.append(f"chest {latest.chest_in}\"")
        if latest.hips_in:       bm_parts.append(f"hips {latest.hips_in}\"")
        if latest.left_arm_in:   bm_parts.append(f"arm {latest.left_arm_in}\"")
        body_meas_str = (f"{len(body_meas_wk)} measurement(s)" +
                         (f" ({', '.join(bm_parts)})" if bm_parts else ""))
    else:
        body_meas_str = None

    # Weekly plan targets
    if weekly_plan:
        plan_parts = []
        if weekly_plan.target_sleep_hours:  plan_parts.append(f"sleep {weekly_plan.target_sleep_hours}h/night")
        if weekly_plan.target_workouts:     plan_parts.append(f"{weekly_plan.target_workouts} workouts")
        if weekly_plan.target_calorie_days: plan_parts.append(f"nutrition {weekly_plan.target_calorie_days} days")
        if weekly_plan.target_habit_pct:    plan_parts.append(f"habits {weekly_plan.target_habit_pct}%")
        weekly_plan_str = "Targets: " + ", ".join(plan_parts) if plan_parts else None
    else:
        weekly_plan_str = None

    # ── Assemble prompt ───────────────────────────────────────────────────────
    prompt_lines = [
        "You are a personal wellness coach giving a concise weekly review. "
        "Be honest, specific, and encouraging. Under 220 words. No bullet headers — write as natural flowing text.\n\n",
    ]
    if weekly_plan_str:
        prompt_lines.append(f"Goals:       {weekly_plan_str}\n")
    nutrition_line = f"Nutrition:   {cal_str}"
    if macro_str:
        nutrition_line += f" | {macro_str}"
    prompt_lines += [
        f"Sleep:       {sleep_str}\n",
        f"Mood:        {mood_str}\n",
        nutrition_line + "\n",
        f"Exercise:    {ex_str}\n",
        f"Hydration:   {hydration_str}\n",
        f"Tasks:       {task_str}\n",
        f"Habits:      {habit_str}\n",
    ]
    if weight_str:
        prompt_lines.append(f"Weight:      {weight_str}\n")
    skin_parts = [p for p in [skincare_str, skin_cond_str] if p]
    if skin_parts:
        prompt_lines.append(f"Skincare:    {' | '.join(skin_parts)}\n")
    if supp_str:
        prompt_lines.append(f"Supplements: {supp_str}\n")
    if chore_str:
        prompt_lines.append(f"Chores:      {chore_str}\n")
    if screen_str:
        prompt_lines.append(f"Screen Time: {screen_str}\n")
    if body_meas_str:
        prompt_lines.append(f"Measurements:{body_meas_str}\n")
    prompt_lines.append(
        "\nIdentify 2-3 patterns or correlations across these areas, "
        "then give one clear, specific, actionable suggestion to improve next week."
    )
    prompt = "".join(prompt_lines)

    try:
        from ai_service import _get_client, _call_with_retry
        client = _get_client()
        resp   = _call_with_retry(lambda: client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=450,
            temperature=0.7,
        ))
        return jsonify({
            "insights":     resp.choices[0].message.content.strip(),
            "generated_at": datetime.utcnow().isoformat(),
            "data_summary": {
                "sleep_entries":      len(sleep_entries),
                "calorie_days":       len(cal_by_day),
                "mood_entries":       len(mood_entries),
                "exercise_sessions":  len(ex_entries),
                "hydration_days":     len(hydration_wk),
                "tasks_completed":    tasks_completed,
                "habits_logged":      habit_logs_count,
                "weight_entries":     len(weight_wk),
                "skincare_days":      len(skincare_wk),
                "skin_condition_days":len(skin_cond_wk),
                "supplement_doses":   len(supp_logs_wk),
                "chore_completions":  chore_logs_wk,
                "screen_time_days":   len(screen_wk),
                "body_measurements":  len(body_meas_wk),
            },
        })
    except Exception as exc:
        return jsonify({"error": str(exc), "insights": None})


# ---------------------------------------------------------------------------
# Cross-Module AI Correlation Engine
# ---------------------------------------------------------------------------

def _build_correlation_matrix(days: int = 30, cutoff_date=None) -> list:
    cutoff = (cutoff_date or date.today()) - timedelta(days=days)

    sleep_map = {r.entry_date.isoformat(): r
                 for r in SleepEntry.query.filter(SleepEntry.entry_date >= cutoff).all()}
    mood_map  = {r.entry_date.isoformat(): r
                 for r in MoodEntry.query.filter(MoodEntry.entry_date >= cutoff).all()}

    ex_rows = ExerciseEntry.query.filter(ExerciseEntry.entry_date >= cutoff).all()
    ex_by_day: dict = {}
    for r in ex_rows:
        k = r.entry_date.isoformat()
        if k not in ex_by_day:
            ex_by_day[k] = {"minutes": 0, "calories": 0, "types": set()}
        ex_by_day[k]["minutes"]  += r.duration_minutes or 0
        ex_by_day[k]["calories"] += r.calories_burned or 0
        ex_by_day[k]["types"].add(r.exercise_type)

    food_by_day: dict = {}
    for r in FoodEntry.query.filter(FoodEntry.entry_date >= cutoff).all():
        k = r.entry_date.isoformat()
        food_by_day[k] = food_by_day.get(k, 0) + (r.calories or 0)

    weight_map = {r.entry_date.isoformat(): r.weight_lbs
                  for r in WeightEntry.query.filter(WeightEntry.entry_date >= cutoff).all()}

    habits      = Habit.query.filter_by(is_active=True).all()
    habit_count = len(habits)
    habit_by_day: dict = {}
    for r in HabitLog.query.filter(HabitLog.log_date >= cutoff).all():
        k = r.log_date.isoformat()
        habit_by_day[k] = habit_by_day.get(k, 0) + 1

    # Supplements
    supp_rows  = Supplement.query.filter_by(is_active=True).all()
    supp_id_to_name = {s.id: s.name for s in supp_rows}
    supp_logs  = SupplementLog.query.filter(SupplementLog.log_date >= cutoff).all()
    supp_by_day: dict = {}
    for r in supp_logs:
        k = r.log_date.isoformat()
        if k not in supp_by_day:
            supp_by_day[k] = set()
        name = supp_id_to_name.get(r.supplement_id)
        if name:
            supp_by_day[k].add(name)

    # Screen Time
    st_map = {r.entry_date.isoformat(): r for r in ScreenTimeEntry.query.filter(
        ScreenTimeEntry.entry_date >= cutoff
    ).all()}

    all_dates = (set(sleep_map) | set(mood_map) | set(ex_by_day) |
                 set(food_by_day) | set(weight_map) | set(habit_by_day) | set(st_map))

    matrix = []
    for d_str in sorted(all_dates):
        s  = sleep_map.get(d_str)
        m  = mood_map.get(d_str)
        ex = ex_by_day.get(d_str)
        st = st_map.get(d_str)
        mood_tags = []
        if m and m.tags:
            try:
                mood_tags = json.loads(m.tags)
            except Exception:
                mood_tags = []
        matrix.append({
            "date":        d_str,
            "sleep_hours": round(s.sleep_duration_minutes / 60, 2) if s and s.sleep_duration_minutes else None,
            "sleep_cycles": s.sleep_cycles if s else None,
            "mood":        m.mood_score if m else None,
            "energy":      (m.energy_score if m and m.energy_score else
                            (s.energy_score if s else None)),
            "anxiety":     m.anxiety_score if m else None,
            "mood_tags":   mood_tags,
            "exercised":   ex is not None,
            "ex_minutes":  ex["minutes"] if ex else 0,
            "ex_types":    list(ex["types"]) if ex else [],
            "food_cal":    food_by_day.get(d_str),
            "weight":      weight_map.get(d_str),
            "habits_done": habit_by_day.get(d_str, 0),
            "habits_total": habit_count,
            "habits_pct":       round(habit_by_day.get(d_str, 0) / habit_count * 100)
                                if habit_count and d_str in habit_by_day else None,
            "supplements_taken": list(supp_by_day.get(d_str, set())),
            "focus_hours":  st.focus_hours  if st else None,
            "screen_hours": st.screen_hours if st else None,
        })
    return matrix


def _compute_correlation_stats(matrix: list) -> dict:
    def avg(vals):
        vals = [v for v in vals if v is not None]
        return round(sum(vals) / len(vals), 1) if vals else None

    stats: dict = {}

    # Sleep ↔ Mood
    pairs = [(r["sleep_hours"], r["mood"], r["energy"])
             for r in matrix if r["sleep_hours"] and r["mood"]]
    if pairs:
        low  = [(m, e) for h, m, e in pairs if h < 7]
        high = [(m, e) for h, m, e in pairs if h >= 7]
        stats["sleep_mood"] = {
            "n_low":          len(low),
            "n_high":         len(high),
            "avg_mood_lt7":   avg([m for m, _ in low]),
            "avg_mood_gte7":  avg([m for m, _ in high]),
            "avg_energy_lt7": avg([e for _, e in low if e]),
            "avg_energy_gte7":avg([e for _, e in high if e]),
            "threshold_hrs":  7,
        }

    # Exercise ↔ Mood/Energy
    ex_days   = [r for r in matrix if r["exercised"] and r["mood"]]
    rest_days = [r for r in matrix if not r["exercised"] and r["mood"]]
    if ex_days or rest_days:
        st = {
            "n_exercise":       len(ex_days),
            "n_rest":           len(rest_days),
            "avg_mood_exercise": avg([r["mood"] for r in ex_days]),
            "avg_mood_rest":     avg([r["mood"] for r in rest_days]),
            "avg_energy_exercise": avg([r["energy"] for r in ex_days]),
            "avg_energy_rest":     avg([r["energy"] for r in rest_days]),
        }
        strength = [r for r in ex_days if "strength" in r["ex_types"]]
        cardio   = [r for r in ex_days if any(t in r["ex_types"]
                    for t in ("cardio", "running", "cycling", "walk"))]
        if strength:
            st["avg_mood_strength"] = avg([r["mood"] for r in strength])
            st["n_strength"] = len(strength)
        if cardio:
            st["avg_mood_cardio"] = avg([r["mood"] for r in cardio])
            st["n_cardio"] = len(cardio)
        stats["exercise_mood"] = st

    # Calories ↔ Weight
    food_days   = [r for r in matrix if r["food_cal"]]
    weight_days = sorted([r for r in matrix if r["weight"]], key=lambda r: r["date"])
    if food_days or weight_days:
        avg_cal = avg([r["food_cal"] for r in food_days])
        st = {
            "n_cal_days":     len(food_days),
            "n_weight_days":  len(weight_days),
            "avg_daily_cal":  avg_cal,
        }
        if len(weight_days) >= 2:
            st["weight_start"]  = round(weight_days[0]["weight"],  1)
            st["weight_end"]    = round(weight_days[-1]["weight"], 1)
            st["weight_change"] = round(weight_days[-1]["weight"] - weight_days[0]["weight"], 1)
            st["days_span"]     = (len(weight_days))
        stats["calories_weight"] = st

    # Habits ↔ Wellbeing
    habit_days = [r for r in matrix if r["habits_pct"] is not None]
    if habit_days:
        high = [r for r in habit_days if r["habits_pct"] >= 75]
        low  = [r for r in habit_days if r["habits_pct"] < 50]
        stats["habits_all"] = {
            "n_high": len(high),
            "n_low":  len(low),
            "avg_mood_high":    avg([r["mood"] for r in high]),
            "avg_mood_low":     avg([r["mood"] for r in low]),
            "avg_energy_high":  avg([r["energy"] for r in high]),
            "avg_energy_low":   avg([r["energy"] for r in low]),
            "avg_sleep_high":   avg([r["sleep_hours"] for r in high]),
            "avg_sleep_low":    avg([r["sleep_hours"] for r in low]),
        }

    # Supplements ↔ Mood/Energy (per supplement, n >= 3 taken days)
    all_supp_names: set = set()
    for r in matrix:
        all_supp_names.update(r.get("supplements_taken", []))
    supp_stats: dict = {}
    for name in all_supp_names:
        taken     = [r for r in matrix if name in r.get("supplements_taken", []) and r["mood"]]
        not_taken = [r for r in matrix if name not in r.get("supplements_taken", []) and r["mood"]]
        if len(taken) >= 3:
            supp_stats[name] = {
                "n_taken":          len(taken),
                "n_not_taken":      len(not_taken),
                "avg_mood_taken":   avg([r["mood"]   for r in taken]),
                "avg_mood_not":     avg([r["mood"]   for r in not_taken]),
                "avg_energy_taken": avg([r["energy"] for r in taken if r["energy"]]),
                "avg_energy_not":   avg([r["energy"] for r in not_taken if r["energy"]]),
            }
    if supp_stats:
        stats["supplements"] = supp_stats

    # Mood tags — avg mood per tag (only tags with n >= 3)
    tag_counter: dict = {}
    tag_mood_sum: dict = {}
    for r in matrix:
        if r["mood"] and r["mood_tags"]:
            for tag in r["mood_tags"]:
                tag_counter[tag]  = tag_counter.get(tag, 0) + 1
                tag_mood_sum[tag] = tag_mood_sum.get(tag, 0) + r["mood"]
    tag_stats = {
        tag: {"n": tag_counter[tag], "avg_mood": round(tag_mood_sum[tag] / tag_counter[tag], 1)}
        for tag in tag_counter if tag_counter[tag] >= 3
    }
    if tag_stats:
        stats["mood_tags"] = tag_stats

    # Screen Time ↔ Habits
    st_days = [r for r in matrix if r.get("focus_hours") is not None and r["habits_pct"] is not None]
    if st_days:
        high_habit = [r for r in st_days if r["habits_pct"] >= 75]
        low_habit  = [r for r in st_days if r["habits_pct"] < 50]
        stats["screen_habits"] = {
            "n_high_habit":          len(high_habit),
            "n_low_habit":           len(low_habit),
            "avg_focus_high_habit":  avg([r["focus_hours"]  for r in high_habit]),
            "avg_focus_low_habit":   avg([r["focus_hours"]  for r in low_habit]),
            "avg_screen_high_habit": avg([r["screen_hours"] for r in high_habit if r["screen_hours"] is not None]),
            "avg_screen_low_habit":  avg([r["screen_hours"] for r in low_habit  if r["screen_hours"] is not None]),
        }

    return stats


@app.route("/api/ai/correlations")
def get_correlations():
    force = request.args.get("force", "false").lower() == "true"
    cache_key = "correlations_30d"
    cache_ttl_hours = 6

    if not force:
        cached = AICache.query.filter_by(cache_key=cache_key).first()
        if cached:
            age_h = (datetime.utcnow() - cached.generated_at).total_seconds() / 3600
            if age_h < cache_ttl_hours:
                payload = json.loads(cached.response_json)
                payload["from_cache"] = True
                return jsonify(payload)

    try:
        date_str = request.args.get("date")
        ref_date = date.fromisoformat(date_str) if date_str else None
        matrix = _build_correlation_matrix(days=30, cutoff_date=ref_date)
        stats  = _compute_correlation_stats(matrix)

        if not any(stats.values()):
            return jsonify({"error": "Not enough data yet — keep logging across modules for a few weeks.", "cards": []})

        tag_section = (
            f"MOOD TRIGGER TAGS (avg mood per tag, n>=3 only):\n{json.dumps(stats.get('mood_tags', {}))}\n\n"
            if stats.get("mood_tags") else ""
        )
        supp_section = (
            f"SUPPLEMENTS ↔ MOOD/ENERGY (avg scores on days taken vs not, n>=3 only):\n{json.dumps(stats.get('supplements', {}))}\n\n"
            if stats.get("supplements") else ""
        )
        screen_section = (
            f"SCREEN TIME ↔ HABITS (focus hours & screen hours on high vs low habit days):\n{json.dumps(stats.get('screen_habits', {}))}\n\n"
            if stats.get("screen_habits") else ""
        )
        prompt = (
            "You are a personal wellness analyst. Below are computed correlation statistics "
            "from 30 days of multi-module tracking data. Generate 5 insight cards.\n\n"
            "For each card produce:\n"
            "  headline: punchy 1-sentence finding with specific numbers from the data\n"
            "  detail: 2-3 sentences of explanation + one actionable tip\n"
            "  enough_data: true if both comparison groups have n >= 4, else false\n\n"
            f"SLEEP ↔ MOOD STATS:\n{json.dumps(stats.get('sleep_mood', {}))}\n\n"
            f"EXERCISE ↔ MOOD/ENERGY STATS:\n{json.dumps(stats.get('exercise_mood', {}))}\n\n"
            f"CALORIES ↔ WEIGHT STATS:\n{json.dumps(stats.get('calories_weight', {}))}\n\n"
            f"HABITS ↔ WELLBEING STATS:\n{json.dumps(stats.get('habits_all', {}))}\n\n"
            f"{tag_section}"
            f"{supp_section}"
            f"{screen_section}"
            "Return ONLY this JSON (no markdown):\n"
            '{"cards":['
            '{"id":"sleep_mood","title":"Sleep ↔ Mood","icon":"\U0001f634","headline":"...","detail":"...","enough_data":true},'
            '{"id":"exercise_mood","title":"Exercise ↔ Mood","icon":"\U0001f4aa","headline":"...","detail":"...","enough_data":true},'
            '{"id":"calories_weight","title":"Calories ↔ Weight","icon":"⚖️","headline":"...","detail":"...","enough_data":true},'
            '{"id":"habits_all","title":"Habits ↔ Wellbeing","icon":"✅","headline":"...","detail":"...","enough_data":true},'
            '{"id":"screen_habits","title":"Focus ↔ Habits","icon":"\U0001f3af","headline":"...","detail":"...","enough_data":true}'
            "]}"
        )

        from ai_service import _get_client, _call_with_retry
        client = _get_client()
        resp   = _call_with_retry(lambda: client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.4,
            max_tokens=900,
        ))

        raw = resp.choices[0].message.content.strip()
        try:
            parsed = json.loads(raw)
        except Exception:
            import re as _re
            parsed = json.loads(_re.sub(r"```(?:json)?|```", "", raw).strip())

        payload = {
            "cards":        parsed.get("cards", []),
            "generated_at": datetime.utcnow().isoformat(),
            "days_analyzed": len(matrix),
            "raw_stats":    stats,
            "from_cache":   False,
        }

        # Store in AICache
        row = AICache.query.filter_by(cache_key=cache_key).first()
        if row is None:
            row = AICache(cache_key=cache_key)
            db.session.add(row)
        row.response_json = json.dumps(payload)
        row.generated_at  = datetime.utcnow()
        db.session.commit()

        return jsonify(payload)

    except Exception as exc:
        return jsonify({"error": str(exc), "cards": []})


# ---------------------------------------------------------------------------
# Profile / Goals Routes
# ---------------------------------------------------------------------------

_ACTIVITY_MULT = {
    "sedentary":  1.2,
    "light":      1.375,
    "moderate":   1.55,
    "active":     1.725,
    "very_active":1.9,
}
_GOAL_ADJ = {"lose": -500, "maintain": 0, "gain": 500}


def _compute_tdee(p):
    """Return (bmr, tdee, suggested_calories) or (None, None, None) if missing inputs."""
    if not all([p.height_in, p.weight_lbs, p.age, p.sex]):
        return None, None, None
    wkg  = p.weight_lbs * 0.453592
    hcm  = p.height_in  * 2.54
    bmr  = 10 * wkg + 6.25 * hcm - 5 * p.age + (5 if p.sex == "male" else -161)
    bmr  = round(bmr)
    tdee = round(bmr * _ACTIVITY_MULT.get(p.activity_level or "sedentary", 1.2))
    # Pace-based suggestion if goal weight is set, else fall back to goal_type adj
    if p.goal_weight_lbs and abs(p.weight_lbs - p.goal_weight_lbs) > 0.5:
        pace      = p.weekly_pace_lbs or 1.0
        daily_adj = pace * 500
        suggested = round(tdee + (-daily_adj if p.weight_lbs > p.goal_weight_lbs else daily_adj))
    else:
        suggested = tdee + _GOAL_ADJ.get(p.goal_type or "maintain", 0)
    return bmr, tdee, suggested


@app.route("/api/profile", methods=["GET"])
def get_profile():
    p = UserProfile.query.first()
    date_str = request.args.get("date")
    try:
        today_local = date.fromisoformat(date_str) if date_str else date.today()
    except ValueError:
        today_local = date.today()
    seven_ago = today_local - timedelta(days=7)

    # 7-day sleep avg
    sl = SleepEntry.query.filter(SleepEntry.entry_date >= seven_ago).all()
    sleep_7d = round(
        sum(s.sleep_duration_minutes / 60 for s in sl if s.sleep_duration_minutes) / len(sl), 1
    ) if sl else None

    # 7-day habit completion %
    habits      = Habit.query.filter_by(is_active=True).all()
    habit_count = len(habits)
    if habit_count:
        from collections import Counter
        logs_7d    = HabitLog.query.filter(HabitLog.log_date >= seven_ago).all()
        day_counts = Counter(l.log_date.isoformat() for l in logs_7d)
        total_possible = habit_count * 7
        habit_7d_pct = round(sum(day_counts.values()) / total_possible * 100) if day_counts else 0
    else:
        habit_7d_pct = None

    # 7-day avg daily calories
    food_7d = FoodEntry.query.filter(FoodEntry.entry_date >= seven_ago).all()
    if food_7d:
        from collections import defaultdict as _dd
        cbyd = _dd(int)
        for f in food_7d:
            cbyd[f.entry_date.isoformat()] += f.calories or 0
        cal_7d = round(sum(cbyd.values()) / len(cbyd))
    else:
        cal_7d = None

    profile_dict = p.to_dict() if p else None
    computed     = None
    if p:
        bmr, tdee, suggested = _compute_tdee(p)
        if bmr:
            computed = {"bmr": bmr, "tdee": tdee, "suggested_calories": suggested}

    return jsonify({
        "profile":  profile_dict,
        "computed": computed,
        "progress": {
            "sleep_7d_avg":    sleep_7d,
            "habit_7d_pct":    habit_7d_pct,
            "calories_7d_avg": cal_7d,
        },
    })


@app.route("/api/profile", methods=["POST"])
def save_profile():
    data = request.get_json(force=True) or {}
    p = UserProfile.query.first()
    if not p:
        p = UserProfile()
        db.session.add(p)
    p.height_in      = data.get("height_in")
    p.weight_lbs     = data.get("weight_lbs")
    p.age            = data.get("age")
    p.sex            = data.get("sex")
    p.activity_level = data.get("activity_level")
    p.goal_type      = data.get("goal_type")
    p.calorie_goal   = data.get("calorie_goal")
    p.sleep_goal_hrs = data.get("sleep_goal_hrs")
    p.habit_goal_pct = data.get("habit_goal_pct")
    p.goal_weight_lbs = data.get("goal_weight_lbs")
    p.weekly_pace_lbs = data.get("weekly_pace_lbs")
    p.updated_at     = datetime.utcnow()
    db.session.commit()
    bmr, tdee, suggested = _compute_tdee(p)
    return jsonify({
        "profile":  p.to_dict(),
        "computed": {"bmr": bmr, "tdee": tdee, "suggested_calories": suggested} if bmr else None,
    })


@app.route("/api/profile/calorie-goal", methods=["POST"])
def save_calorie_goal():
    goal = (request.get_json(force=True) or {}).get("calorie_goal")
    if not isinstance(goal, (int, float)) or goal < 500:
        return jsonify({"error": "invalid calorie goal"}), 400
    p = UserProfile.query.first()
    if not p:
        p = UserProfile()
        db.session.add(p)
    p.calorie_goal = int(goal)
    p.updated_at   = datetime.utcnow()
    db.session.commit()
    return jsonify({"calorie_goal": p.calorie_goal})


# ---------------------------------------------------------------------------
# Screen Time Routes
# ---------------------------------------------------------------------------

@app.route("/api/screen-time", methods=["GET"])
def get_screen_time():
    date_str = request.args.get("date")
    limit    = request.args.get("limit", type=int)
    if date_str:
        try:
            d = date.fromisoformat(date_str)
        except ValueError:
            return jsonify({"error": "Invalid date"}), 400
        entry = ScreenTimeEntry.query.filter_by(entry_date=d).first()
        return jsonify(entry.to_dict() if entry else None)
    q = ScreenTimeEntry.query.order_by(ScreenTimeEntry.entry_date.desc())
    if limit:
        q = q.limit(limit)
    return jsonify([e.to_dict() for e in q.all()])


@app.route("/api/screen-time", methods=["POST"])
def upsert_screen_time():
    data     = request.get_json(force=True) or {}
    date_str = data.get("entry_date")
    if not date_str:
        return jsonify({"error": "entry_date required"}), 422
    try:
        entry_date_d = date.fromisoformat(date_str)
    except (TypeError, ValueError):
        return jsonify({"error": "invalid entry_date format"}), 422
    entry = ScreenTimeEntry.query.filter_by(entry_date=entry_date_d).first()
    if not entry:
        entry = ScreenTimeEntry(entry_date=entry_date_d)
        db.session.add(entry)
    entry.focus_hours  = data.get("focus_hours")
    entry.screen_hours = data.get("screen_hours")
    entry.note         = data.get("note") or None
    db.session.commit()
    return jsonify(entry.to_dict())


@app.route("/api/screen-time/<int:entry_id>", methods=["DELETE"])
def delete_screen_time(entry_id):
    entry = ScreenTimeEntry.query.get_or_404(entry_id)
    db.session.delete(entry)
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Chores Routes
# ---------------------------------------------------------------------------

def _chore_due_on_dow(chore, dow: int) -> bool:
    """Return True if chore is scheduled for day-of-week dow (0=Mon, 6=Sun)."""
    r = chore.recurrence
    if r == "daily":    return True
    if r == "weekdays": return 0 <= dow <= 4
    if r == "weekends": return dow >= 5
    if r == "custom":
        days = json.loads(chore.days or "[]")
        return dow in days
    return False


@app.route("/api/chores", methods=["GET"])
def get_chores():
    chores = Chore.query.filter_by(active=True).order_by(Chore.created_at).all()
    return jsonify([c.to_dict() for c in chores])


@app.route("/api/chores", methods=["POST"])
def create_chore():
    d = request.get_json(force=True) or {}
    name = (d.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    recurrence = d.get("recurrence", "custom")
    if recurrence not in ("daily", "weekdays", "weekends", "custom"):
        recurrence = "custom"
    chore = Chore(
        name       = name,
        icon       = (d.get("icon") or "🧹")[:10],
        color      = (d.get("color") or "#60a5fa")[:20],
        recurrence = recurrence,
        days       = json.dumps([int(x) for x in d.get("days", [])]),
    )
    db.session.add(chore)
    db.session.commit()
    return jsonify(chore.to_dict()), 201


@app.route("/api/chores/<int:chore_id>", methods=["DELETE"])
def delete_chore(chore_id):
    chore = Chore.query.get_or_404(chore_id)
    db.session.delete(chore)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/chores/week", methods=["GET"])
def chores_week():
    ws_str = request.args.get("week_start")
    try:
        ws = datetime.strptime(ws_str, "%Y-%m-%d").date() if ws_str else None
    except ValueError:
        ws = None
    if ws is None:
        today_d = date.today()
        ws = today_d - timedelta(days=today_d.weekday())   # Monday

    today_str = request.args.get("today")
    try:
        today_d = date.fromisoformat(today_str) if today_str else date.today()
    except ValueError:
        today_d = date.today()

    week_dates = [ws + timedelta(days=i) for i in range(7)]
    chores     = Chore.query.filter_by(active=True).order_by(Chore.created_at).all()

    logs       = ChoreLog.query.filter(ChoreLog.log_date.in_(week_dates)).all()
    log_map    = {(l.chore_id, l.log_date): l.completed for l in logs}

    DAY_NAMES  = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
    DAY_SHORTS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
    total = 0; done_count = 0
    days_out = []

    for i, d in enumerate(week_dates):
        day_chores = []
        for c in chores:
            if _chore_due_on_dow(c, i):
                date_str  = d.isoformat()
                completed = log_map.get((c.id, d), False)
                day_chores.append({
                    "chore_id":  c.id,
                    "name":      c.name,
                    "icon":      c.icon,
                    "color":     c.color,
                    "completed": completed,
                    "date":      date_str,
                })
                total += 1
                if completed:
                    done_count += 1
        days_out.append({
            "date":      d.isoformat(),
            "day_name":  DAY_NAMES[i],
            "day_short": DAY_SHORTS[i],
            "is_today":  d == today_d,
            "is_past":   d < today_d,
            "chores":    day_chores,
        })

    pct = round(done_count / total * 100) if total > 0 else 0
    return jsonify({
        "week_start": ws.isoformat(),
        "week_end":   week_dates[-1].isoformat(),
        "days":       days_out,
        "stats":      {"total": total, "completed": done_count, "pct": pct},
    })


@app.route("/api/chores/log", methods=["POST"])
def toggle_chore_log():
    d            = request.get_json(force=True) or {}
    chore_id     = d.get("chore_id")
    log_date_str = d.get("log_date")
    if not chore_id or not log_date_str:
        return jsonify({"error": "chore_id and log_date required"}), 400
    try:
        log_date = date.fromisoformat(log_date_str)
    except (TypeError, ValueError):
        return jsonify({"error": "invalid log_date format"}), 400
    existing = ChoreLog.query.filter_by(chore_id=chore_id, log_date=log_date).first()
    if existing:
        existing.completed = not existing.completed
    else:
        existing = ChoreLog(chore_id=chore_id, log_date=log_date, completed=True)
        db.session.add(existing)
    db.session.commit()
    return jsonify({"chore_id": chore_id, "log_date": log_date.isoformat(), "completed": existing.completed})


# ---------------------------------------------------------------------------
# Supplements Routes
# ---------------------------------------------------------------------------

@app.route("/api/supplements", methods=["GET"])
def get_supplements():
    date_str = request.args.get("date", date.today().isoformat())
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        d = date.today()
    supps = Supplement.query.filter_by(is_active=True).order_by(Supplement.created_at).all()
    return jsonify([s.to_dict(today=d) for s in supps])


@app.route("/api/supplements", methods=["POST"])
def create_supplement():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()[:100]
    if not name:
        return jsonify({"error": "name required"}), 422
    icon = (data.get("icon") or "💊")[:10]
    s = Supplement(name=name, icon=icon)
    db.session.add(s)
    db.session.commit()
    return jsonify(s.to_dict()), 201


@app.route("/api/supplements/<int:supp_id>", methods=["PATCH"])
def update_supplement(supp_id):
    s = db.session.get(Supplement, supp_id)
    if not s:
        return jsonify({"error": "not found"}), 404
    data = request.get_json(force=True) or {}
    if "name" in data:
        s.name = (data["name"] or "").strip()[:100] or s.name
    if "icon" in data:
        s.icon = (data["icon"] or "💊")[:10]
    db.session.commit()
    return jsonify(s.to_dict())


@app.route("/api/supplements/<int:supp_id>", methods=["DELETE"])
def delete_supplement(supp_id):
    s = db.session.get(Supplement, supp_id)
    if not s:
        return jsonify({"error": "not found"}), 404
    db.session.delete(s)
    db.session.commit()
    return jsonify({"deleted": supp_id})


@app.route("/api/supplements/<int:supp_id>/log", methods=["POST"])
def toggle_supplement_log(supp_id):
    s = db.session.get(Supplement, supp_id)
    if not s:
        return jsonify({"error": "not found"}), 404
    data     = request.get_json(force=True) or {}
    date_str = (data.get("log_date") or date.today().isoformat()).strip()
    try:
        log_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "invalid date"}), 400
    log = SupplementLog.query.filter_by(supplement_id=supp_id, log_date=log_date).first()
    if log:
        db.session.delete(log)
        taken = False
    else:
        log = SupplementLog(supplement_id=supp_id, log_date=log_date)
        db.session.add(log)
        taken = True
    db.session.commit()
    return jsonify({"supplement_id": supp_id, "log_date": date_str, "taken": taken})


# ---------------------------------------------------------------------------
# Body Measurements Routes
# ---------------------------------------------------------------------------

@app.route("/api/body-measurements", methods=["GET"])
def get_body_measurements():
    limit = min(int(request.args.get("limit", 1095)), 1095)
    rows = (BodyMeasurement.query
            .order_by(BodyMeasurement.entry_date.desc())
            .limit(limit)
            .all())
    return jsonify([r.to_dict() for r in rows])


@app.route("/api/body-measurements", methods=["POST"])
def upsert_body_measurement():
    data = request.get_json(force=True) or {}
    entry_date_str = (data.get("entry_date") or "").strip()
    if not entry_date_str:
        return jsonify({"error": "entry_date required"}), 422
    try:
        entry_date = date.fromisoformat(entry_date_str)
    except ValueError:
        return jsonify({"error": "invalid entry_date format"}), 422

    _MEAS_FIELDS = ["waist_in", "hips_in", "chest_in", "left_arm_in",
                    "right_arm_in", "left_thigh_in", "right_thigh_in"]
    for key in _MEAS_FIELDS:
        v = data.get(key)
        if v is None or v == "":
            continue
        try:
            fv = float(v)
        except (TypeError, ValueError):
            return jsonify({"error": f"{key} must be a number"}), 422
        if not (0 < fv <= 200):
            return jsonify({"error": f"{key} must be between 0 and 200 inches"}), 422

    def _float(key):
        v = data.get(key)
        if v is None or v == "":
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    row = BodyMeasurement.query.filter_by(entry_date=entry_date).first()
    if row is None:
        row = BodyMeasurement(entry_date=entry_date)
        db.session.add(row)

    row.waist_in       = _float("waist_in")
    row.hips_in        = _float("hips_in")
    row.chest_in       = _float("chest_in")
    row.left_arm_in    = _float("left_arm_in")
    row.right_arm_in   = _float("right_arm_in")
    row.left_thigh_in  = _float("left_thigh_in")
    row.right_thigh_in = _float("right_thigh_in")
    row.notes          = (data.get("notes") or "").strip() or None
    db.session.commit()
    return jsonify(row.to_dict()), 200


@app.route("/api/body-measurements/<int:entry_id>", methods=["DELETE"])
def delete_body_measurement(entry_id):
    row = db.session.get(BodyMeasurement, entry_id)
    if not row:
        return jsonify({"error": "not found"}), 404
    db.session.delete(row)
    db.session.commit()
    return jsonify({"deleted": entry_id})


# ---------------------------------------------------------------------------
# DB Sync — push local database to cloud (protected by SYNC_TOKEN secret)
# ---------------------------------------------------------------------------

@app.route("/api/sync/pull-db", methods=["GET"])
def sync_pull_db():
    import base64
    token = os.environ.get("SYNC_TOKEN", "")
    if not token or request.headers.get("X-Sync-Token") != token:
        return jsonify({"error": "forbidden"}), 403
    db_path = os.environ.get("DB_PATH", "/data/sleep_tracker.db")
    with open(db_path, "rb") as f:
        db_bytes = f.read()
    return jsonify({"db_b64": base64.b64encode(db_bytes).decode(), "bytes": len(db_bytes)})


@app.route("/api/sync/push-db", methods=["POST"])
def sync_push_db():
    import base64, shutil
    token = os.environ.get("SYNC_TOKEN", "")
    if not token or request.headers.get("X-Sync-Token") != token:
        return jsonify({"error": "forbidden"}), 403
    data = request.get_json(force=True)
    if not data or "db_b64" not in data:
        return jsonify({"error": "missing db_b64"}), 400
    db_bytes = base64.b64decode(data["db_b64"])
    dest = os.environ.get("DB_PATH", "/data/sleep_tracker.db")
    tmp  = dest + ".upload.tmp"
    with open(tmp, "wb") as f:
        f.write(db_bytes)
    shutil.move(tmp, dest)
    return jsonify({"ok": True, "bytes": len(db_bytes)})


# ---------------------------------------------------------------------------
# Reminders / SMS Routes
# ---------------------------------------------------------------------------

_PACIFIC = ZoneInfo("America/Los_Angeles")

REMINDER_CATEGORIES = ["goals", "nutrition", "skincare", "tasks"]
_REMINDER_DEFAULTS = {
    "goals":     {"enabled": True, "hour": 8,  "minute": 0, "label": "Goals",     "icon": "🎯"},
    "nutrition": {"enabled": True, "hour": 19, "minute": 0, "label": "Nutrition", "icon": "🍗"},
    "skincare":  {"enabled": True, "hour": 21, "minute": 0, "label": "Skincare",  "icon": "✨"},
    "tasks":     {"enabled": True, "hour": 9,  "minute": 0, "label": "Tasks",     "icon": "✅"},
}


# US carrier email-to-SMS gateways (free — send a plain-text email, it arrives as a text).
_CARRIER_GATEWAYS = {
    "tmobile":    {"domain": "tmomail.net",              "label": "T-Mobile"},
    "att":        {"domain": "txt.att.net",              "label": "AT&T"},
    "verizon":    {"domain": "vtext.com",                "label": "Verizon"},
    "googlefi":   {"domain": "msg.fi.google.com",        "label": "Google Fi"},
    "metro":      {"domain": "mymetropcs.com",           "label": "Metro"},
    "cricket":    {"domain": "sms.cricketwireless.net",  "label": "Cricket"},
    "boost":      {"domain": "sms.myboostmobile.com",    "label": "Boost"},
    "uscellular": {"domain": "email.uscc.net",           "label": "US Cellular"},
}


def _gmail_configured():
    return bool(os.environ.get("GMAIL_ADDRESS") and os.environ.get("GMAIL_APP_PASSWORD"))


def _sms_configured():
    """True if any delivery channel is usable (free Gmail email-to-SMS or Twilio)."""
    return _gmail_configured() or all(
        os.environ.get(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"))


def _gateway_address(phone, carrier):
    """Build a carrier email-to-SMS address, e.g. 5108767182@tmomail.net."""
    g = _CARRIER_GATEWAYS.get(carrier or "")
    if not g:
        return None
    digits = re.sub(r"\D", "", phone or "")[-10:]
    if len(digits) != 10:
        return None
    return f"{digits}@{g['domain']}"


def _send_email_sms(to_addr, body):
    """Send a text via the carrier's email-to-SMS gateway using Gmail SMTP.

    The message is PLAIN TEXT only (no HTML part) so the SMS arrives clean —
    Gmail's web/app composer adds an HTML layer that shows up as <div> tags in
    the text; a pure text/plain SMTP send avoids that entirely.
    """
    user = os.environ.get("GMAIL_ADDRESS")
    pw   = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "")  # app pwds shown with spaces
    if not (user and pw):
        return False, "Gmail not configured (GMAIL_ADDRESS / GMAIL_APP_PASSWORD)."
    msg = MIMEText(body, "plain", "utf-8")
    msg["From"]    = user
    msg["To"]      = to_addr
    msg["Subject"] = " "   # single space — suppresses the carrier's "(no subject)" line
    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=20) as s:
            s.ehlo(); s.starttls(); s.ehlo()
            s.login(user, pw)
            s.sendmail(user, [to_addr], msg.as_string())
        return True, "sent via gmail"
    except Exception as e:  # noqa: BLE001
        return False, f"Gmail SMS failed: {e}"


def _deliver_sms(phone, carrier, body):
    """Deliver a reminder. Prefer free Gmail email-to-SMS; fall back to Twilio."""
    if _gmail_configured() and carrier in _CARRIER_GATEWAYS:
        addr = _gateway_address(phone, carrier)
        if not addr:
            return False, "Invalid phone for email-to-SMS gateway."
        return _send_email_sms(addr, body)
    return _send_sms(phone, body)


def _send_sms(to, body):
    """Send one SMS via the Twilio REST API using only the stdlib.

    Returns (ok: bool, detail: str) where detail is the message SID on success
    or an error string on failure.
    """
    sid   = os.environ.get("TWILIO_ACCOUNT_SID")
    token = os.environ.get("TWILIO_AUTH_TOKEN")
    frm   = os.environ.get("TWILIO_FROM")
    if not (sid and token and frm):
        return False, "SMS not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM."
    if not to:
        return False, "No destination phone number set."

    url  = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    data = urllib.parse.urlencode({"To": to, "From": frm, "Body": body}).encode()
    req  = urllib.request.Request(url, data=data, method="POST")
    auth = base64.b64encode(f"{sid}:{token}".encode()).decode()
    req.add_header("Authorization", f"Basic {auth}")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode())
            return True, payload.get("sid", "sent")
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode())
            return False, f"Twilio {e.code}: {err.get('message', '')} (code {err.get('code')})"
        except Exception:
            return False, f"Twilio HTTP {e.code}"
    except Exception as e:  # noqa: BLE001
        return False, f"SMS send failed: {e}"


def _protein_target():
    """Daily protein target in grams = latest body weight (1g/lb)."""
    we = WeightEntry.query.order_by(WeightEntry.entry_date.desc()).first()
    if we and we.weight_lbs:
        return round(we.weight_lbs)
    p = UserProfile.query.first()
    if p and p.weight_lbs:
        return round(p.weight_lbs)
    return None


def _msg_nutrition(d):
    foods      = FoodEntry.query.filter_by(entry_date=d).all()
    consumed_p = round(sum(f.protein_g or 0 for f in foods))
    consumed_c = sum(f.calories or 0 for f in foods)
    p          = UserProfile.query.first()
    goal_c     = p.calorie_goal if (p and p.calorie_goal) else 2000
    parts      = []
    tgt        = _protein_target()
    if tgt:
        left = max(0, tgt - consumed_p)
        parts.append(f"protein {consumed_p}/{tgt}g ✅" if left == 0 else f"protein {consumed_p}/{tgt}g ({left}g to go)")
    cal_left = goal_c - consumed_c
    parts.append(f"{cal_left} cal left" if cal_left >= 0 else f"{abs(cal_left)} cal over")
    return "🍗 Nutrition: " + ", ".join(parts) + "."


def _msg_skincare(d):
    log = SkincareLog.query.filter_by(log_date=d).first()
    am  = bool(log and log.am_done)
    pm  = bool(log and log.pm_done)
    if am and pm:
        return "✨ Skincare: AM + PM both done — nice work!"
    pending = [name for name, done in (("AM", am), ("PM", pm)) if not done]
    return f"✨ Skincare: {' & '.join(pending)} routine still to do today."


def _msg_tasks(d):
    active    = Task.query.filter(Task.status != "done").all()
    if not active:
        return "✅ Tasks: all clear — nothing pending."
    overdue   = sum(1 for t in active if t.due_date and t.due_date < d)
    due_today = sum(1 for t in active if t.due_date == d)
    bits = []
    if overdue:   bits.append(f"{overdue} overdue")
    if due_today: bits.append(f"{due_today} due today")
    if not bits:  bits.append(f"{len(active)} open")
    return "✅ Tasks: " + ", ".join(bits) + "."


def _msg_goals(d):
    habits = Habit.query.filter_by(is_active=True).all()
    total  = len(habits)
    if total:
        done = sum(1 for h in habits
                   if HabitLog.query.filter_by(habit_id=h.id, log_date=d).first())
        tail = "Keep the streak alive! 🔥" if done < total else "All habits done! 🔥"
        return f"🎯 Goals: habits {done}/{total} today. {tail}"
    return "🎯 Goals: log today's progress to stay on track."


_MSG_BUILDERS = {
    "goals": _msg_goals, "nutrition": _msg_nutrition,
    "skincare": _msg_skincare, "tasks": _msg_tasks,
}


def _reminder_settings(cfg):
    stored = json.loads(cfg.settings_json or "{}") if cfg else {}
    out = {}
    for cat, dflt in _REMINDER_DEFAULTS.items():
        s = stored.get(cat, {})
        out[cat] = {
            "enabled": bool(s.get("enabled", dflt["enabled"])),
            "hour":    int(s.get("hour",   dflt["hour"])),
            "minute":  int(s.get("minute", dflt["minute"])),
        }
    return out


def _get_or_create_cfg():
    cfg = ReminderConfig.query.first()
    if not cfg:
        cfg = ReminderConfig(phone=None, enabled=True, settings_json="{}", last_sent_json="{}")
        db.session.add(cfg)
        db.session.commit()
    return cfg


@app.route("/api/reminders", methods=["GET"])
def get_reminders():
    cfg = _get_or_create_cfg()
    return jsonify({
        "phone":          cfg.phone or "",
        "carrier":        cfg.carrier or "",
        "enabled":        cfg.enabled,
        "settings":       _reminder_settings(cfg),
        "last_sent":      json.loads(cfg.last_sent_json or "{}"),
        "categories":     [{"key": k, **{x: v[x] for x in ("label", "icon")}} for k, v in _REMINDER_DEFAULTS.items()],
        "carriers":       [{"key": k, "label": v["label"]} for k, v in _CARRIER_GATEWAYS.items()],
        "delivery":       "gmail" if _gmail_configured() else ("twilio" if _sms_configured() else "none"),
        "sms_configured": _sms_configured(),
        "now_pst":        datetime.now(_PACIFIC).strftime("%Y-%m-%d %H:%M %Z"),
    })


@app.route("/api/reminders", methods=["POST"])
def save_reminders():
    data = request.get_json(force=True) or {}
    cfg  = _get_or_create_cfg()

    if "phone" in data:
        phone = str(data.get("phone") or "").strip()
        cfg.phone = phone[:20] or None
    if "carrier" in data:
        c = str(data.get("carrier") or "").strip().lower()
        cfg.carrier = c if c in _CARRIER_GATEWAYS else None
    if "enabled" in data:
        cfg.enabled = bool(data["enabled"])

    if isinstance(data.get("settings"), dict):
        merged = _reminder_settings(cfg)
        for cat, s in data["settings"].items():
            if cat not in _REMINDER_DEFAULTS or not isinstance(s, dict):
                continue
            cur = merged[cat]
            if "enabled" in s: cur["enabled"] = bool(s["enabled"])
            if "hour" in s:
                try: cur["hour"] = max(0, min(23, int(s["hour"])))
                except (TypeError, ValueError): pass
            if "minute" in s:
                try: cur["minute"] = max(0, min(59, int(s["minute"])))
                except (TypeError, ValueError): pass
        cfg.settings_json = json.dumps(merged)

    db.session.commit()
    return jsonify({"ok": True, **get_reminders().get_json()})


@app.route("/api/reminders/test", methods=["POST"])
def test_reminder():
    data = request.get_json(force=True) or {}
    cfg  = _get_or_create_cfg()

    # Persist phone/carrier if supplied so the test doubles as a save.
    phone = str(data.get("phone") or cfg.phone or "").strip()
    if data.get("phone"):
        cfg.phone = phone[:20] or None
    if data.get("carrier"):
        c = str(data["carrier"]).strip().lower()
        cfg.carrier = c if c in _CARRIER_GATEWAYS else cfg.carrier
    db.session.commit()
    carrier = cfg.carrier

    if not phone:
        return jsonify({"error": "Add a phone number first."}), 400
    if not _sms_configured():
        return jsonify({"error": "No delivery channel configured. Set GMAIL_ADDRESS + GMAIL_APP_PASSWORD (free email-to-SMS) or TWILIO_* creds."}), 503

    d   = datetime.now(_PACIFIC).date()
    cat = data.get("category")
    if cat in _MSG_BUILDERS:
        body = "Test reminder - " + _MSG_BUILDERS[cat](d)
    else:
        lines = [_MSG_BUILDERS[c](d) for c in REMINDER_CATEGORIES]
        body  = "Life Tracker test reminder:\n" + "\n".join(lines)

    ok, detail = _deliver_sms(phone, carrier, body)
    if not ok:
        return jsonify({"error": detail}), 502
    return jsonify({"ok": True, "sid": detail, "preview": body, "to": phone,
                    "via": "gmail" if (_gmail_configured() and carrier in _CARRIER_GATEWAYS) else "twilio"})


@app.route("/api/reminders/run", methods=["GET", "POST"])
def run_reminders():
    """Cron target — sends any reminders now due (Pacific time). Token-gated."""
    token = os.environ.get("REMINDER_CRON_TOKEN")
    if not token or request.args.get("token") != token:
        return jsonify({"error": "forbidden"}), 403

    cfg = _get_or_create_cfg()
    if not cfg.enabled or not cfg.phone:
        return jsonify({"sent": 0, "reason": "disabled or no phone"})
    if not _sms_configured():
        return jsonify({"sent": 0, "reason": "SMS not configured"}), 200

    now_pst  = datetime.now(_PACIFIC)
    today_iso = now_pst.date().isoformat()
    settings  = _reminder_settings(cfg)
    last_sent = json.loads(cfg.last_sent_json or "{}")

    sent, results = 0, []
    for cat in REMINDER_CATEGORIES:
        s = settings[cat]
        if not s["enabled"] or last_sent.get(cat) == today_iso:
            continue
        due_at = now_pst.replace(hour=s["hour"], minute=s["minute"], second=0, microsecond=0)
        if now_pst < due_at:
            continue
        ok, detail = _deliver_sms(cfg.phone, cfg.carrier, _MSG_BUILDERS[cat](now_pst.date()))
        results.append({"category": cat, "ok": ok, "detail": detail})
        if ok:
            last_sent[cat] = today_iso
            sent += 1

    cfg.last_sent_json = json.dumps(last_sent)
    db.session.commit()
    return jsonify({"sent": sent, "results": results, "now_pst": now_pst.strftime("%Y-%m-%d %H:%M %Z")})


# ---------------------------------------------------------------------------
# SPA — serve built React frontend (production; no-op in local dev)
# ---------------------------------------------------------------------------

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path):
    if not os.path.isdir(FRONTEND_DIST):
        return jsonify({"status": "Flask API running (no frontend build found)"}), 200
    full = os.path.join(FRONTEND_DIST, path)
    if path and os.path.isfile(full):
        return send_from_directory(FRONTEND_DIST, path)
    return send_from_directory(FRONTEND_DIST, "index.html")


# ---------------------------------------------------------------------------
# Bootstrap — runs on every startup (direct and gunicorn)
# ---------------------------------------------------------------------------

with app.app_context():
    db.create_all()
    try:
        from sqlalchemy import text
        with db.engine.connect() as conn:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN list_name VARCHAR(20) NOT NULL DEFAULT 'work'"))
            conn.commit()
        print("Migrated tasks table: added list_name column.")
    except Exception:
        pass
    try:
        from sqlalchemy import text
        with db.engine.connect() as conn:
            result = conn.execute(text("UPDATE tasks SET list_name='personal' WHERE list_name='social'"))
            conn.commit()
            if result.rowcount:
                print(f"Migrated {result.rowcount} task(s): social → personal.")
    except Exception:
        pass
    for _tbl, _col, _typedef in [
        ("exercise_entries",       "sets",       "INTEGER"),
        ("exercise_entries",       "reps",       "INTEGER"),
        ("exercise_entries",       "weight_lbs", "REAL"),
        ("exercise_entries",       "group_name", "VARCHAR(100)"),
        ("exercise_template_items","sets",       "INTEGER"),
        ("exercise_template_items","reps",       "INTEGER"),
        ("exercise_template_items","weight_lbs", "REAL"),
        ("mood_entries",           "tags",       "TEXT"),
        ("user_profile",           "goal_weight_lbs", "REAL"),
        ("user_profile",           "weekly_pace_lbs", "REAL"),
        ("reminder_config",        "carrier",         "VARCHAR(20)"),
    ]:
        try:
            with db.engine.connect() as conn:
                conn.execute(text(f"ALTER TABLE {_tbl} ADD COLUMN {_col} {_typedef}"))
                conn.commit()
        except Exception:
            pass
    # Seed default supplements if table is empty
    if Supplement.query.count() == 0:
        for _name, _icon in [("Creatine", "💪"), ("Vitamin D", "☀️")]:
            db.session.add(Supplement(name=_name, icon=_icon))
        db.session.commit()
    # Seed default skincare steps if table is empty
    if SkinCareStep.query.count() == 0:
        _sc_defaults = [
            ("Cleanser",          "am", 1),
            ("Toner",             "am", 2),
            ("Vitamin C Serum",   "am", 3),
            ("Moisturizer",       "am", 4),
            ("SPF / Sunscreen",   "am", 5),
            ("Oil Cleanse",       "pm", 1),
            ("Cleanser",          "pm", 2),
            ("Toner",             "pm", 3),
            ("Treatment / Retinol","pm", 4),
            ("Eye Cream",         "pm", 5),
            ("Night Moisturizer", "pm", 6),
        ]
        for _name, _tod, _ord in _sc_defaults:
            db.session.add(SkinCareStep(name=_name, time_of_day=_tod, order_index=_ord))
        db.session.commit()

    # Migrate old skincare-chat ExerciseEntry rows → SkinWorkoutLog, then delete them
    try:
        old_sk = ExerciseEntry.query.filter(ExerciseEntry.notes.like("sweat_level=%")).all()
        if old_sk:
            for _e in old_sk:
                _sweat = "medium"
                _lat   = None
                for _part in (_e.notes or "").split(";"):
                    _p = _part.strip()
                    if _p.startswith("sweat_level="):
                        _sweat = _p.split("=",1)[1].strip()
                    elif _p.startswith("logged_at="):
                        _lat = _p.split("=",1)[1].strip()
                db.session.add(SkinWorkoutLog(
                    log_date         = _e.entry_date,
                    exercise_type    = _e.exercise_type,
                    name             = _e.name or "Workout",
                    sweat_level      = _sweat,
                    logged_at_pst    = _lat,
                    duration_minutes = _e.duration_minutes or None,
                    created_at       = _e.created_at,
                ))
                db.session.delete(_e)
            db.session.commit()
            print(f"Migrated {len(old_sk)} skincare workout entries from exercise_entries → skin_workout_logs")
    except Exception as _ex:
        db.session.rollback()
        print(f"Skincare workout migration skipped: {_ex}")

    print(f"Database ready: {DB_PATH}")
    key_status = "OK" if os.environ.get("GROQ_API_KEY") else "MISSING - set GROQ_API_KEY env var"
    print(f"Groq API key : {key_status}")

if __name__ == "__main__":
    app.run(debug=True, port=3030)
