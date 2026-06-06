import React, { useState, useEffect, useCallback, useMemo } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMOJI_PRESETS = ["💧","🏃","📚","🧘","💊","✍️","🎯","🥗","💪","😴","🚶","🎵","🌱","🔧","☕","🤸","🧹","🛡️","🎮","⭐"];
const SUPP_ICONS    = ["💊","☀️","🐟","🧲","🫐","🌿","🔴","🟡","💉","⚗️","🍋","🥦"];
const COLOR_PRESETS = ["#00d4aa","#60a5fa","#c084fc","#f59e0b","#4ade80","#f87171","#fb923c","#a78bfa"];
const DAY_LETTERS   = ["M","T","W","T","F","S","S"];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function getGridStart() {
  const today = new Date();
  today.setHours(0,0,0,0);
  const daysToMon = (today.getDay() + 6) % 7;
  const monday    = new Date(today.getTime() - daysToMon * 86400000);
  return new Date(monday.getTime() - 11 * 7 * 86400000);
}

// ---------------------------------------------------------------------------
// AddHabitModal
// ---------------------------------------------------------------------------

function AddHabitModal({ onSave, onCancel }) {
  const [name,   setName]   = useState("");
  const [icon,   setIcon]   = useState("⭐");
  const [color,  setColor]  = useState("#00d4aa");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError(null);
    const res  = await fetch("/api/habits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), icon, color }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setError(json.error || "Save failed"); return; }
    onSave(json);
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal-box">
        <div className="modal-header">
          <span className="modal-title">New Habit</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Name *</label>
            <input className="form-input" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Read 20 minutes" required autoFocus />
          </div>

          <div className="form-group">
            <label className="form-label">Icon</label>
            <div className="habit-emoji-grid">
              {EMOJI_PRESETS.map(em => (
                <button key={em} type="button"
                  className={`habit-emoji-btn${icon === em ? " selected" : ""}`}
                  onClick={() => setIcon(em)}>{em}</button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Color</label>
            <div className="habit-color-row">
              {COLOR_PRESETS.map(c => (
                <button key={c} type="button"
                  className={`habit-color-swatch${color === c ? " selected" : ""}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={c} />
              ))}
            </div>
          </div>

          {error && <div className="alert alert-error">✗ {error}</div>}
          <div style={{ display:"flex", gap:"0.5rem", marginTop:"1rem" }}>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex:1 }}>
              {saving ? "Saving…" : "Add Habit"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HabitDateNav
// ---------------------------------------------------------------------------

function HabitDateNav({ date, today, onChange }) {
  function shift(delta) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + delta);
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    if (iso <= today) onChange(iso);
  }
  const isToday = date === today;
  const label   = isToday ? "Today" : new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });
  return (
    <div className="ex-date-nav" style={{ marginBottom:"0.5rem" }}>
      <button className="ex-date-nav-btn" onClick={() => shift(-1)}>‹</button>
      <div className="ex-date-nav-center">
        <span className="ex-date-nav-label">{label}</span>
        {!isToday && <button className="ex-date-nav-today" onClick={() => onChange(today)}>↩ Today</button>}
      </div>
      <button className="ex-date-nav-btn" onClick={() => shift(1)} disabled={isToday}>›</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HabitChecklist — left panel
// ---------------------------------------------------------------------------

function HabitChecklist({ habits, date, today, onToggle, onDelete, onAdd }) {
  const isToday = date === today;
  const fmt     = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday:"long", month:"short", day:"numeric" });

  return (
    <div className="habit-checklist-panel card">
      <div className="habit-panel-header">
        <span className="habit-panel-title">{isToday ? "Today" : "Past Day"}</span>
        <span className="habit-panel-date">{fmt}</span>
      </div>

      {habits.length === 0 && (
        <div className="habit-empty">No habits yet. Hit "+ Add Habit" to start tracking.</div>
      )}

      <div className="habit-list">
        {habits.map(h => (
          <div key={h.id} className="habit-item">
            <button
              className={`habit-check-btn${h.logged_today ? " checked" : ""}`}
              style={h.logged_today
                ? { background: h.color, borderColor: h.color, color: "#000" }
                : { borderColor: h.color }}
              onClick={() => onToggle(h.id, date)}
              aria-label={`Toggle ${h.name}`}
            >
              {h.logged_today ? "✓" : ""}
            </button>
            <span className="habit-icon">{h.icon}</span>
            <span className="habit-name">{h.name}</span>
            <span className="habit-streak-badge">
              {h.streak >= 3 ? "🔥" : "⚡"} {h.streak}
            </span>
            <button className="habit-del-btn" onClick={() => onDelete(h.id)} title="Remove">✕</button>
          </div>
        ))}
      </div>

      <button className="btn btn-primary" style={{ marginTop:"1rem", width:"100%" }} onClick={onAdd}>
        + Add Habit
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HabitGrid — right panel
// ---------------------------------------------------------------------------

function HabitGrid({ gridData }) {
  const today     = todayISO();
  const gridStart = useMemo(() => getGridStart(), []);

  const { habits = [] } = gridData || {};
  const totalHabits = habits.length;

  const logsByDate = useMemo(() => {
    const map = {};
    habits.forEach(h => {
      h.logs.forEach(d => { map[d] = (map[d] || 0) + 1; });
    });
    return map;
  }, [habits]);

  const cells = useMemo(() => Array.from({ length: 84 }, (_, i) => {
    const d   = new Date(gridStart.getTime() + i * 86400000);
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const cnt = logsByDate[iso] || 0;
    const pct = totalHabits > 0 ? cnt / totalHabits : 0;
    return { iso, cnt, pct, isFuture: iso > today, isToday: iso === today };
  }), [gridStart, logsByDate, totalHabits, today]);

  function bgColor(cell) {
    if (cell.isFuture) return "rgba(255,255,255,0.03)";
    if (cell.pct === 0) return "rgba(255,255,255,0.06)";
    return `rgba(0,212,170,${(0.2 + 0.8 * cell.pct).toFixed(2)})`;
  }

  if (!gridData) {
    return (
      <div className="habit-grid-panel card">
        <div className="brief-loading" style={{ padding:"2rem" }}><span className="spinner" /> Loading…</div>
      </div>
    );
  }

  return (
    <div className="habit-grid-panel card">
      <div className="habit-panel-header">
        <span className="habit-panel-title">12-Week Activity</span>
        <span className="habit-panel-date">{totalHabits} habit{totalHabits !== 1 ? "s" : ""} tracked</span>
      </div>

      <div className="habit-grid-wrap">
        <div className="habit-grid-day-labels">
          {DAY_LETTERS.map((l, i) => (
            <span key={i} className="habit-grid-day-lbl">{l}</span>
          ))}
        </div>
        <div className="habit-grid-cells">
          {cells.map((cell, i) => (
            <div
              key={i}
              className={`habit-cell${cell.isToday ? " today" : ""}`}
              style={{ background: bgColor(cell) }}
              title={`${cell.iso}: ${cell.cnt} habit${cell.cnt !== 1 ? "s" : ""} logged`}
            />
          ))}
        </div>
      </div>

      {habits.length > 0 && (
        <div className="habit-streak-list">
          {habits.map(h => (
            <div key={h.id} className="habit-streak-row">
              <span style={{ color: h.color, fontSize:"1rem" }}>{h.icon}</span>
              <span className="habit-streak-name">{h.name}</span>
              <span className="habit-streak-val" style={{ color: h.color }}>
                {h.streak >= 3 ? "🔥" : "⚡"} {h.streak}d streak
              </span>
            </div>
          ))}
        </div>
      )}

      {habits.length === 0 && (
        <p style={{ color:"var(--text-dim)", fontSize:"0.82rem", padding:"1rem 0" }}>
          Add habits on the left to see your activity grid here.
        </p>
      )}

      <div className="habit-grid-legend">
        <span>Less</span>
        {[0.1,0.35,0.6,0.82,1.0].map((p, i) => (
          <div key={i} className="habit-legend-cell"
            style={{ background: `rgba(0,212,170,${(0.2 + 0.8*p).toFixed(2)})` }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SupplementsSection
// ---------------------------------------------------------------------------

function SupplementsSection({ date: dateStr }) {
  const [supps,      setSupps]      = useState([]);
  const [showAdd,    setShowAdd]    = useState(false);
  const [addName,    setAddName]    = useState("");
  const [addIcon,    setAddIcon]    = useState("💊");
  const [editingId,  setEditingId]  = useState(null);
  const [editName,   setEditName]   = useState("");
  const [saving,     setSaving]     = useState(false);

  const fetchSupps = useCallback(() =>
    fetch(`/api/supplements?date=${dateStr}`)
      .then(r => r.json())
      .then(d => setSupps(Array.isArray(d) ? d : []))
      .catch(() => {}),
  [dateStr]);

  useEffect(() => { fetchSupps(); }, [fetchSupps]);

  async function toggle(id) {
    setSupps(prev => prev.map(s => s.id === id ? { ...s, taken_today: !s.taken_today } : s));
    await fetch(`/api/supplements/${id}/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ log_date: dateStr }),
    }).catch(() => {});
    fetchSupps();
  }

  async function addSupp() {
    if (!addName.trim()) return;
    setSaving(true);
    const res = await fetch("/api/supplements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: addName.trim(), icon: addIcon }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      setAddName(""); setAddIcon("💊"); setShowAdd(false);
      fetchSupps();
    }
  }

  async function saveRename(id) {
    if (!editName.trim()) { setEditingId(null); return; }
    await fetch(`/api/supplements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    }).catch(() => {});
    setEditingId(null);
    fetchSupps();
  }

  async function del(id) {
    if (!window.confirm("Delete this supplement and all its logs?")) return;
    await fetch(`/api/supplements/${id}`, { method: "DELETE" }).catch(() => {});
    fetchSupps();
  }

  const takenCount = supps.filter(s => s.taken_today).length;

  return (
    <div className="supp-card card">
      <div className="habit-panel-header">
        <span className="habit-panel-title">💊 Supplements</span>
        <span className="habit-panel-date">{takenCount}/{supps.length} taken</span>
      </div>

      {supps.length === 0 && !showAdd && (
        <p className="supp-empty">No supplements yet. Add your first one below.</p>
      )}

      <div className="supp-list">
        {supps.map(s => (
          <div key={s.id} className="supp-item">
            <button
              className={`supp-check-btn${s.taken_today ? " checked" : ""}`}
              onClick={() => toggle(s.id)}
              aria-label={`Toggle ${s.name}`}
            >
              {s.taken_today ? "✓" : ""}
            </button>
            <span className="supp-icon">{s.icon}</span>

            {editingId === s.id ? (
              <input
                className="supp-rename-input"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={() => saveRename(s.id)}
                onKeyDown={e => { if (e.key === "Enter") saveRename(s.id); if (e.key === "Escape") setEditingId(null); }}
                autoFocus
              />
            ) : (
              <span
                className="supp-name"
                onClick={() => { setEditingId(s.id); setEditName(s.name); }}
                title="Click to rename"
              >{s.name}</span>
            )}
            <button className="supp-del-btn" onClick={() => del(s.id)} title="Delete">✕</button>
          </div>
        ))}
      </div>

      {showAdd ? (
        <div className="supp-add-form">
          <input
            className="supp-add-input"
            placeholder="Supplement name"
            value={addName}
            onChange={e => setAddName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addSupp(); if (e.key === "Escape") setShowAdd(false); }}
            autoFocus
          />
          <div className="supp-icon-picker">
            {SUPP_ICONS.map(ic => (
              <button
                key={ic}
                type="button"
                className={`supp-icon-btn${addIcon === ic ? " selected" : ""}`}
                onClick={() => setAddIcon(ic)}
              >{ic}</button>
            ))}
          </div>
          <div className="supp-add-actions">
            <button className="btn btn-primary btn-sm" onClick={addSupp} disabled={saving || !addName.trim()}>
              {saving ? "…" : "Add"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowAdd(false); setAddName(""); setAddIcon("💊"); }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-ghost" style={{ marginTop:"0.6rem", width:"100%", fontSize:"0.82rem" }} onClick={() => setShowAdd(true)}>
          + Add Supplement
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HabitModule
// ---------------------------------------------------------------------------

export default function HabitModule({ onBack }) {
  const today = todayISO();
  const [selectedDate, setSelectedDate] = useState(today);
  const [habits,  setHabits]  = useState([]);
  const [gridData,setGridData]= useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const fetchHabits = useCallback(() =>
    fetch(`/api/habits?date=${selectedDate}`).then(r => r.json()).then(d => setHabits(Array.isArray(d) ? d : [])),
  [selectedDate]);

  const fetchGrid = useCallback(() =>
    fetch(`/api/habits/grid?days=84&date=${todayISO()}`).then(r => r.json()).then(d => setGridData(d)),
  []);

  useEffect(() => {
    Promise.all([fetchHabits(), fetchGrid()]).finally(() => setLoading(false));
  }, [fetchHabits, fetchGrid, selectedDate]);

  async function handleToggle(habitId, dateStr) {
    setHabits(prev => prev.map(h => h.id === habitId
      ? { ...h, logged_today: !h.logged_today, streak: h.logged_today ? Math.max(0, h.streak - 1) : h.streak + 1 }
      : h));
    try {
      const res = await fetch("/api/habits/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habit_id: habitId, log_date: dateStr }),
      });
      if (res.ok) {
        const json = await res.json();
        setHabits(prev => prev.map(h => h.id === habitId
          ? { ...h, logged_today: json.logged, streak: json.streak ?? h.streak }
          : h));
      }
    } catch (_) {
      // network error — keep optimistic state, grid refresh will reconcile
    }
    fetchGrid();
  }

  async function handleDelete(habitId) {
    if (!window.confirm("Remove this habit? Your log history is preserved.")) return;
    setHabits(prev => prev.filter(h => h.id !== habitId));
    await fetch(`/api/habits/${habitId}`, { method: "DELETE" });
    fetchHabits(); fetchGrid();
  }

  function handleAdded(newHabit) {
    setHabits(prev => [...prev, newHabit]);
    setShowAdd(false);
    fetchGrid();
  }

  const doneCount = habits.filter(h => h.logged_today).length;

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <button className="back-btn" onClick={onBack}>← Hub</button>
          <div className="brand">
            <span className="brand-icon">🔥</span>
            <div>
              <div className="brand-name">Habits</div>
              <div className="brand-sub">STREAK TRACKER · {doneCount}/{habits.length} today</div>
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth:1100, margin:"0 auto", padding:"1.25rem 1.5rem" }}>
        <ErrorBoundary>
          {loading
            ? <div className="brief-loading" style={{ padding:"3rem" }}><span className="spinner" /> Loading…</div>
            : (
              <div className="habit-layout">
                <div className="habit-left-col">
                  <HabitDateNav date={selectedDate} today={today} onChange={setSelectedDate} />
                  <HabitChecklist
                    habits={habits}
                    date={selectedDate}
                    today={today}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                    onAdd={() => setShowAdd(true)}
                  />
                  <SupplementsSection date={selectedDate} />
                </div>
                <HabitGrid gridData={gridData} />
              </div>
            )}
        </ErrorBoundary>
      </main>

      {showAdd && (
        <AddHabitModal onSave={handleAdded} onCancel={() => setShowAdd(false)} />
      )}
    </div>
  );
}
