import React, { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesBetween(start, end) {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === null || e === null) return null;
  if (e >= s) return e - s;
  return 1440 - s + e; // midnight wrap
}

function fmtDuration(mins) {
  if (mins === null || mins === undefined) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreSlider({ name, label, minLabel, maxLabel, value, onChange, description }) {
  const pct = ((value - 1) / 9) * 100;
  const color =
    pct >= 70 ? "var(--success)" : pct >= 40 ? "var(--warning)" : "var(--danger)";

  return (
    <div className="slider-wrapper">
      <div className="slider-header">
        <span className="slider-label">{label}</span>
        <span className="slider-value" style={{ color }}>{value}</span>
      </div>
      {description && <div className="slider-desc">{description}</div>}
      <input
        type="range"
        min="1"
        max="10"
        step="1"
        name={name}
        value={value}
        aria-label={label}
        aria-valuetext={`${value} out of 10 — ${pct >= 70 ? maxLabel : pct >= 40 ? "moderate" : minLabel}`}
        onChange={(e) => onChange(name, parseInt(e.target.value, 10))}
        style={{
          background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`,
        }}
      />
      <div className="slider-scale">
        <span>1 — {minLabel}</span>
        <span>{maxLabel} — 10</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default form state
// ---------------------------------------------------------------------------

function makeDefault(prefillDate) {
  return {
    entry_date: prefillDate || todayISO(),
    bed_time: "",
    sleep_time: "",
    wake_time: "",
    out_of_bed_time: "",
    inertia_score: 5,
    energy_score: 5,
    stress_score: 5,
    miles_walked: "",
    caffeine_cutoff_time: "",
    caffeine_mg: "",
    naps: false,
    nap_duration_minutes: "",
    ankle_notes: "",
    tags: "",
    notes: "",
  };
}

// ---------------------------------------------------------------------------
// EntryForm
// ---------------------------------------------------------------------------

export default function EntryForm({
  onSuccess,
  onNavigateHistory,
  initialData  = null,
  entryId      = null,
  onCancel     = null,
  prefillDate  = null,
  onDirty      = null,
}) {
  const isEdit = !!entryId;
  const [form, setForm] = useState(() => {
    if (initialData) {
      return {
        ...makeDefault(null),
        ...initialData,
        miles_walked: initialData.miles_walked ?? "",
        caffeine_cutoff_time: initialData.caffeine_cutoff_time ?? "",
        caffeine_mg: initialData.caffeine_mg ?? "",
        nap_duration_minutes: initialData.nap_duration_minutes ?? "",
        ankle_notes: initialData.ankle_notes ?? "",
        tags: initialData.tags ?? "",
        notes: initialData.notes ?? "",
      };
    }
    return makeDefault(prefillDate);
  });

  const [status, setStatus] = useState(null); // { type: 'success'|'error', msg }
  const [loading, setLoading] = useState(false);
  const [timeWarnings, setTimeWarnings] = useState({});

  // Recalculate time warnings whenever relevant fields change
  useEffect(() => {
    const w = {};
    const { bed_time, sleep_time, wake_time, out_of_bed_time } = form;

    if (bed_time && sleep_time) {
      const latency = minutesBetween(bed_time, sleep_time);
      if (latency > 240) {
        w.sleep_time = "Sleep latency exceeds 4 hours — check times.";
      }
    }

    if (sleep_time && wake_time) {
      const dur = minutesBetween(sleep_time, wake_time);
      if (dur !== null && dur <= 0) {
        w.wake_time = "Wake time must be after sleep time.";
      } else if (dur > 960) {
        w.wake_time = "Sleep duration over 16 hours — check times.";
      }
    }

    if (wake_time && out_of_bed_time) {
      const oob = minutesBetween(wake_time, out_of_bed_time);
      if (oob !== null && oob > 240) {
        w.out_of_bed_time = "Out-of-bed time should be within 4 hours of waking.";
      }
    }

    setTimeWarnings(w);
  }, [form.bed_time, form.sleep_time, form.wake_time, form.out_of_bed_time]);

  // Computed previews
  const duration = minutesBetween(form.sleep_time, form.wake_time);
  const napMinutes = form.naps && form.nap_duration_minutes ? parseInt(form.nap_duration_minutes, 10) : 0;
  const cycles = duration !== null ? ((duration + (isNaN(napMinutes) ? 0 : napMinutes)) / 90).toFixed(1) : null;
  const latency = minutesBetween(form.bed_time, form.sleep_time);
  const hasTimeError = Object.keys(timeWarnings).length > 0;

  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
    onDirty?.();
  }, [onDirty]);

  const handleScoreChange = useCallback((name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    onDirty?.();
  }, [onDirty]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (hasTimeError) {
      setStatus({ type: "error", msg: "Please fix the time validation errors before saving." });
      return;
    }

    setLoading(true);
    setStatus(null);

    const payload = {
      ...form,
      miles_walked: form.miles_walked === "" ? null : parseFloat(form.miles_walked),
      nap_duration_minutes:
        form.nap_duration_minutes === "" ? null : parseInt(form.nap_duration_minutes, 10),
      caffeine_cutoff_time: form.caffeine_cutoff_time || null,
      caffeine_mg: form.caffeine_mg === "" ? null : parseInt(form.caffeine_mg, 10),
      ankle_notes: form.ankle_notes || null,
      tags: form.tags || null,
      notes: form.notes || null,
    };

    try {
      const url = isEdit ? `/api/entries/${entryId}` : "/api/entries";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok) {
        setStatus({ type: "error", msg: json.error || "Server error. Please try again." });
      } else {
        setStatus({
          type: "success",
          msg: isEdit
            ? `Entry for ${json.entry_date} updated successfully.`
            : `Entry for ${json.entry_date} logged successfully.`,
        });
        if (!isEdit) {
          setForm(makeDefault());
        }
        if (onSuccess) onSuccess(json);
      }
    } catch (err) {
      setStatus({ type: "error", msg: `Network error: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* ----------------------------------------------------------------
          Section 0 — Date
      ---------------------------------------------------------------- */}
      <div className="card section">
        <div className="card-header">
          <span className="card-title">
            {isEdit ? "Edit Entry" : "New Sleep Entry"}
          </span>
          {isEdit && (
            <span className="text-muted text-xs text-mono">ID #{entryId}</span>
          )}
        </div>

        <div style={{ maxWidth: 260 }}>
          <div className="form-group">
            <label className="form-label" htmlFor="entry_date">Entry Date</label>
            <input
              className="form-input"
              id="entry_date"
              name="entry_date"
              type="date"
              value={form.entry_date}
              onChange={handleChange}
              required
              style={{ colorScheme: "dark" }}
            />
            <span className="form-hint">Defaults to today. Change for backfilling.</span>
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------------
          Section 1 — Sleep Times
      ---------------------------------------------------------------- */}
      <div className="card section">
        <div className="card-header">
          <span className="card-title-accent">01 /</span>&nbsp;
          <span className="card-title">Sleep Times</span>
        </div>

        <div className="grid-2">
          {[
            { name: "bed_time",       label: "Bed Time",       hint: "When you got into bed" },
            { name: "sleep_time",     label: "Fell Asleep",    hint: "Estimated time you fell asleep" },
            { name: "wake_time",      label: "Wake Time",      hint: "When you woke up" },
            { name: "out_of_bed_time",label: "Out of Bed",     hint: "When you actually got up" },
          ].map(({ name, label, hint }) => (
            <div className="form-group" key={name}>
              <label className="form-label" htmlFor={name}>{label}</label>
              <input
                className={`form-input${timeWarnings[name] ? " error" : ""}`}
                id={name}
                name={name}
                type="time"
                value={form[name]}
                onChange={handleChange}
                required
              />
              {timeWarnings[name] ? (
                <span className="field-error">{timeWarnings[name]}</span>
              ) : (
                <span className="form-hint">{hint}</span>
              )}
            </div>
          ))}
        </div>

        {/* Live preview */}
        <div className="preview-row" style={{ marginTop: "1rem" }}>
          {duration !== null && !timeWarnings.wake_time && (
            <span className="preview-pill">
              Duration: {fmtDuration(duration)} ({cycles} cycles)
            </span>
          )}
          {latency !== null && !timeWarnings.sleep_time && (
            <span className={`preview-pill${latency > 60 ? " warn" : ""}`}>
              Latency: {latency} min
            </span>
          )}
          {hasTimeError && (
            <span className="preview-pill error">Fix time errors above</span>
          )}
          {!form.bed_time && !form.sleep_time && (
            <span className="preview-pill" style={{ opacity: 0.5 }}>
              Enter times to see live preview
            </span>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------------
          Section 2 — Subjective Scores
      ---------------------------------------------------------------- */}
      <div className="card section">
        <div className="card-header">
          <span className="card-title-accent">02 /</span>&nbsp;
          <span className="card-title">Today's Scores</span>
        </div>

        <div className="grid-2">
          <ScoreSlider
            name="inertia_score"
            label="Sleep Inertia"
            minLabel="Barely functional"
            maxLabel="Jumped out of bed"
            value={form.inertia_score}
            onChange={handleScoreChange}
            description="How alert did you feel immediately after waking?"
          />
          <ScoreSlider
            name="energy_score"
            label="Energy Level"
            minLabel="Depleted"
            maxLabel="Fully charged"
            value={form.energy_score}
            onChange={handleScoreChange}
            description="Overall energy throughout the day"
          />
          <ScoreSlider
            name="stress_score"
            label="Daily Stress"
            minLabel="Zen"
            maxLabel="High stress"
            value={form.stress_score}
            onChange={handleScoreChange}
            description="Overall perceived stress for the day"
          />
        </div>
      </div>

      {/* ----------------------------------------------------------------
          Section 3 — Activity & Context
      ---------------------------------------------------------------- */}
      <div className="card section">
        <div className="card-header">
          <span className="card-title-accent">03 /</span>&nbsp;
          <span className="card-title">Activity &amp; Context</span>
        </div>

        <div className="grid-2" style={{ marginBottom: "1rem" }}>
          <div className="form-group">
            <label className="form-label" htmlFor="miles_walked">Miles Walked</label>
            <input
              className="form-input"
              id="miles_walked"
              name="miles_walked"
              type="number"
              min="0"
              max="50"
              step="0.1"
              placeholder="0.0"
              value={form.miles_walked}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="caffeine_cutoff_time">
              Caffeine Cutoff
            </label>
            <input
              className="form-input"
              id="caffeine_cutoff_time"
              name="caffeine_cutoff_time"
              type="time"
              value={form.caffeine_cutoff_time}
              onChange={handleChange}
              style={{ colorScheme: "dark" }}
            />
            <span className="form-hint">Leave blank if no caffeine today</span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="caffeine_mg">
              Caffeine (mg)
            </label>
            <input
              className="form-input"
              id="caffeine_mg"
              name="caffeine_mg"
              type="number"
              min="0"
              max="2000"
              step="5"
              placeholder="e.g. 200"
              value={form.caffeine_mg}
              onChange={handleChange}
            />
            <span className="form-hint">
              Coffee ~95mg · Espresso ~63mg · Energy drink ~80–150mg
            </span>
          </div>
        </div>

        {/* Nap toggle */}
        <div style={{ marginBottom: "1rem" }}>
          <label className="toggle-row">
            <input
              type="checkbox"
              name="naps"
              checked={form.naps}
              onChange={handleChange}
            />
            <span className="toggle-label">I took a nap today</span>
          </label>

          {form.naps && (
            <div className="form-group" style={{ marginTop: "0.75rem", maxWidth: 260 }}>
              <label className="form-label" htmlFor="nap_duration_minutes">
                Nap Duration (minutes)
              </label>
              <input
                className="form-input"
                id="nap_duration_minutes"
                name="nap_duration_minutes"
                type="number"
                min="1"
                max="480"
                step="1"
                placeholder="e.g. 20"
                value={form.nap_duration_minutes}
                onChange={handleChange}
              />
            </div>
          )}
        </div>

        {/* Ankle notes — optional, only when relevant */}
        <div style={{ marginBottom: "1rem" }}>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={!!form.ankle_notes}
              onChange={(e) => {
                if (!e.target.checked) setForm((prev) => ({ ...prev, ankle_notes: "" }));
                else setForm((prev) => ({ ...prev, ankle_notes: prev.ankle_notes || " " }));
              }}
            />
            <span className="toggle-label" style={{ color: "var(--text-muted)" }}>
              Any ankle issues today?
            </span>
          </label>
          {!!form.ankle_notes && (
            <div className="form-group" style={{ marginTop: "0.75rem" }}>
              <textarea
                className="form-textarea"
                name="ankle_notes"
                placeholder="Describe pain, stiffness, swelling, or anything notable about your ankle today..."
                value={form.ankle_notes.trim() === "" ? "" : form.ankle_notes}
                onChange={handleChange}
              />
            </div>
          )}
        </div>

        <div className="form-group" style={{ marginBottom: "1rem" }}>
          <label className="form-label" htmlFor="tags">Tags</label>
          <input
            className="form-input"
            id="tags"
            name="tags"
            type="text"
            placeholder="#weed #cervicalpillow #highstress_shift"
            value={form.tags}
            onChange={handleChange}
          />
          <span className="form-hint">Space or comma separated hashtags</span>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="notes">Notes</label>
          <textarea
            className="form-textarea"
            id="notes"
            name="notes"
            placeholder="Anything notable about today's sleep or day..."
            value={form.notes}
            onChange={handleChange}
          />
        </div>
      </div>

      {/* ----------------------------------------------------------------
          Submit
      ---------------------------------------------------------------- */}
      {status && (
        <div className={`alert alert-${status.type}`}>
          {status.type === "success" ? "✓" : "✗"} {status.msg}
          {status.type === "success" && !isEdit && onNavigateHistory && (
            <button
              type="button"
              onClick={onNavigateHistory}
              style={{
                background: "none",
                border: "none",
                color: "var(--success)",
                cursor: "pointer",
                marginLeft: "0.75rem",
                fontSize: "0.85rem",
                textDecoration: "underline",
                fontFamily: "inherit",
              }}
            >
              View in History →
            </button>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          marginTop: "1.25rem",
          flexWrap: "wrap",
        }}
      >
        <button
          type="submit"
          className="btn btn-primary btn-lg"
          disabled={loading || hasTimeError}
          style={{ flex: 1, minWidth: 200 }}
        >
          {loading ? (
            <><span className="spinner" style={{ width: 16, height: 16 }} /> Saving…</>
          ) : isEdit ? (
            "Update Entry"
          ) : (
            "Log Sleep Entry"
          )}
        </button>

        {isEdit && onCancel && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
