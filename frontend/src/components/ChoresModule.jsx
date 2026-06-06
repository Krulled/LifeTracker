import React, { useState, useEffect, useCallback } from "react";

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_SHORTS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FULLS  = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const ICON_PRESETS = [
  "🧹","🧺","🍽️","🪣","🧽","🪥","🛒","🌿","🐾","🚽",
  "🛁","🪟","🗑️","🧴","📦","🔧","🧻","🍳","☕","🌊",
  "🐕","🧊","💡","🪑","🛋️","🪞","🚿","📬","🌱","🎯",
];
const COLOR_PRESETS = [
  "#60a5fa","#4ade80","#f59e0b","#c084fc",
  "#f87171","#00d4aa","#fb923c","#a78bfa","#34d399","#f472b6",
];

const RECURRENCE_OPTIONS = [
  { value: "daily",    label: "Every day" },
  { value: "weekdays", label: "Weekdays (Mon–Fri)" },
  { value: "weekends", label: "Weekends (Sat & Sun)" },
  { value: "custom",   label: "Custom days…" },
];

const RECURRENCE_LABEL = {
  daily:    "Every day",
  weekdays: "Mon – Fri",
  weekends: "Sat & Sun",
  custom:   "Custom",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getMonday(d) {
  const dt  = new Date(d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function fmtISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtWeekLabel(ws, we) {
  const o  = { month: "short", day: "numeric" };
  const s  = new Date(ws + "T12:00:00").toLocaleDateString("en-US", o);
  const e  = new Date(we + "T12:00:00").toLocaleDateString("en-US", o);
  const yr = new Date(ws + "T12:00:00").getFullYear();
  return `${s} – ${e}, ${yr}`;
}

// ── AddChoreModal ─────────────────────────────────────────────────────────────

function AddChoreModal({ onSave, onCancel }) {
  const [name,       setName]       = useState("");
  const [icon,       setIcon]       = useState("🧹");
  const [color,      setColor]      = useState("#60a5fa");
  const [recurrence, setRecurrence] = useState("daily");
  const [days,       setDays]       = useState([]);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState(null);

  function toggleDay(dow) {
    setDays(prev => prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow].sort((a, b) => a - b));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    if (recurrence === "custom" && days.length === 0) {
      setError("Select at least one day.");
      return;
    }
    setSaving(true); setError(null);
    const res = await fetch("/api/chores", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name: name.trim(), icon, color, recurrence, days }),
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
          <span className="modal-title">Add Recurring Chore</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Name *</label>
            <input
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder='e.g. "Vacuum living room"'
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Icon</label>
            <div className="habit-emoji-grid">
              {ICON_PRESETS.map(em => (
                <button
                  key={em}
                  type="button"
                  className={`habit-emoji-btn${icon === em ? " selected" : ""}`}
                  onClick={() => setIcon(em)}
                >{em}</button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Color</label>
            <div className="habit-color-row">
              {COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`habit-color-swatch${color === c ? " selected" : ""}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={c}
                />
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Repeats</label>
            <div className="chore-recurrence-opts">
              {RECURRENCE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`chore-recurrence-btn${recurrence === opt.value ? " active" : ""}`}
                  onClick={() => setRecurrence(opt.value)}
                >{opt.label}</button>
              ))}
            </div>
          </div>

          {recurrence === "custom" && (
            <div className="form-group">
              <label className="form-label">Days</label>
              <div className="chore-days-grid">
                {DAY_SHORTS.map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`chore-day-btn${days.includes(i) ? " active" : ""}`}
                    onClick={() => toggleDay(i)}
                  >{d}</button>
                ))}
              </div>
            </div>
          )}

          {error && <div className="alert alert-error">✗ {error}</div>}

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex: 1 }}>
              {saving ? "Saving…" : "Add Chore"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── ManagePanel ───────────────────────────────────────────────────────────────

function ManagePanel({ chores, onDelete, onClose }) {
  return (
    <div className="chore-manage-panel card">
      <div className="chore-manage-header">
        <span className="chore-manage-title">All Chores ({chores.length})</span>
        <button className="rtn-panel-close" onClick={onClose} title="Close">✕</button>
      </div>

      {chores.length === 0 ? (
        <div className="chore-manage-empty">
          No chores yet — click "+ Add Chore" to get started.
        </div>
      ) : (
        <div className="chore-manage-list">
          {chores.map(c => (
            <div key={c.id} className="chore-manage-row">
              <span className="chore-manage-icon" style={{ color: c.color }}>{c.icon}</span>
              <div className="chore-manage-info">
                <span className="chore-manage-name">{c.name}</span>
                <span className="chore-manage-recur">
                  {RECURRENCE_LABEL[c.recurrence] || "Custom"}
                  {c.recurrence === "custom" && c.days.length > 0 &&
                    ` · ${c.days.map(d => DAY_SHORTS[d]).join(", ")}`}
                </span>
              </div>
              <button
                className="habit-del-btn"
                style={{ opacity: 1 }}
                onClick={() => onDelete(c.id)}
                title="Delete chore"
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ChoresModule ──────────────────────────────────────────────────────────────

export default function ChoresModule({ onBack }) {
  const todayISO = fmtISO(new Date());

  const [weekStart,  setWeekStart]  = useState(() => fmtISO(getMonday(new Date())));
  const [weekData,   setWeekData]   = useState(null);
  const [chores,     setChores]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showAdd,    setShowAdd]    = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [toggling,   setToggling]   = useState(new Set());

  const fetchWeek = useCallback(async (ws) => {
    const today = fmtISO(new Date());
    const r = await fetch(`/api/chores/week?week_start=${ws}&today=${today}`);
    setWeekData(await r.json());
  }, []);

  const fetchChores = useCallback(async () => {
    const r = await fetch("/api/chores");
    const d = await r.json();
    setChores(Array.isArray(d) ? d : []);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchWeek(weekStart), fetchChores()])
      .finally(() => setLoading(false));
  }, [weekStart, fetchWeek, fetchChores]);

  function prevWeek() {
    const d = new Date(weekStart + "T12:00:00");
    d.setDate(d.getDate() - 7);
    setWeekStart(fmtISO(d));
  }
  function nextWeek() {
    const d = new Date(weekStart + "T12:00:00");
    d.setDate(d.getDate() + 7);
    setWeekStart(fmtISO(d));
  }
  function goThisWeek() {
    setWeekStart(fmtISO(getMonday(new Date())));
  }

  async function handleToggle(choreId, date) {
    const key = `${choreId}|${date}`;
    if (toggling.has(key)) return;

    // Optimistic update
    setWeekData(prev => {
      const days = prev.days.map(day => ({
        ...day,
        chores: day.chores.map(c =>
          c.chore_id === choreId && c.date === date
            ? { ...c, completed: !c.completed }
            : c
        ),
      }));
      const allChores = days.flatMap(d => d.chores);
      const completed = allChores.filter(c => c.completed).length;
      const total     = allChores.length;
      return { ...prev, days, stats: { total, completed, pct: total > 0 ? Math.round(completed / total * 100) : 0 } };
    });

    setToggling(prev => new Set([...prev, key]));
    await fetch("/api/chores/log", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chore_id: choreId, log_date: date }),
    });
    setToggling(prev => { const s = new Set(prev); s.delete(key); return s; });
  }

  async function handleDeleteChore(id) {
    if (!window.confirm("Delete this chore? All completion history will be removed.")) return;
    await fetch(`/api/chores/${id}`, { method: "DELETE" });
    setChores(prev => prev.filter(c => c.id !== id));
    await fetchWeek(weekStart);
  }

  function handleChoreAdded(newChore) {
    setChores(prev => [...prev, newChore]);
    setShowAdd(false);
    fetchWeek(weekStart);
  }

  const isThisWeek = weekStart === fmtISO(getMonday(new Date()));
  const stats      = weekData?.stats;
  const pctColor   = !stats || stats.total === 0 ? "var(--accent)"
    : stats.pct >= 80 ? "#4ade80"
    : stats.pct >= 50 ? "#f59e0b"
    : "#f87171";

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button className="back-btn" onClick={onBack}>← Hub</button>
          <div className="brand">
            <span className="brand-icon">🧹</span>
            <div>
              <div className="brand-name">Chores</div>
              <div className="brand-sub">
                WEEKLY PLANNER ·{" "}
                {stats && stats.total > 0
                  ? `${stats.completed}/${stats.total} done (${stats.pct}%)`
                  : stats?.total === 0
                  ? "all clear this week"
                  : "loading…"}
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.45rem", alignItems: "center" }}>
          <button
            className={`btn btn-ghost btn-sm${showManage ? " active" : ""}`}
            onClick={() => setShowManage(v => !v)}
          >📋 Manage</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
            + Add Chore
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "1.25rem 1.5rem" }}>
        {loading ? (
          <div className="brief-loading"><span className="spinner" /> Loading…</div>
        ) : (
          <>
            {/* Manage panel */}
            {showManage && (
              <ManagePanel
                chores={chores}
                onDelete={handleDeleteChore}
                onClose={() => setShowManage(false)}
              />
            )}

            {/* Week navigation */}
            <div className="chore-week-nav">
              <button className="chore-nav-btn" onClick={prevWeek}>‹</button>
              <div className="chore-week-center">
                <span className="chore-week-label">
                  {weekData ? fmtWeekLabel(weekData.week_start, weekData.week_end) : "—"}
                </span>
                {!isThisWeek && (
                  <button className="chore-today-btn" onClick={goThisWeek}>↩ This week</button>
                )}
              </div>
              <button className="chore-nav-btn" onClick={nextWeek} disabled={isThisWeek}>›</button>
            </div>

            {/* Weekly progress bar */}
            {stats && stats.total > 0 && (
              <div className="chore-week-progress">
                <div className="chore-week-bar-track">
                  <div
                    className="chore-week-bar-fill"
                    style={{ width: `${stats.pct}%`, background: pctColor }}
                  />
                </div>
                <span className="chore-week-pct" style={{ color: pctColor }}>
                  {stats.completed}/{stats.total} done
                </span>
              </div>
            )}

            {/* Empty state */}
            {chores.length === 0 ? (
              <div className="chore-empty-state card">
                <div className="chore-empty-icon">🧹</div>
                <div className="chore-empty-title">No chores set up yet</div>
                <div className="chore-empty-sub">
                  Add recurring chores like vacuuming, dishes, or laundry and they'll
                  automatically appear on the right days every week.
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowAdd(true)}
                  style={{ marginTop: "1rem" }}
                >
                  + Add Your First Chore
                </button>
              </div>
            ) : (
              /* ── Weekly 7-column grid ── */
              <div className="chore-week-scroll">
              <div className="chore-week-grid">
                {weekData?.days.map(day => {
                  const doneCnt  = day.chores.filter(c => c.completed).length;
                  const totalCnt = day.chores.length;
                  const allDone  = totalCnt > 0 && doneCnt === totalCnt;
                  const jsDay    = new Date(day.date + "T12:00:00").getDay(); // 0=Sun
                  const dayIdx   = jsDay === 0 ? 6 : jsDay - 1;              // 0=Mon…6=Sun

                  return (
                    <div
                      key={day.date}
                      className={[
                        "chore-day-col",
                        day.is_today  ? "today"  : "",
                        day.is_past   ? "past"   : "",
                        allDone       ? "all-done" : "",
                      ].filter(Boolean).join(" ")}
                    >
                      {/* Day header */}
                      <div className="chore-day-header">
                        <span className="chore-day-name">{DAY_FULLS[dayIdx]}</span>
                        <span className="chore-day-num">
                          {new Date(day.date + "T12:00:00").getDate()}
                        </span>
                        {totalCnt > 0 && (
                          <span
                            className="chore-day-count"
                            style={{ color: allDone ? "#4ade80" : "var(--text-dim)" }}
                          >
                            {allDone ? "✓ all" : `${doneCnt}/${totalCnt}`}
                          </span>
                        )}
                      </div>

                      {/* Chore list */}
                      <div className="chore-day-body">
                        {day.chores.length === 0 ? (
                          <div className="chore-day-free">—</div>
                        ) : (
                          day.chores.map(c => {
                            const key    = `${c.chore_id}|${c.date}`;
                            const isLate = day.is_past && !c.completed;
                            return (
                              <button
                                key={c.chore_id}
                                className={[
                                  "chore-chip",
                                  c.completed ? "done"    : "",
                                  isLate      ? "overdue" : "",
                                ].filter(Boolean).join(" ")}
                                onClick={() => handleToggle(c.chore_id, c.date)}
                                disabled={toggling.has(key)}
                                title={c.completed ? "Mark incomplete" : "Mark complete"}
                              >
                                <span className="chore-chip-icon">{c.icon}</span>
                                <span className="chore-chip-name">{c.name}</span>
                                <span
                                  className="chore-chip-check"
                                  style={{ color: c.completed ? c.color : undefined }}
                                >
                                  {c.completed ? "✓" : "○"}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              </div>
            )}
          </>
        )}
      </main>

      {showAdd && (
        <AddChoreModal onSave={handleChoreAdded} onCancel={() => setShowAdd(false)} />
      )}
    </div>
  );
}
