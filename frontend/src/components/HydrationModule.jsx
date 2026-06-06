import React, { useState, useEffect, useCallback } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";

function localDateISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function offsetDate(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// SVG progress ring
function WaterRing({ pct }) {
  const r   = 60;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(1, pct) * circ;
  const color = pct >= 1 ? "#00d4aa" : pct >= 0.5 ? "#60a5fa" : "#f59e0b";

  return (
    <svg width="160" height="160" viewBox="0 0 160 160" style={{ transform:"rotate(-90deg)" }}>
      <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" />
      <circle
        cx="80" cy="80" r={r} fill="none"
        stroke={color} strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        style={{ transition: "stroke-dasharray 0.4s ease, stroke 0.4s ease" }}
      />
    </svg>
  );
}

export default function HydrationModule({ onBack }) {
  const today = localDateISO();

  const [selectedDate, setSelectedDate] = useState(today);
  const [glasses,  setGlasses]  = useState(0);
  const [goal,     setGoal]     = useState(8);
  const [history,  setHistory]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [editGoal, setEditGoal] = useState(false);
  const [goalDraft,setGoalDraft]= useState("8");

  const fetchSelected = useCallback(async () => {
    const r = await fetch(`/api/hydration?date=${selectedDate}`);
    const d = await r.json();
    setGlasses(d.glasses ?? 0);
    setGoal(d.goal ?? 8);
    setGoalDraft(String(d.goal ?? 8));
  }, [selectedDate]);

  const fetchHistory = useCallback(async () => {
    const r = await fetch(`/api/hydration/history?days=7&date=${selectedDate}`);
    setHistory(await r.json());
  }, [selectedDate]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchSelected(), fetchHistory()]).finally(() => setLoading(false));
  }, [fetchSelected, fetchHistory]);

  async function saveGlasses(val) {
    const newVal = Math.max(0, Math.min(val, goal * 2));
    setGlasses(newVal);
    setSaving(true);
    await fetch("/api/hydration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ log_date: selectedDate, glasses: newVal, goal }),
    });
    setSaving(false);
    fetchHistory();
  }

  async function saveGoal() {
    const g = Math.max(1, parseInt(goalDraft, 10) || 8);
    setGoal(g); setGoalDraft(String(g)); setEditGoal(false);
    setSaving(true);
    await fetch("/api/hydration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ log_date: selectedDate, glasses, goal: g }),
    });
    setSaving(false);
    fetchHistory();
  }

  function prevDay() { setSelectedDate(d => offsetDate(d, -1)); }
  function nextDay() { setSelectedDate(d => offsetDate(d, 1)); }
  function goToday() { setSelectedDate(today); }

  const isToday   = selectedDate === today;
  const dateLabel = isToday
    ? "Today"
    : new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });

  const pct    = goal > 0 ? glasses / goal : 0;
  const ozLeft = Math.max(0, (goal - glasses) * 8);
  const statusMsg = pct >= 1 ? "Goal reached! 🎉" : pct >= 0.75 ? "Almost there!" : pct >= 0.5 ? "Halfway there" : "Keep drinking!";
  const ringColor = pct >= 1 ? "#00d4aa" : pct >= 0.5 ? "#60a5fa" : "#f59e0b";

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <button className="back-btn" onClick={onBack}>← Hub</button>
          <div className="brand">
            <span className="brand-icon">💧</span>
            <div>
              <div className="brand-name">Hydration</div>
              <div className="brand-sub">WATER TRACKER · {glasses}/{goal} glasses {isToday ? "today" : "that day"}</div>
            </div>
          </div>
        </div>
        {saving && <span style={{ fontSize:"0.72rem", color:"var(--text-dim)" }}>Saving…</span>}
      </header>

      <main style={{ maxWidth:800, margin:"0 auto", padding:"1.25rem 1.5rem" }}>
        {/* Date navigation */}
        <div className="hyd-date-nav">
          <button className="hyd-date-nav-btn" onClick={prevDay}>← Prev</button>
          <div className="hyd-date-nav-center">
            <span className="hyd-date-nav-label">{dateLabel}</span>
            {!isToday && (
              <button className="hyd-date-nav-today" onClick={goToday}>Back to Today</button>
            )}
          </div>
          <button className="hyd-date-nav-btn" onClick={nextDay} disabled={isToday}>Next →</button>
        </div>

        <ErrorBoundary>
          {loading
            ? <div className="brief-loading"><span className="spinner" /> Loading…</div>
            : (
              <div className="hydration-layout">
                {/* Left: ring + controls */}
                <div className="card hydration-main">
                  <div className="hydration-ring-wrap">
                    <WaterRing pct={pct} />
                    <div className="hydration-ring-center">
                      <span className="hydration-count" style={{ color: ringColor }}>{glasses}</span>
                      <span className="hydration-denom">/ {goal}</span>
                      <span className="hydration-unit">glasses</span>
                    </div>
                  </div>

                  {isToday ? (
                    <>
                      <p className="hydration-status" style={{ color: ringColor }}>{statusMsg}</p>
                      {pct < 1 && (
                        <p className="hydration-remaining">{ozLeft} oz remaining ({(goal - glasses)} glasses)</p>
                      )}
                    </>
                  ) : (
                    <p className="hydration-status" style={{ color: ringColor }}>Logged: {glasses} glasses</p>
                  )}

                  <div className="hydration-btns">
                    <button className="hydration-btn-minus" onClick={() => saveGlasses(glasses - 1)} disabled={glasses === 0}>−</button>
                    <button className="hydration-btn-add" onClick={() => saveGlasses(glasses + 1)}>+ Add Glass</button>
                  </div>

                  <div className="hydration-goal-row">
                    {editGoal ? (
                      <div style={{ display:"flex", gap:"0.5rem", alignItems:"center" }}>
                        <input
                          className="form-input"
                          type="number" min="1" max="20"
                          value={goalDraft}
                          onChange={e => setGoalDraft(e.target.value)}
                          style={{ width:80, textAlign:"center", padding:"0.3rem" }}
                          autoFocus
                          onKeyDown={e => e.key === "Enter" && saveGoal()}
                        />
                        <button className="btn btn-primary btn-sm" onClick={saveGoal}>Save</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditGoal(false)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditGoal(true)}>
                        ✎ Goal: {goal} glasses ({goal * 8} oz)
                      </button>
                    )}
                  </div>
                </div>

                {/* Right: 7-day history — click a row to jump to that day */}
                <div className="card hydration-history">
                  <div className="habit-panel-header">
                    <span className="habit-panel-title">7-Day History</span>
                    <span style={{ fontSize:"0.65rem", color:"var(--text-dim)" }}>click row to edit</span>
                  </div>
                  <div className="hydration-hist-list">
                    {history.map((row, i) => {
                      const p   = row.goal > 0 ? row.glasses / row.goal : 0;
                      const col = p >= 1 ? "#00d4aa" : p >= 0.5 ? "#60a5fa" : p > 0 ? "#f59e0b" : "rgba(255,255,255,0.08)";
                      const dayLabel = new Date(row.log_date + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"numeric", day:"numeric" });
                      const isActive = row.log_date === selectedDate;
                      return (
                        <div
                          key={i}
                          className={`hydration-hist-row${isActive ? " hydration-hist-row--active" : ""}`}
                          onClick={() => setSelectedDate(row.log_date)}
                        >
                          <span className="hydration-hist-day">{dayLabel}</span>
                          <div className="hydration-hist-bar-wrap">
                            <div className="hydration-hist-bar" style={{ width:`${Math.min(100, p*100).toFixed(0)}%`, background: col }} />
                          </div>
                          <span className="hydration-hist-val" style={{ color: col }}>
                            {row.glasses}/{row.goal}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
