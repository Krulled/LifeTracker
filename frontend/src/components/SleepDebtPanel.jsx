import React, { useEffect, useState, useCallback } from "react";

const POLL_INTERVAL = 30000; // 30 s — debt doesn't change by the second

const DEFAULT_OPTIMAL = 480; // 8 hours

function fmtMins(m) {
  if (m == null) return "—";
  const h = Math.floor(Math.abs(m) / 60);
  const min = Math.abs(m) % 60;
  const sign = m < 0 ? "-" : "";
  return h > 0 ? `${sign}${h}h ${min}m` : `${sign}${min}m`;
}

function debtColor(minutes) {
  if (minutes <= 0)   return "var(--success)";
  if (minutes <= 60)  return "var(--warning)";
  return "var(--danger)";
}

function trendIcon(trend) {
  if (trend === "improving")         return { icon: "↓", color: "var(--success)", label: "Improving" };
  if (trend === "worsening")         return { icon: "↑", color: "var(--danger)",  label: "Worsening" };
  if (trend === "stable")            return { icon: "→", color: "var(--warning)", label: "Stable" };
  return { icon: "?", color: "var(--text-dim)", label: "Not enough data" };
}

// ── Mini bar chart for 14-day history ────────────────────────────────────────
function DebtHistoryBars({ history, optimal }) {
  if (!history?.length) return null;
  const maxDebt = Math.max(...history.map(d => Math.abs(d.debt_minutes)), 1);

  return (
    <div>
      <div className="brief-section-title" style={{ marginBottom: "0.6rem" }}>
        14-Day Sleep vs Optimal
      </div>
      <div className="debt-bars-wrapper">
        {history.map((d) => {
          const isDeficit  = d.debt_minutes > 0;
          const pct        = Math.min(Math.abs(d.debt_minutes) / maxDebt * 100, 100);
          const barColor   = isDeficit
            ? (d.debt_minutes > 90 ? "var(--danger)" : "var(--warning)")
            : "var(--success)";
          const dateLabel  = d.date.slice(5); // MM-DD

          return (
            <div key={d.date} className="debt-bar-col" title={`${d.date}: ${fmtMins(d.actual_minutes)} sleep · ${isDeficit ? "deficit" : "surplus"} ${fmtMins(Math.abs(d.debt_minutes))}`}>
              <div className="debt-bar-track">
                <div
                  className="debt-bar-fill"
                  style={{ height: `${pct}%`, background: barColor }}
                />
              </div>
              <span className="debt-bar-label">{dateLabel}</span>
            </div>
          );
        })}
      </div>
      <div className="debt-bar-legend">
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "var(--success)", marginRight: 4 }} />Surplus</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "var(--warning)", marginRight: 4 }} />&lt;90 min deficit</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "var(--danger)",  marginRight: 4 }} />&gt;90 min deficit</span>
      </div>
    </div>
  );
}

// ── Bedtime recommendation table ─────────────────────────────────────────────
function BedtimeTable({ options, targetWake, avgLatency }) {
  if (!options?.length) return null;

  return (
    <div>
      <div className="brief-section-title" style={{ marginBottom: "0.6rem" }}>
        Bedtime Calculator
        <span style={{ fontWeight: 400, color: "var(--text-dim)", marginLeft: "0.5rem", fontSize: "0.68rem" }}>
          wake {targetWake} · avg latency {avgLatency}min
        </span>
      </div>
      <div className="bedtime-table">
        <div className="bedtime-header">
          <span>Cycles</span>
          <span>Bedtime</span>
          <span>Sleep</span>
          <span>Est. REM</span>
          <span>Debt Impact</span>
        </div>
        {options.map((o) => (
          <div
            key={o.cycles}
            className={`bedtime-row${o.is_optimal ? " optimal" : ""}`}
          >
            <span className="bedtime-cycles">
              {o.cycles}
              {o.is_optimal && <span className="optimal-badge">recommended</span>}
            </span>
            <span className="bedtime-time">{o.bedtime}</span>
            <span>{o.sleep_duration_label}</span>
            <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
              ~{o.estimated_rem_minutes}m
            </span>
            <span style={{ color: debtColor(o.debt_impact_minutes), fontFamily: "var(--font-mono)" }}>
              {o.debt_impact_minutes > 0
                ? `+${fmtMins(o.debt_impact_minutes)} deficit`
                : o.debt_impact_minutes < 0
                  ? `~${fmtMins(Math.abs(o.actual_debt_change_minutes))} cleared`
                  : "neutral"}
            </span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: "0.5rem", lineHeight: 1.5 }}>
        Research: 5 cycles (7.5h) is optimal for most adults. Waking at a cycle boundary minimises inertia.
        Debt clears in two ways: surplus nights actively pay it down (~50% efficiency), and deficit nights
        automatically expire from the 7-day window — consistent surplus sleep clears all tracked debt within 7 nights.
      </div>
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────
export default function SleepDebtPanel({ refreshKey }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [optimal, setOptimal] = useState(
    () => parseInt(localStorage.getItem("sleeptracker_optimal") || DEFAULT_OPTIMAL, 10)
  );
  const [editingOptimal, setEditingOptimal] = useState(false);
  const [draftOptimal,   setDraftOptimal]   = useState(optimal);

  const fetchDebt = useCallback(() => {
    fetch(`/api/sleep-debt?optimal=${optimal}`)
      .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
      .then(({ ok, body }) => {
        if (!ok) throw new Error(body.error || "Failed to load");
        setData(body);
        setLoading(false);
        setError(null);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [optimal]);

  useEffect(() => { setLoading(true); fetchDebt(); }, [refreshKey, fetchDebt]);
  useEffect(() => {
    const id = setInterval(fetchDebt, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchDebt]);

  function saveOptimal() {
    const v = Math.max(240, Math.min(720, parseInt(draftOptimal, 10) || DEFAULT_OPTIMAL));
    setOptimal(v);
    setDraftOptimal(v);
    localStorage.setItem("sleeptracker_optimal", v);
    setEditingOptimal(false);
  }

  if (loading) return (
    <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
      <span className="spinner" />
    </div>
  );

  if (error) return (
    <div className="alert alert-error">{error}</div>
  );

  if (!data) return null;

  const trend    = trendIcon(data.debt_trend);
  const optHours = (optimal / 60).toFixed(1);

  return (
    <div className="card debt-panel">
      {/* ── Header ── */}
      <div className="card-header" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span className="card-title-accent">💤</span>&nbsp;
          <span className="card-title">Sleep Debt & REM Tracker</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {editingOptimal ? (
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <input
                type="number"
                min="240" max="720" step="30"
                value={draftOptimal}
                onChange={e => setDraftOptimal(e.target.value)}
                style={{ width: 70, background: "var(--bg-input)", border: "1px solid var(--accent)", borderRadius: 4, color: "var(--text-primary)", padding: "0.2rem 0.4rem", fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}
              />
              <span style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>min</span>
              <button className="btn btn-primary" style={{ padding: "0.2rem 0.6rem", fontSize: "0.78rem" }} onClick={saveOptimal}>Save</button>
              <button className="btn btn-ghost"   style={{ padding: "0.2rem 0.6rem", fontSize: "0.78rem" }} onClick={() => setEditingOptimal(false)}>Cancel</button>
            </div>
          ) : (
            <button
              className="btn btn-ghost"
              style={{ fontSize: "0.72rem", padding: "0.25rem 0.7rem" }}
              onClick={() => { setDraftOptimal(optimal); setEditingOptimal(true); }}
            >
              Optimal: {optHours}h
            </button>
          )}
        </div>
      </div>

      {/* ── Top stat row ── */}
      <div className="debt-stat-row">
        <div className="debt-stat-card">
          <div className="debt-stat-label">7-Day Debt</div>
          <div className="debt-stat-value" style={{ color: debtColor(data.rolling_7d_debt_minutes) }}>
            {fmtMins(data.rolling_7d_debt_minutes)}
          </div>
          <div className="debt-stat-sub">rolling window</div>
        </div>

        <div className="debt-stat-card">
          <div className="debt-stat-label">14-Day Debt</div>
          <div className="debt-stat-value" style={{ color: debtColor(data.rolling_14d_debt_minutes) }}>
            {fmtMins(data.rolling_14d_debt_minutes)}
          </div>
          <div className="debt-stat-sub">rolling window</div>
        </div>

        <div className="debt-stat-card">
          <div className="debt-stat-label">Trend</div>
          <div className="debt-stat-value" style={{ color: trend.color }}>
            {trend.icon} {trend.label}
          </div>
          <div className="debt-stat-sub">last 3 vs prior 3 nights</div>
        </div>

        <div className="debt-stat-card">
          <div className="debt-stat-label">Recovery ETA</div>
          <div className="debt-stat-value" style={{ color: data.recovery_eta_days === 0 ? "var(--success)" : "var(--warning)" }}>
            {data.recovery_eta_days === 0 ? "No debt" : `~${data.recovery_eta_days}d`}
          </div>
          <div className="debt-stat-sub">
            {data.recovery_basis_cycles
              ? `${data.recovery_basis_cycles} cycles · old deficits expire after 7d`
              : "deficit nights expire after 7d"}
          </div>
        </div>

        <div className="debt-stat-card">
          <div className="debt-stat-label">Last Night</div>
          <div className="debt-stat-value" style={{ color: debtColor(data.last_night_debt_minutes) }}>
            {data.last_night_debt_minutes > 0
              ? `-${fmtMins(data.last_night_debt_minutes)}`
              : data.last_night_debt_minutes < 0
                ? `+${fmtMins(Math.abs(data.last_night_debt_minutes))} surplus`
                : "Exact"}
          </div>
          <div className="debt-stat-sub">{fmtMins(data.last_night_actual_minutes)} slept</div>
        </div>

        <div className="debt-stat-card">
          <div className="debt-stat-label">Est. REM Last Night</div>
          <div className="debt-stat-value" style={{ color: "var(--accent)" }}>
            ~{data.last_night_rem_minutes}m
          </div>
          <div className="debt-stat-sub">{data.last_night_rem_pct}% of sleep · avg {data.avg_rem_per_night_minutes}m</div>
        </div>
      </div>

      {/* ── REM science note ── */}
      <div className="debt-science-note">
        <strong>REM distribution:</strong> Cycle 1 ≈5 min · Cycle 2 ≈13 min · Cycle 3 ≈20 min · Cycle 4 ≈28 min · Cycle 5 ≈38 min · Cycle 6 ≈45 min.
        Cutting sleep short disproportionately loses REM from the end — your most cognitively valuable sleep.
        {data.rem_deficit_last_night > 0 && (
          <span style={{ color: "var(--warning)", marginLeft: "0.5rem" }}>
            Last night was ~{data.rem_deficit_last_night}m short of your REM target.
          </span>
        )}
      </div>

      <hr className="divider" />

      {/* ── Bedtime table ── */}
      <BedtimeTable
        options={data.bedtime_recommendations}
        targetWake={data.target_wake_time}
        avgLatency={data.avg_sleep_latency_minutes}
      />

      <hr className="divider" />

      {/* ── 14-day bars ── */}
      <DebtHistoryBars history={data.daily_history} optimal={optimal} />
    </div>
  );
}
