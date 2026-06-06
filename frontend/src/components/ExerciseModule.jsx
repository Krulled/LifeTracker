import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";

function toDateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function localDateISO() { return toDateISO(new Date()); }

const TYPE_META = {
  cardio:      { icon:"🏃", color:"#f87171", label:"Cardio" },
  strength:    { icon:"💪", color:"#60a5fa", label:"Strength" },
  flexibility: { icon:"🤸", color:"#c084fc", label:"Flexibility" },
  sports:      { icon:"⚽", color:"#f59e0b", label:"Sports" },
  other:       { icon:"🏋️", color:"#8b949e", label:"Other" },
};

const DAY_TAGS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday",
                  "Push Day","Pull Day","Leg Day","Upper Body","Lower Body","Cardio Day","Rest Day"];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function fmtEntry(e) {
  if (e.exercise_type === "strength" && e.sets) {
    const wt = e.weight_lbs ? ` @ ${e.weight_lbs} lbs` : "";
    return `${e.sets}×${e.reps ?? "?"}${wt}`;
  }
  return `${e.duration_minutes} min`;
}

function fmtItemDetail(item) {
  if (item.exercise_type === "strength" && item.sets) {
    const wt = item.weight_lbs ? ` @ ${item.weight_lbs} lbs` : "";
    return `${item.sets}×${item.reps ?? "?"}${wt}`;
  }
  const parts = [`${item.duration_minutes} min`];
  if (item.intensity) parts.push(`${item.intensity}/10`);
  if (item.calories_burned) parts.push(`~${item.calories_burned} cal`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// DateNavigator
// ---------------------------------------------------------------------------

function DateNavigator({ selectedDate, today, onChange }) {
  function shift(delta) {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + delta);
    const next = toDateISO(d);
    if (next <= today) onChange(next);
  }
  const d       = new Date(selectedDate + "T12:00:00");
  const isToday = selectedDate === today;
  const label   = isToday ? "Today" : `${DAY_NAMES[d.getDay()]} · ${selectedDate}`;
  return (
    <div className="ex-date-nav">
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
// AddExerciseForm
// ---------------------------------------------------------------------------

function MultiExerciseForm({ onSave, onCancel, date, defaultGroup }) {
  const [type,      setType]      = useState("strength");
  const [group,     setGroup]     = useState(defaultGroup || "");
  const [rows,      setRows]      = useState([{ name:"", sets:"3", reps:"8", weight:"", duration:"", intensity:"6", calories:"" }]);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState(null);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError,   setAiError]   = useState(null);

  const isStrength = type === "strength";

  function addRow() {
    setRows(prev => [...prev, { name:"", sets:"3", reps:"8", weight:"", duration:"", intensity:"6", calories:"" }]);
  }

  function removeRow(i) {
    if (rows.length === 1) return;
    setRows(prev => prev.filter((_, idx) => idx !== i));
  }

  function updateRow(i, field, value) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  }

  async function handleSubmit() {
    const valid = rows.filter(r => r.name.trim() && (isStrength || r.duration));
    if (!valid.length) { setError("Enter at least one exercise name"); return; }
    setSaving(true); setError(null);
    const created = [];
    for (const r of valid) {
      const res = await fetch("/api/exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:             r.name.trim(),
          exercise_type:    type,
          group_name:       group.trim() || null,
          duration_minutes: r.duration  ? parseInt(r.duration, 10)  : 0,
          intensity:        isStrength  ? null : (r.intensity ? parseInt(r.intensity, 10) : null),
          calories_burned:  r.calories  ? parseInt(r.calories, 10)  : null,
          sets:             r.sets      ? parseInt(r.sets, 10)      : null,
          reps:             r.reps      ? parseInt(r.reps, 10)      : null,
          weight_lbs:       r.weight    ? parseFloat(r.weight)      : null,
          entry_date:       date,
        }),
      });
      if (res.ok) created.push(await res.json());
      else { const j = await res.json(); setError(j.error || "Save failed"); }
    }
    setSaving(false);
    if (created.length > 0) onSave(created);
  }

  async function generateAI() {
    setAiLoading(true); setAiError(null); setAiSummary(null);
    const valid = rows.filter(r => r.name.trim());
    const res = await fetch("/api/exercise/ai-summary", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        date,
        exercises: valid.map(r => ({
          name:             r.name.trim(),
          exercise_type:    type,
          group_name:       group.trim() || null,
          sets:             r.sets    ? parseInt(r.sets, 10)    : null,
          reps:             r.reps    ? parseInt(r.reps, 10)    : null,
          weight_lbs:       r.weight  ? parseFloat(r.weight)    : null,
          duration_minutes: r.duration ? parseInt(r.duration, 10) : 0,
          intensity:        !isStrength && r.intensity ? parseInt(r.intensity, 10) : null,
          calories_burned:  r.calories ? parseInt(r.calories, 10) : null,
        })),
      }),
    });
    const json = await res.json();
    setAiLoading(false);
    if (!res.ok) { setAiError(json.error || "Failed to generate"); return; }
    setAiSummary(json.summary);
  }

  const validCount = rows.filter(r => r.name.trim()).length;

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal-box mef-modal">
        <div className="modal-header">
          <span className="modal-title">Log Exercises</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="form-group">
          <label className="form-label">Type</label>
          <div className="exercise-type-grid">
            {Object.entries(TYPE_META).map(([k, v]) => (
              <button key={k} type="button"
                className={`exercise-type-btn${type === k ? " selected" : ""}`}
                style={{ "--type-color": v.color }}
                onClick={() => setType(k)}>
                {v.icon} {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Group <span style={{ color:"var(--text-dim)", fontWeight:400 }}>optional — applies to all</span></label>
          <input className="form-input" value={group} onChange={e => setGroup(e.target.value)}
            placeholder='"Chest/Back", "Legs"…' />
        </div>

        {/* Column headers */}
        <div className="mef-headers">
          <span className="mef-col-name">Exercise Name</span>
          {isStrength ? (
            <><span className="mef-col-num">Sets</span><span className="mef-col-num">Reps</span><span className="mef-col-num">Lbs</span></>
          ) : (
            <><span className="mef-col-num">Min</span><span className="mef-col-num">Effort</span><span className="mef-col-num">Cal</span></>
          )}
          <span className="mef-col-del" />
        </div>

        {/* Exercise rows */}
        <div className="mef-rows">
          {rows.map((r, i) => (
            <div key={i} className="mef-row">
              <input
                className="form-input mef-col-name"
                placeholder="e.g. Bench Press"
                value={r.name}
                onChange={e => updateRow(i, "name", e.target.value)}
                autoFocus={i === 0 && rows.length === 1}
              />
              {isStrength ? (
                <>
                  <input className="form-input mef-col-num" type="number" min="1" max="99"
                    placeholder="3" value={r.sets} onChange={e => updateRow(i, "sets", e.target.value)} />
                  <input className="form-input mef-col-num" type="number" min="1" max="999"
                    placeholder="8" value={r.reps} onChange={e => updateRow(i, "reps", e.target.value)} />
                  <input className="form-input mef-col-num" type="number" min="0" step="0.5"
                    placeholder="—" value={r.weight} onChange={e => updateRow(i, "weight", e.target.value)} />
                </>
              ) : (
                <>
                  <input className="form-input mef-col-num" type="number" min="1"
                    placeholder="30" value={r.duration} onChange={e => updateRow(i, "duration", e.target.value)} />
                  <input className="form-input mef-col-num" type="number" min="1" max="10"
                    placeholder="6" value={r.intensity} onChange={e => updateRow(i, "intensity", e.target.value)} />
                  <input className="form-input mef-col-num" type="number" min="0"
                    placeholder="—" value={r.calories} onChange={e => updateRow(i, "calories", e.target.value)} />
                </>
              )}
              <button type="button" className="mef-remove-btn"
                onClick={() => removeRow(i)} disabled={rows.length === 1} title="Remove">✕</button>
            </div>
          ))}
        </div>

        <button type="button" className="mef-add-row-btn" onClick={addRow}>＋ Add Exercise</button>

        {/* AI Summary */}
        <div className="mef-ai-section">
          <button type="button" className="mef-ai-btn" onClick={generateAI} disabled={aiLoading || validCount === 0}>
            {aiLoading ? <><span className="spinner" style={{ width:11,height:11 }} /> Analyzing…</> : "⚡ AI Summary"}
          </button>
          {!aiSummary && !aiLoading && !aiError && (
            <span className="mef-ai-hint">
              {validCount > 0 ? "Estimate calories burned for the exercises above" : "Enter at least one exercise to get an AI calorie estimate"}
            </span>
          )}
          {aiError   && <span className="mef-ai-error">✗ {aiError}</span>}
          {aiSummary && <p className="mef-ai-result">{aiSummary}</p>}
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom:"0.5rem" }}>✗ {error}</div>}
        <div style={{ display:"flex", gap:"0.5rem" }}>
          <button type="button" className="btn btn-primary" onClick={handleSubmit}
            disabled={saving || validCount === 0} style={{ flex:1 }}>
            {saving ? "Saving…" : `Log ${validCount > 0 ? validCount : ""} Exercise${validCount !== 1 ? "s" : ""}`}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SaveRoutineModal
// ---------------------------------------------------------------------------

function SaveRoutineModal({ todayEntries, onSave, onCancel }) {
  const [name,   setName]   = useState("");
  const [dayTag, setDayTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError(null);
    const items = todayEntries.map(ex => ({
      name:             ex.name,
      exercise_type:    ex.exercise_type,
      duration_minutes: ex.duration_minutes,
      intensity:        ex.intensity,
      calories_burned:  ex.calories_burned,
      sets:             ex.sets,
      reps:             ex.reps,
      weight_lbs:       ex.weight_lbs,
    }));
    const res = await fetch("/api/exercise/templates", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name: name.trim(), day_tag: dayTag || null, items }),
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
          <span className="modal-title">💾 Save as Routine</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="rtn-save-preview">
          {todayEntries.map((ex, i) => {
            const meta = TYPE_META[ex.exercise_type] || TYPE_META.other;
            return (
              <div key={i} className="rtn-save-preview-row">
                <span style={{ color: meta.color }}>{meta.icon}</span>
                <span className="rtn-save-preview-name">{ex.name}</span>
                <span className="rtn-save-preview-meta">{fmtEntry(ex)}</span>
              </div>
            );
          })}
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Routine name *</label>
            <input className="form-input" value={name} onChange={e => setName(e.target.value)}
              placeholder='e.g. "Push Day", "Morning Cardio"' required autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Day tag <span style={{ color:"var(--text-dim)", fontWeight:400 }}>(optional)</span></label>
            <div className="rtn-daytag-grid">
              {DAY_TAGS.map(d => (
                <button key={d} type="button"
                  className={`rtn-daytag-btn${dayTag === d ? " active" : ""}`}
                  onClick={() => setDayTag(dayTag === d ? "" : d)}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          {error && <div className="alert alert-error">✗ {error}</div>}
          <div style={{ display:"flex", gap:"0.5rem", marginTop:"1rem" }}>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex:1 }}>
              {saving ? "Saving…" : "Save Routine"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RoutinesPanel
// ---------------------------------------------------------------------------

function RoutinesPanel({ routines, onApply, onDelete, onClose, strengthHistory }) {
  const [applyingId, setApplyingId] = useState(null);
  const [flash,      setFlash]      = useState(null);
  const [expanded,   setExpanded]   = useState(null);

  async function handleApply(tpl) {
    setApplyingId(tpl.id);
    await onApply(tpl.id);
    setApplyingId(null);
    setFlash({ ok: true, text: `"${tpl.name}" logged!` });
    setTimeout(() => setFlash(null), 3000);
  }

  return (
    <div className="rtn-panel card">
      <div className="rtn-panel-header">
        <span className="rtn-panel-icon">📋</span>
        <span className="rtn-panel-title">Workout Routines</span>
        <span className="rtn-panel-count">{routines.length} saved</span>
        <button className="rtn-panel-close" onClick={onClose}>✕</button>
      </div>
      {flash && <div className={`rtn-flash${flash.ok ? "" : " error"}`}>{flash.text}</div>}
      {routines.length === 0 ? (
        <div className="rtn-empty">
          <div className="rtn-empty-icon">🏋️</div>
          <div className="rtn-empty-text">No routines saved yet.</div>
          <div className="rtn-empty-sub">Log today's workout, then click "💾 Save Routine".</div>
        </div>
      ) : (
        <div className="rtn-list">
          {routines.map(tpl => {
            const isOpen    = expanded === tpl.id;
            const totalMins = tpl.items.reduce((s, i) => s + (i.duration_minutes || 0), 0);
            return (
              <div key={tpl.id} className="rtn-card">
                <div className="rtn-card-top">
                  <button className="rtn-card-expand"
                    onClick={() => setExpanded(isOpen ? null : tpl.id)}>
                    <div className="rtn-card-info">
                      <div className="rtn-card-name">{tpl.name}</div>
                      <div className="rtn-card-meta">
                        {tpl.day_tag && <span className="rtn-meta-daytag">{tpl.day_tag}</span>}
                        {totalMins > 0 && <span className="rtn-meta-stat">{totalMins} min</span>}
                        {tpl.total_calories > 0 && <><span className="rtn-meta-dot">·</span><span className="rtn-meta-stat">~{tpl.total_calories} cal</span></>}
                        <span className="rtn-meta-dot">·</span>
                        <span className="rtn-meta-stat">{tpl.item_count} exercise{tpl.item_count !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    <span className="rtn-expand-chevron">{isOpen ? "▲" : "▼"}</span>
                  </button>
                  <div className="rtn-card-actions">
                    <button className="rtn-apply-btn" onClick={() => handleApply(tpl)} disabled={!!applyingId}>
                      {applyingId === tpl.id ? <span className="spinner" style={{ width:12, height:12 }} /> : "▶ Log"}
                    </button>
                    <button className="rtn-del-btn" onClick={() => onDelete(tpl.id)} disabled={!!applyingId}>🗑</button>
                  </div>
                </div>
                {isOpen && (
                  <div className="rtn-card-items">
                    {tpl.items.map((item, i) => {
                      const meta = TYPE_META[item.exercise_type] || TYPE_META.other;
                      const hist = strengthHistory?.[item.name];
                      const isStrengthItem = item.exercise_type === "strength" && item.sets;
                      return (
                        <div key={i} className="rtn-item-row">
                          <span className="rtn-item-icon" style={{ color: meta.color }}>{meta.icon}</span>
                          <div style={{ flex:1, minWidth:0 }}>
                            <span className="rtn-item-name">{item.name}</span>
                            <span className="rtn-item-detail">{fmtItemDetail(item)}</span>
                            {isStrengthItem && hist && (
                              <span className="rtn-item-last">
                                last {hist.entry_date}: {hist.sets}×{hist.reps ?? "?"}
                                {hist.weight_lbs ? ` @ ${hist.weight_lbs} lbs` : ""}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExerciseAISummary
// ---------------------------------------------------------------------------

function ExerciseAISummary({ date, hasEntries }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => { setSummary(null); setError(null); }, [date]);

  async function generate() {
    setLoading(true); setError(null); setSummary(null);
    const res = await fetch("/api/exercise/ai-summary", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ date }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) { setError(json.error || "Failed to generate"); return; }
    setSummary(json.summary);
  }

  return (
    <div className="card ex-ai-summary">
      <div className="habit-panel-header">
        <span style={{ fontSize:"1.1rem" }}>🤖</span>
        <span className="habit-panel-title">AI Workout Summary</span>
        <button
          className="btn btn-primary btn-sm"
          onClick={generate}
          disabled={loading || !hasEntries}
          style={{ marginLeft:"auto" }}
        >
          {loading ? <><span className="spinner" style={{ width:11, height:11 }} /> Analyzing…</> : "⚡ Generate"}
        </button>
      </div>
      {error   && <div className="alert alert-error" style={{ marginTop:"0.5rem" }}>✗ {error}</div>}
      {summary && <div className="ex-ai-text">{summary}</div>}
      {!summary && !loading && !error && (
        <div className="ex-ai-placeholder">
          {hasEntries
            ? "Generate an AI-powered calorie estimate and workout analysis based on your exercises, weight, and food intake."
            : "Log exercises above, then hit ⚡ Generate for an AI calorie estimate and workout analysis."}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExerciseModule
// ---------------------------------------------------------------------------

export default function ExerciseModule({ onBack }) {
  const today = localDateISO();

  const [selectedDate,    setSelectedDate]    = useState(today);
  const [dateEntries,     setDateEntries]      = useState([]);
  const [weekStats,       setWeekStats]        = useState(null);
  const [routines,        setRoutines]         = useState([]);
  const [strengthHistory, setStrengthHistory]  = useState({});
  const [loading,         setLoading]          = useState(true);
  const [showAdd,         setShowAdd]          = useState(false);
  const [addDefaultGroup, setAddDefaultGroup]  = useState(null);
  const [showSaveModal,   setShowSaveModal]    = useState(false);
  const [showRoutines,    setShowRoutines]     = useState(false);
  const [flash,           setFlash]            = useState(null);
  const [renamingGroup,   setRenamingGroup]    = useState(null);
  const [renameValue,     setRenameValue]      = useState("");
  const [showNewGroup,    setShowNewGroup]     = useState(false);
  const [newGroupName,    setNewGroupName]     = useState("");
  const newGroupRef = useRef(null);

  // ── Derived: group entries by group_name preserving insertion order ──────

  const grouped = useMemo(() => {
    const order = [];
    const map   = {};
    dateEntries.forEach(e => {
      const key = e.group_name || "__none__";
      if (!map[key]) { map[key] = []; order.push(key); }
      map[key].push(e);
    });
    return { order, map };
  }, [dateEntries]);

  // ── Fetchers ──────────────────────────────────────────────────────────────

  const fetchForDate = useCallback(async (d) => {
    const r = await fetch(`/api/exercise?date=${d}`);
    setDateEntries(await r.json());
  }, []);

  const fetchWeek = useCallback(async () => {
    const r   = await fetch("/api/exercise?limit=200");
    const all = await r.json();
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 6); cutoff.setHours(0,0,0,0);
    const week   = all.filter(e => new Date(e.entry_date + "T12:00:00") >= cutoff);
    const totalMins = week.reduce((s, e) => s + (e.duration_minutes || 0), 0);
    const byCal = {};
    week.forEach(e => { byCal[e.entry_date] = (byCal[e.entry_date] || 0) + (e.calories_burned || 0); });
    const totalCal = Object.values(byCal).reduce((s, v) => s + v, 0);
    const byType   = {};
    week.forEach(e => { byType[e.exercise_type] = (byType[e.exercise_type] || 0) + 1; });
    const sessions = new Set(week.map(e => e.entry_date)).size;
    setWeekStats({ sessions, totalMins, totalCal, byType, totalExercises: week.length });
  }, []);

  const fetchRoutines = useCallback(async () => {
    const r = await fetch("/api/exercise/templates");
    const d = await r.json();
    setRoutines(Array.isArray(d) ? d : []);
  }, []);

  const fetchStrengthHistory = useCallback(async (beforeDate) => {
    const r = await fetch(`/api/exercise/strength-history?before=${beforeDate}`);
    setStrengthHistory(await r.json());
  }, []);

  useEffect(() => {
    Promise.all([
      fetchForDate(selectedDate),
      fetchWeek(),
      fetchRoutines(),
      fetchStrengthHistory(selectedDate),
    ]).finally(() => setLoading(false));
  }, [fetchWeek, fetchRoutines, fetchStrengthHistory]); // eslint-disable-line

  useEffect(() => {
    fetchForDate(selectedDate);
    fetchStrengthHistory(selectedDate);
  }, [selectedDate, fetchForDate, fetchStrengthHistory]);

  useEffect(() => {
    if (showNewGroup) newGroupRef.current?.focus();
  }, [showNewGroup]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleDelete(id) {
    if (!window.confirm("Delete this exercise?")) return;
    await fetch(`/api/exercise/${id}`, { method: "DELETE" });
    fetchForDate(selectedDate);
    fetchWeek();
    fetchStrengthHistory(selectedDate);
  }

  function handleAdded(entries) {
    setDateEntries(prev => [...prev, ...entries]);
    setShowAdd(false);
    setAddDefaultGroup(null);
    fetchWeek();
    if (entries.some(e => e.sets)) fetchStrengthHistory(selectedDate);
  }

  function openAddForGroup(groupName) {
    setAddDefaultGroup(groupName === "__none__" ? null : groupName);
    setShowAdd(true);
  }

  function startRename(groupName) {
    setRenamingGroup(groupName);
    setRenameValue(groupName === "__none__" ? "" : groupName);
  }

  async function saveRename() {
    if (!renamingGroup) return;
    const newName = renameValue.trim();
    const oldName = renamingGroup === "__none__" ? null : renamingGroup;
    if (newName === (oldName || "")) { setRenamingGroup(null); return; }
    await fetch("/api/exercise/rename-group", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ date: selectedDate, old_name: oldName || "", new_name: newName || null }),
    });
    setRenamingGroup(null);
    fetchForDate(selectedDate);
  }

  function handleRenameKey(e) {
    if (e.key === "Enter")  { e.preventDefault(); saveRename(); }
    if (e.key === "Escape") { setRenamingGroup(null); }
  }

  function handleNewGroupKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const name = newGroupName.trim();
      setShowNewGroup(false);
      setNewGroupName("");
      setAddDefaultGroup(name || null);
      setShowAdd(true);
    }
    if (e.key === "Escape") { setShowNewGroup(false); setNewGroupName(""); }
  }

  function handleRoutineSaved(tpl) {
    setRoutines(prev => [tpl, ...prev]);
    setShowSaveModal(false);
    setFlash({ text: `"${tpl.name}" saved as a routine!` });
    setTimeout(() => setFlash(null), 3000);
  }

  async function handleApplyRoutine(templateId) {
    const res = await fetch(`/api/exercise/templates/${templateId}/apply`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ entry_date: selectedDate }),
    });
    if (!res.ok) return;
    const created = await res.json();
    setDateEntries(prev => {
      const ids = new Set(prev.map(e => e.id));
      return [...prev, ...created.filter(e => !ids.has(e.id))];
    });
    fetchWeek();
  }

  async function handleDeleteRoutine(templateId) {
    const res = await fetch(`/api/exercise/templates/${templateId}`, { method: "DELETE" });
    if (res.ok) setRoutines(prev => prev.filter(r => r.id !== templateId));
  }

  const dateMins = dateEntries.reduce((s, e) => s + (e.duration_minutes || 0), 0);
  const isToday  = selectedDate === today;
  const panelLabel = isToday ? "Today" : selectedDate < today ? "Past Day" : "Future";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <button className="back-btn" onClick={onBack}>← Hub</button>
          <div className="brand">
            <span className="brand-icon">🏋️</span>
            <div>
              <div className="brand-name">Exercise</div>
              <div className="brand-sub">
                WORKOUT LOG · {dateEntries.length > 0
                  ? `${dateEntries.length} exercise${dateEntries.length !== 1 ? "s" : ""}${dateMins > 0 ? ` · ${dateMins} min` : ""}`
                  : isToday ? "Rest day" : "No workouts"}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth:1000, margin:"0 auto", padding:"1.25rem 1.5rem" }}>
        <ErrorBoundary>
          {loading
            ? <div className="brief-loading"><span className="spinner" /> Loading…</div>
            : (
              <div className="exercise-layout">
                {/* ── Day panel ── */}
                <div className="card exercise-today-card">
                  <DateNavigator
                    selectedDate={selectedDate}
                    today={today}
                    onChange={d => { setSelectedDate(d); setShowAdd(false); }}
                  />

                  <div className="habit-panel-header" style={{ paddingTop:"0.5rem" }}>
                    <span className="habit-panel-title">{panelLabel}</span>
                    <div style={{ display:"flex", gap:"0.4rem", alignItems:"center" }}>
                      <button
                        className={`rtn-toggle-btn${showRoutines ? " active" : ""}`}
                        onClick={() => setShowRoutines(v => !v)}
                      >
                        📋 Routines{routines.length > 0 ? ` (${routines.length})` : ""}
                      </button>
                      {dateEntries.length > 0 && (
                        <button className="rtn-save-btn" onClick={() => setShowSaveModal(true)}>
                          💾 Save
                        </button>
                      )}
                      <button className="btn btn-primary btn-sm" onClick={() => { setAddDefaultGroup(null); setShowAdd(true); }}>
                        + Log
                      </button>
                    </div>
                  </div>

                  {flash && <div className="rtn-flash">{flash.text}</div>}

                  {showRoutines && (
                    <RoutinesPanel
                      routines={routines}
                      onApply={handleApplyRoutine}
                      onDelete={handleDeleteRoutine}
                      onClose={() => setShowRoutines(false)}
                      strengthHistory={strengthHistory}
                    />
                  )}

                  {dateEntries.length === 0 ? (
                    <div className="habit-empty">
                      No workouts logged {isToday ? "today" : `on ${selectedDate}`}. Hit "+ Log" or load a routine.
                    </div>
                  ) : (
                    <div className="ex-grouped-list">
                      {grouped.order.map(key => {
                        const entries  = grouped.map[key];
                        const isNone   = key === "__none__";
                        const isRenaming = renamingGroup === key;

                        return (
                          <div key={key} className="ex-group">
                            {/* Group header */}
                            <div className="ex-group-header">
                              {isNone ? (
                                <span className="ex-group-name dim">Ungrouped</span>
                              ) : isRenaming ? (
                                <input
                                  className="ex-group-rename-input"
                                  value={renameValue}
                                  onChange={e => setRenameValue(e.target.value)}
                                  onBlur={saveRename}
                                  onKeyDown={handleRenameKey}
                                  autoFocus
                                />
                              ) : (
                                <span className="ex-group-name">{key}</span>
                              )}
                              {!isRenaming && (
                                <button className="ex-group-rename-btn" onClick={() => startRename(key)} title="Rename group">
                                  ✎
                                </button>
                              )}
                              <button className="ex-group-add-btn" onClick={() => openAddForGroup(key)}>
                                + Add
                              </button>
                            </div>

                            {/* Exercises in this group */}
                            {entries.map(e => {
                              const meta = TYPE_META[e.exercise_type] || TYPE_META.other;
                              const detail = [fmtEntry(e)];
                              if (e.exercise_type !== "strength" && e.intensity) detail.push(`${e.intensity}/10`);
                              if (e.calories_burned) detail.push(`~${e.calories_burned} cal`);
                              return (
                                <div key={e.id} className="exercise-item">
                                  <span className="exercise-item-icon" style={{ color: meta.color }}>{meta.icon}</span>
                                  <div className="exercise-item-info">
                                    <span className="exercise-item-name">{e.name}</span>
                                    <span className="exercise-item-meta">{meta.label} · {detail.join(" · ")}</span>
                                  </div>
                                  <button className="habit-del-btn" style={{ opacity:1 }} onClick={() => handleDelete(e.id)}>✕</button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* New Group row */}
                  {!isToday ? null : showNewGroup ? (
                    <div className="ex-new-group-row">
                      <input
                        ref={newGroupRef}
                        className="form-input ex-new-group-input"
                        placeholder='Group name, e.g. "Chest/Back"…'
                        value={newGroupName}
                        onChange={e => setNewGroupName(e.target.value)}
                        onKeyDown={handleNewGroupKey}
                        onBlur={() => { setShowNewGroup(false); setNewGroupName(""); }}
                      />
                      <span className="ex-new-group-hint">Enter to add exercises</span>
                    </div>
                  ) : (
                    <button
                      className="ex-new-group-btn"
                      onClick={() => setShowNewGroup(true)}
                    >
                      ＋ New Group
                    </button>
                  )}

                  {dateMins > 0 && (
                    <div className="exercise-today-totals">
                      <span>Total: <strong>{dateMins} min</strong></span>
                      {dateEntries.some(e => e.calories_burned) && (
                        <span>~<strong>{dateEntries.reduce((s,e) => s+(e.calories_burned||0),0)} cal</strong> burned</span>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Weekly stats ── */}
                {weekStats && (
                  <div className="card exercise-week-card">
                    <div className="habit-panel-header">
                      <span className="habit-panel-title">7-Day Summary</span>
                    </div>
                    <div className="exercise-week-stats">
                      <div className="exercise-stat-box">
                        <span className="exercise-stat-val">{weekStats.sessions}</span>
                        <span className="exercise-stat-label">Sessions</span>
                      </div>
                      {weekStats.totalMins > 0 && (
                        <div className="exercise-stat-box">
                          <span className="exercise-stat-val">{weekStats.totalMins}</span>
                          <span className="exercise-stat-label">Minutes</span>
                        </div>
                      )}
                      {weekStats.totalCal > 0 && (
                        <div className="exercise-stat-box">
                          <span className="exercise-stat-val">{weekStats.totalCal}</span>
                          <span className="exercise-stat-label">Cal burned</span>
                        </div>
                      )}
                    </div>
                    {Object.keys(weekStats.byType).length > 0 && (
                      <div className="exercise-type-breakdown">
                        {Object.entries(weekStats.byType).sort((a,b) => b[1]-a[1]).map(([t, count]) => {
                          const meta = TYPE_META[t] || TYPE_META.other;
                          const pct  = weekStats.totalExercises > 0 ? count / weekStats.totalExercises : 0;
                          return (
                            <div key={t} className="exercise-type-row">
                              <span style={{ color: meta.color }}>{meta.icon} {meta.label}</span>
                              <div className="exercise-type-bar-wrap">
                                <div className="exercise-type-bar" style={{ width:`${(pct*100).toFixed(0)}%`, background: meta.color }} />
                              </div>
                              <span style={{ color: meta.color, fontFamily:"var(--font-mono)", fontSize:"0.75rem" }}>{count}×</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── AI Summary — full-width below both columns ── */}
                <div style={{ gridColumn: "1 / -1" }}>
                  <ExerciseAISummary date={selectedDate} hasEntries={dateEntries.length > 0} />
                </div>
              </div>
            )}
        </ErrorBoundary>
      </main>

      {showAdd && (
        <MultiExerciseForm
          onSave={handleAdded}
          onCancel={() => { setShowAdd(false); setAddDefaultGroup(null); }}
          date={selectedDate}
          defaultGroup={addDefaultGroup}
        />
      )}
      {showSaveModal && (
        <SaveRoutineModal
          todayEntries={dateEntries}
          onSave={handleRoutineSaved}
          onCancel={() => setShowSaveModal(false)}
        />
      )}
    </div>
  );
}
