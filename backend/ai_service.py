"""
ai_service.py
Groq-powered AI intelligence for the Sleep Tracker.
Handles daily briefs (fast, cached) and monthly analysis (deeper).
Model: llama-3.1-8b-instant  — free tier, <500ms responses.
"""

import json
import os
import time

from groq import Groq

# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

_client = None


def _call_with_retry(fn, max_retries: int = 2, base_delay: float = 1.0):
    """Call fn(), retrying on transient Groq errors with exponential backoff."""
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except Exception as exc:
            if attempt == max_retries:
                raise
            cls = type(exc).__name__.lower()
            msg = str(exc).lower()
            transient = any(k in cls or k in msg for k in (
                "timeout", "connection", "ratelimit", "rate_limit",
                "serviceunavailable", "internalserver", "502", "503", "529",
            ))
            if not transient:
                raise
            time.sleep(base_delay * (2 ** attempt))


def _get_client() -> Groq:
    global _client
    if _client is None:
        api_key = os.environ.get("GROQ_API_KEY", "")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY not set. Check backend/.env")
        _client = Groq(api_key=api_key)
    return _client


# ---------------------------------------------------------------------------
# Daily Brief
# ---------------------------------------------------------------------------

DAILY_SYSTEM = (
    "You are a sleep science expert and productivity coach embedded in a personal "
    "biometric tracker. The user is a SOC (Security Operations Center) analyst who "
    "works shifts. You receive their sleep entry plus recent history. "
    "Respond ONLY with a valid JSON object — no markdown, no prose outside the JSON."
)


def _calc_caffeine_cutoff(bed_time: str, offset_hours: int = 9) -> str:
    """Return HH:MM that is offset_hours before bed_time."""
    try:
        h, m = map(int, bed_time.split(":"))
        total = h * 60 + m - offset_hours * 60
        if total < 0:
            total += 1440
        return f"{total // 60:02d}:{total % 60:02d}"
    except Exception:
        return "13:00"


def _build_daily_prompt(entry: dict, history: list) -> str:
    history_lines = []
    for h in history:
        history_lines.append(
            f"  {h['entry_date']}: {h.get('sleep_duration_minutes', '?')}min "
            f"({h.get('sleep_cycles', '?')} cycles), "
            f"inertia={h.get('inertia_score', '?')}, "
            f"energy={h.get('energy_score', '?')}, "
            f"stress={h.get('stress_score', '?')}, "
            f"miles={h.get('miles_walked', '?')}, "
            f"caffeine_cutoff={h.get('caffeine_cutoff_time') or 'none'}, "
            f"caffeine_mg={h.get('caffeine_mg') or 'none'}, "
            f"tags={h.get('tags') or 'none'}"
        )
    history_str = "\n".join(history_lines) if history_lines else "  No prior history."
    wake_time = entry.get("wake_time", "07:00")
    bed_time  = entry.get("bed_time", "23:00")

    # Pre-calculate anchors so the model can't drift
    cutoff_9h  = _calc_caffeine_cutoff(bed_time, offset_hours=9)
    cutoff_10h = _calc_caffeine_cutoff(bed_time, offset_hours=10)

    return f"""Analyze this sleep entry and generate a personalized daily brief.

TODAY ({entry['entry_date']}):
  Bed time:           {bed_time}
  Fell asleep:        {entry.get('sleep_time')}
  Wake time:          {wake_time}
  Out of bed:         {entry.get('out_of_bed_time')}
  Sleep duration:     {entry.get('sleep_duration_minutes')} min ({entry.get('sleep_cycles')} cycles)
  Sleep latency:      {entry.get('sleep_latency_minutes')} min
  Inertia score:      {entry.get('inertia_score')}/10  (1=barely functional, 10=jumped out of bed)
  Energy score:       {entry.get('energy_score')}/10
  Stress score:       {entry.get('stress_score')}/10  (1=zen, 10=high stress)
  Miles walked:       {entry.get('miles_walked', 0)}
  Napped:             {entry.get('naps', False)}
  Caffeine cutoff:    {entry.get('caffeine_cutoff_time') or 'not recorded'}
  Caffeine mg today:  {entry.get('caffeine_mg') or 'not recorded'}
  Tags:               {entry.get('tags') or 'none'}
  Notes:              {entry.get('notes') or 'none'}
  Ankle notes:        {entry.get('ankle_notes') or 'none'}

LAST 7 DAYS:
{history_str}

CAFFEINE CUTOFF CALCULATION (pre-computed — DO NOT change this math):
  Bed time tonight:   {bed_time}
  9h before bed  =    {cutoff_9h}   <- use this as the default recommendation
  10h before bed =    {cutoff_10h}  <- use this if latency was >20 min on any recent night

Return ONLY this JSON (no extra keys, no markdown):
{{
  "caffeine_cutoff_recommendation": "{cutoff_9h}",
  "caffeine_reasoning": "One sentence referencing bed time {bed_time} and any latency patterns from history.",
  "caffeine_mg_context": "One sentence on today's mg intake and whether it's high/moderate/low relative to typical.",
  "sleep_quality_summary": "One sentence summary of last night.",
  "energy_forecast": "One sentence forecast for today based on cycles and inertia.",
  "productivity_steps": [
    "Step 1 — specific, actionable, SOC-analyst aware",
    "Step 2",
    "Step 3",
    "Step 4",
    "Step 5"
  ],
  "pattern_flags": [],
  "recovery_mode": false
}}

Rules:
- caffeine_cutoff_recommendation: MUST be between {cutoff_10h} and {cutoff_9h}. Do NOT go later than {cutoff_9h}. Only go earlier if latency was consistently >20 min.
- caffeine_mg_context: omit if caffeine_mg not recorded.
- productivity_steps: if inertia < 5 -> front-load lighter tasks first hour; if energy < 5 -> 15-min break at hour 3.
- pattern_flags: only real patterns (3+ nights of same issue). Empty array if none.
- recovery_mode: true if duration < 300 min OR 3 of last 5 nights had < 5 cycles.
- All text concise. No fluff."""


def _validate_daily_brief(data: dict, fallback_cutoff: str) -> dict:
    """Ensure all expected fields exist with correct types; fill safe defaults."""
    out = dict(data)
    # String fields
    for key, default in (
        ("caffeine_cutoff_recommendation", fallback_cutoff),
        ("caffeine_reasoning",  ""),
        ("caffeine_mg_context", ""),
        ("sleep_quality_summary", ""),
        ("energy_forecast",    ""),
    ):
        if not isinstance(out.get(key), str) or not out[key]:
            out[key] = default
    # List fields
    for key in ("productivity_steps", "pattern_flags"):
        if not isinstance(out.get(key), list):
            out[key] = []
    # Bool
    out["recovery_mode"] = bool(out.get("recovery_mode", False))
    return out


def get_daily_brief(entry: dict, history: list) -> dict:
    """Call Groq and return parsed daily brief dict."""
    prompt  = _build_daily_prompt(entry, history)
    client  = _get_client()
    bed_time = entry.get("bed_time", "23:00")
    fallback_cutoff = _calc_caffeine_cutoff(bed_time, offset_hours=9)

    resp = _call_with_retry(lambda: client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "system", "content": DAILY_SYSTEM},
            {"role": "user",   "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.3,
        max_tokens=900,
    ))

    raw = resp.choices[0].message.content
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        import re
        cleaned = re.sub(r"```(?:json)?|```", "", raw).strip()
        parsed = json.loads(cleaned)
    return _validate_daily_brief(parsed, fallback_cutoff)


# ---------------------------------------------------------------------------
# Monthly Analysis
# ---------------------------------------------------------------------------

MONTHLY_SYSTEM = (
    "You are a sleep science data analyst. Analyze the provided personal sleep dataset "
    "and return a comprehensive, actionable analysis as a JSON object. "
    "Respond ONLY with valid JSON — no markdown, no prose outside the JSON."
)


def _build_monthly_prompt(entries: list) -> str:
    # Compact the entries to stay within token budget
    compact = []
    for e in entries:
        compact.append({
            "date":        e.get("entry_date"),
            "duration_min": e.get("sleep_duration_minutes"),
            "cycles":       e.get("sleep_cycles"),
            "latency_min":  e.get("sleep_latency_minutes"),
            "inertia":      e.get("inertia_score"),
            "energy":       e.get("energy_score"),
            "stress":       e.get("stress_score"),
            "miles":        e.get("miles_walked"),
            "caffeine_cut": e.get("caffeine_cutoff_time"),
            "nap":          e.get("naps"),
            "tags":         e.get("tags"),
        })

    return f"""Analyze this personal sleep dataset ({len(entries)} entries).

DATASET:
{json.dumps(compact, indent=2, default=str)}

Return ONLY this JSON:
{{
  "executive_summary": [
    "Finding 1 with specific numbers",
    "Finding 2 with specific numbers",
    "Finding 3 with specific numbers",
    "Finding 4 with specific numbers",
    "Finding 5 with specific numbers"
  ],
  "optimal_caffeine_cutoff": "HH:MM",
  "optimal_sleep_duration_minutes": 450,
  "optimal_cycle_count": 5.0,
  "best_performing_tags": [],
  "worst_performing_tags": [],
  "weekly_trend": "improving",
  "top_recommendations": [
    {{"category": "CAFFEINE",      "action": "specific action", "expected_impact": "description"}},
    {{"category": "WALKING",       "action": "specific action", "expected_impact": "description"}},
    {{"category": "SLEEP TIMING",  "action": "specific action", "expected_impact": "description"}},
    {{"category": "STRESS",        "action": "specific action", "expected_impact": "description"}},
    {{"category": "RECOVERY",      "action": "specific action", "expected_impact": "description"}}
  ],
  "watch_list": ["concern 1", "concern 2"],
  "data_quality_notes": "Brief note on sample size or gaps.",
  "caffeine_inertia_correlation": "Text describing the relationship found.",
  "miles_energy_correlation": "Text describing the relationship found.",
  "best_cycle_count_for_wakeup": "Text describing which cycle count yields best inertia."
}}

Analysis requirements:
- Bucket caffeine cutoffs: before 13:00 / 13:00-15:00 / 15:00-17:00 / after 17:00. Compare avg next-day inertia.
- Bucket miles: 0-2 / 2-4 / 4-6 / 6+. Compare avg next-day energy.
- Group cycles by 0.5 increments. Find which count yields highest inertia.
- weekly_trend: "improving", "declining", or "stable" based on last 7 vs prior 7 days avg scores.
- Only flag tags with n >= 3 occurrences.
- Be specific — include actual averages and numbers where possible."""


def _validate_monthly_analysis(data: dict) -> dict:
    """Ensure all expected fields exist with correct types; fill safe defaults."""
    out = dict(data)
    for key in ("executive_summary", "top_recommendations", "watch_list",
                "best_performing_tags", "worst_performing_tags"):
        if not isinstance(out.get(key), list):
            out[key] = []
    for key in ("weekly_trend", "data_quality_notes", "optimal_caffeine_cutoff",
                "caffeine_inertia_correlation", "miles_energy_correlation",
                "best_cycle_count_for_wakeup"):
        if not isinstance(out.get(key), str):
            out[key] = out.get(key, "") or ""
    for key in ("optimal_sleep_duration_minutes", "optimal_cycle_count"):
        if not isinstance(out.get(key), (int, float)):
            out[key] = None
    return out


def get_monthly_analysis(entries: list) -> dict:
    """Call Groq with full dataset and return parsed monthly analysis."""
    if not entries:
        return {"error": "No entries to analyze."}

    prompt = _build_monthly_prompt(entries)
    client = _get_client()

    resp = _call_with_retry(lambda: client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "system", "content": MONTHLY_SYSTEM},
            {"role": "user",   "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
        max_tokens=1800,
    ))

    raw = resp.choices[0].message.content
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        import re
        cleaned = re.sub(r"```(?:json)?|```", "", raw).strip()
        parsed = json.loads(cleaned)
    return _validate_monthly_analysis(parsed)
