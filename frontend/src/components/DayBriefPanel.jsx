import React, { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDuration(mins) {
  if (mins == null) return "—";
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function scoreColor(val, invert = false) {
  if (val == null) return "var(--text-dim)";
  const hi = invert ? val <= 3 : val >= 7;
  const lo = invert ? val >= 7 : val <= 3;
  if (hi) return "var(--success)";
  if (lo) return "var(--danger)";
  return "var(--warning)";
}

function StatPill({ label, value, color }) {
  return (
    <div className="brief-stat">
      <span className="brief-stat-label">{label}</span>
      <span className="brief-stat-value" style={{ color: color || "var(--text-primary)" }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / prompt states
// ---------------------------------------------------------------------------

function EmptyPrompt() {
  return (
    <div className="brief-panel card">
      <div className="brief-empty-center">
        <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>📅</div>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
          Click any logged day to see your sleep brief.
        </p>
        <p style={{ color: "var(--text-dim)", fontSize: "0.78rem", marginTop: "0.35rem" }}>
          Unlogged days will prompt you to add an entry.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DayBriefPanel({ date, entry, onLogDay }) {
  const [brief,   setBrief]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const _td = new Date();
  const today  = `${_td.getFullYear()}-${String(_td.getMonth()+1).padStart(2,"0")}-${String(_td.getDate()).padStart(2,"0")}`;
  const isToday  = date === today;
  const isFuture = date > today;

  // Fetch AI brief whenever the selected entry changes
  useEffect(() => {
    if (!entry || !date) {
      setBrief(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setBrief(null);
    setError(null);
    setLoading(true);

    fetch(`/api/ai/daily-brief/${date}`)
      .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) throw new Error(body.error || "Unknown error");
        setBrief(body);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [date, entry]);

  // ── No date selected ──────────────────────────────────────────────────────
  if (!date) return <EmptyPrompt />;

  // ── Future date ───────────────────────────────────────────────────────────
  if (isFuture) {
    return (
      <div className="brief-panel card">
        <div className="brief-date-row">
          <span className="brief-date">{date}</span>
          <span className="brief-badge future-badge">Future</span>
        </div>
        <div className="brief-empty-center" style={{ marginTop: "1rem" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
            No data yet for this date.
          </p>
        </div>
      </div>
    );
  }

  // ── Unlogged day ──────────────────────────────────────────────────────────
  if (!entry) {
    return (
      <div className="brief-panel card">
        <div className="brief-date-row">
          <span className="brief-date">{date}</span>
          {isToday && <span className="brief-badge today-badge">Today</span>}
        </div>
        <div className="brief-empty-center" style={{ marginTop: "1rem" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" }}>
            No entry logged for this day.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => onLogDay(date)}
          >
            Log Entry for {date} →
          </button>
        </div>
      </div>
    );
  }

  // ── Logged day ────────────────────────────────────────────────────────────
  return (
    <div className="brief-panel card">
      {/* Header */}
      <div className="brief-date-row">
        <span className="brief-date">{date}</span>
        {isToday && <span className="brief-badge today-badge">Today</span>}
        {brief?.recovery_mode && (
          <span className="brief-badge recovery-badge">⚠ Recovery Mode</span>
        )}
        {brief?.cached && (
          <span className="brief-badge cached-badge" title={`Generated ${brief.generated_at}`}>
            cached
          </span>
        )}
      </div>

      {/* Sleep stats row */}
      <div className="brief-stats-row">
        <StatPill label="Duration"  value={fmtDuration(entry.sleep_duration_minutes)} />
        <StatPill label="Cycles"    value={entry.sleep_cycles}   color="var(--accent)" />
        <StatPill label="Latency"   value={entry.sleep_latency_minutes != null ? `${entry.sleep_latency_minutes}m` : "—"} />
        <StatPill label="Inertia"   value={`${entry.inertia_score}/10`}  color={scoreColor(entry.inertia_score)} />
        <StatPill label="Energy"    value={`${entry.energy_score}/10`}   color={scoreColor(entry.energy_score)} />
        <StatPill label="Stress"    value={`${entry.stress_score}/10`}   color={scoreColor(entry.stress_score, true)} />
      </div>

      {/* Ankle notes badge (if present) */}
      {entry.ankle_notes && (
        <div className="brief-ankle-note">
          🦶 <strong>Ankle:</strong> {entry.ankle_notes}
        </div>
      )}

      {/* Tags row */}
      {entry.tags && (
        <div className="brief-tags-row">
          {entry.tags.split(/[\s,]+/).filter(Boolean).map(t => (
            <span key={t} className="tag-chip">{t}</span>
          ))}
        </div>
      )}

      {/* ── AI Brief ── */}
      {loading && (
        <div className="brief-loading">
          <span className="spinner" />
          <span>Generating AI brief via Groq…</span>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginTop: "1rem" }}>
          ✗ {error}
        </div>
      )}

      {brief && !loading && (
        <>
          {/* Sleep summary */}
          {brief.sleep_quality_summary && (
            <div className="brief-summary">{brief.sleep_quality_summary}</div>
          )}

          {/* Energy forecast */}
          {brief.energy_forecast && (
            <div className="brief-forecast">"{brief.energy_forecast}"</div>
          )}

          {/* Caffeine cutoff */}
          <div className="brief-section">
            <div className="brief-section-title">☕ Caffeine Cutoff</div>
            <div className="brief-caffeine-row">
              <span className="brief-cutoff-time">{brief.caffeine_cutoff_recommendation}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flex: 1, minWidth: 120 }}>
                {brief.caffeine_reasoning && (
                  <span className="brief-cutoff-reason">{brief.caffeine_reasoning}</span>
                )}
                {brief.caffeine_mg_context && (
                  <span className="brief-cutoff-reason" style={{ color: "var(--text-dim)", fontSize: "0.78rem" }}>
                    {brief.caffeine_mg_context}
                  </span>
                )}
              </div>
            </div>
            {entry.caffeine_mg && (
              <div style={{ marginTop: "0.4rem", fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: "var(--text-dim)" }}>
                Today logged: <span style={{ color: "var(--warning)", fontWeight: 700 }}>{entry.caffeine_mg}mg</span>
              </div>
            )}
          </div>

          {/* Productivity blueprint */}
          {brief.productivity_steps?.length > 0 && (
            <div className="brief-section">
              <div className="brief-section-title">📋 Today's Blueprint</div>
              <ol className="brief-steps">
                {brief.productivity_steps.map((step, i) => (
                  <li key={i} className="brief-step">{step}</li>
                ))}
              </ol>
            </div>
          )}

          {/* Pattern flags */}
          {brief.pattern_flags?.length > 0 && (
            <div className="brief-section">
              <div className="brief-section-title">🚩 Pattern Flags</div>
              <div className="brief-flags">
                {brief.pattern_flags.map((flag, i) => (
                  <div key={i} className="brief-flag">{flag}</div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
