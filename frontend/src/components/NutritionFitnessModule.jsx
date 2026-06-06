import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";
import FoodPhotoAnalyzer from "./FoodPhotoAnalyzer.jsx";
import TemplatesPanel from "./TemplatesPanel.jsx";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function toDateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function localDateISO() { return toDateISO(new Date()); }

const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const WEEK_DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

const MEAL_TYPES  = ["breakfast","lunch","dinner","snack"];
const MEAL_ICONS  = { breakfast:"🌅", lunch:"☀️", dinner:"🌙", snack:"🍎" };
const MEAL_LABELS = { breakfast:"Breakfast", lunch:"Lunch", dinner:"Dinner", snack:"Snacks" };
const MEAL_WEIGHTS = { breakfast:25, lunch:35, dinner:35, snack:5 };

function defaultMealType() {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 20) return "dinner";
  return "snack";
}

const TYPE_META = {
  cardio:      { icon:"🏃", color:"#f87171", label:"Cardio" },
  strength:    { icon:"💪", color:"#60a5fa", label:"Strength" },
  flexibility: { icon:"🤸", color:"#c084fc", label:"Flexibility" },
  sports:      { icon:"⚽", color:"#f59e0b", label:"Sports" },
  other:       { icon:"🏋️", color:"#8b949e", label:"Other" },
};

// ---------------------------------------------------------------------------
// DateNav — shared date navigator
// ---------------------------------------------------------------------------

function DateNav({ date, today, onChange }) {
  function shift(delta) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + delta);
    const next = toDateISO(d);
    if (next <= today) onChange(next);
  }

  const d       = new Date(date + "T12:00:00");
  const isToday = date === today;
  const label   = isToday ? "Today" : `${DAY_NAMES[d.getDay()]} · ${date}`;

  return (
    <div className="nf-date-nav">
      <button className="ex-date-nav-btn" onClick={() => shift(-1)}>‹</button>
      <div className="nf-date-nav-center">
        <span className="nf-date-nav-label">{label}</span>
        {!isToday && (
          <button className="ex-date-nav-today" onClick={() => onChange(today)}>↩ Today</button>
        )}
      </div>
      <button className="ex-date-nav-btn" onClick={() => shift(1)} disabled={isToday}>›</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CalorieDaySection
// ---------------------------------------------------------------------------

function CalorieDaySection({ date, goal, onGoalChange, isFuture, onMutated, prefillEntry, onPrefillConsumed }) {
  const [entries,          setEntries]          = useState([]);
  const [loading,          setLoading]          = useState(false);
  const [activeForm,       setActiveForm]       = useState(null);
  const [form,             setForm]             = useState({ food_name:"", calories:"", protein_g:"", carbs_g:"", fat_g:"" });
  const [saving,           setSaving]           = useState(false);
  const [error,            setError]            = useState(null);
  const [templates,        setTemplates]        = useState([]);
  const [showTemplates,    setShowTemplates]    = useState(false);
  const [showPhotoScanner, setShowPhotoScanner] = useState(false);

  const fetchEntries = useCallback(() => {
    if (!date) return;
    setLoading(true);
    fetch(`/api/food?date=${date}`)
      .then(r => r.json())
      .then(data => { setEntries(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [date]);

  const fetchTemplates = useCallback(() => {
    fetch("/api/food/templates")
      .then(r => r.json())
      .then(data => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchEntries(); setActiveForm(null); setError(null); }, [date, fetchEntries]);
  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  useEffect(() => {
    if (!prefillEntry) return;
    setForm({
      food_name: prefillEntry.food_name || "",
      calories:  prefillEntry.calories  != null ? String(prefillEntry.calories)  : "",
      protein_g: prefillEntry.protein_g != null ? String(prefillEntry.protein_g) : "",
      carbs_g:   prefillEntry.carbs_g   != null ? String(prefillEntry.carbs_g)   : "",
      fat_g:     prefillEntry.fat_g     != null ? String(prefillEntry.fat_g)     : "",
    });
    setActiveForm(defaultMealType());
    setError(null);
    onPrefillConsumed && onPrefillConsumed();
  }, [prefillEntry]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = useMemo(() => entries.reduce((s, e) => ({
    calories:  s.calories  + e.calories,
    protein_g: s.protein_g + (e.protein_g || 0),
    carbs_g:   s.carbs_g   + (e.carbs_g   || 0),
    fat_g:     s.fat_g     + (e.fat_g     || 0),
  }), { calories:0, protein_g:0, carbs_g:0, fat_g:0 }), [entries]);

  const byMeal = useMemo(() => {
    const m = { breakfast:[], lunch:[], dinner:[], snack:[] };
    entries.forEach(e => { (m[e.meal_type] ?? m.snack).push(e); });
    return m;
  }, [entries]);

  const mealBudgets = useMemo(() => {
    const remaining = goal - total.calories;
    if (remaining <= 0) return {};
    const mealCals  = t => (byMeal[t] || []).reduce((s, e) => s + e.calories, 0);
    const unlogged  = MEAL_TYPES.filter(t => mealCals(t) === 0);
    const logged    = MEAL_TYPES.filter(t => mealCals(t) > 0);
    const unloggedW = unlogged.reduce((s, t) => s + MEAL_WEIGHTS[t], 0);
    const budgets   = {};
    if (unloggedW > 0)
      unlogged.forEach(t => { budgets[t] = Math.round(remaining * MEAL_WEIGHTS[t] / unloggedW); });
    logged.forEach(t => { budgets[t] = Math.round(goal * MEAL_WEIGHTS[t] / 100); });
    return budgets;
  }, [goal, total.calories, byMeal]);

  function openForm(type) {
    setActiveForm(type);
    setForm({ food_name:"", calories:"", protein_g:"", carbs_g:"", fat_g:"" });
    setError(null);
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!form.food_name || !form.calories) return;
    setSaving(true); setError(null);
    const res = await fetch("/api/food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        food_name:  form.food_name,
        meal_type:  activeForm,
        entry_date: date,
        calories:   parseInt(form.calories, 10),
        protein_g:  form.protein_g ? parseFloat(form.protein_g) : null,
        carbs_g:    form.carbs_g   ? parseFloat(form.carbs_g)   : null,
        fat_g:      form.fat_g     ? parseFloat(form.fat_g)     : null,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setError(json.error || "Save failed"); return; }
    setEntries(prev => [...prev, json]);
    setActiveForm(null);
    onMutated();
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this food entry?")) return;
    setEntries(prev => prev.filter(e => e.id !== id));
    fetch(`/api/food/${id}`, { method:"DELETE" });
    onMutated();
  }

  async function handleApplyTemplate(templateId, mealType) {
    const res = await fetch(`/api/food/templates/${templateId}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry_date: date, meal_type: mealType }),
    });
    if (!res.ok) return;
    const created = await res.json();
    setEntries(prev => [...prev, ...(Array.isArray(created) ? created : [created])]);
    onMutated();
  }

  async function handleSaveTemplate(items, name, mealType) {
    const res = await fetch("/api/food/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, meal_type: mealType,
        items: items.map(i => ({
          food_name: i.food_name, calories: i.calories,
          protein_g: i.protein_g, carbs_g: i.carbs_g, fat_g: i.fat_g,
        })),
      }),
    });
    if (!res.ok) return false;
    const tpl = await res.json();
    setTemplates(prev => [...prev, tpl]);
    return true;
  }

  async function handleDeleteTemplate(templateId) {
    const res = await fetch(`/api/food/templates/${templateId}`, { method:"DELETE" });
    if (res.ok) setTemplates(prev => prev.filter(t => t.id !== templateId));
  }

  function handlePhotoAdd(entry) {
    setEntries(prev => [...prev, entry]);
    onMutated();
  }

  const pct       = goal > 0 ? total.calories / goal : 0;
  const pctColor  = pct > 1.1 ? "var(--danger)" : pct >= 0.9 ? "var(--success)" : "var(--accent)";
  const remaining = goal - total.calories;

  return (
    <>
    <div className="nf-panel card">
      <div className="nf-panel-header">
        <span className="nf-panel-icon">🥗</span>
        <span className="nf-panel-title">Calories</span>
        <div style={{ display:"flex", alignItems:"center", gap:"0.4rem", marginLeft:"auto" }}>
          {!isFuture && (
            <button
              className="photo-scan-btn"
              onClick={() => { setShowPhotoScanner(true); setActiveForm(null); setShowTemplates(false); }}
              title="Scan food photo with AI"
            >
              📷 Scan
            </button>
          )}
          <button
            className={`tpl-toggle-btn${showTemplates ? " active" : ""}`}
            onClick={() => { setShowTemplates(v => !v); setActiveForm(null); }}
          >
            📋 Templates{templates.length > 0 ? ` (${templates.length})` : ""}
            <span className="tpl-toggle-arrow">{showTemplates ? "▲" : "▼"}</span>
          </button>
          <input
            type="number"
            className="form-input nf-goal-input"
            value={goal}
            min={500} max={10000} step={50}
            onChange={e => onGoalChange(parseInt(e.target.value,10) || 2000)}
            title="Daily calorie goal"
          />
          <span style={{ fontSize:"0.7rem", color:"var(--text-dim)" }}>goal</span>
        </div>
      </div>

      {showTemplates && (
        <TemplatesPanel
          templates={templates}
          onApply={handleApplyTemplate}
          onDelete={handleDeleteTemplate}
          onSave={handleSaveTemplate}
          isFuture={isFuture}
          byMeal={byMeal}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {/* Calorie summary bar */}
      <div className="nf-cal-summary">
        <div className="nf-cal-nums">
          <span className="nf-cal-total" style={{ color: pctColor }}>{total.calories}</span>
          <span className="nf-cal-sep">/</span>
          <span className="nf-cal-goal">{goal} cal</span>
        </div>
        <div className="nf-cal-bar-track">
          <div className="nf-cal-bar-fill" style={{ width:`${Math.min(pct*100,100).toFixed(1)}%`, background:pctColor }} />
        </div>
        <div className="nf-cal-sub-row">
          {!isFuture && remaining > 0 && <span style={{ color:"var(--accent)" }}>{remaining} remaining</span>}
          {!isFuture && remaining < 0 && <span style={{ color:"var(--danger)" }}>{Math.abs(remaining)} over</span>}
          {total.protein_g > 0 && <span style={{ color:"var(--text-dim)" }}>P {Math.round(total.protein_g)}g</span>}
          {total.carbs_g   > 0 && <span style={{ color:"var(--text-dim)" }}>C {Math.round(total.carbs_g)}g</span>}
          {total.fat_g     > 0 && <span style={{ color:"var(--text-dim)" }}>F {Math.round(total.fat_g)}g</span>}
        </div>
      </div>

      {loading
        ? <div className="brief-loading"><span className="spinner" /> Loading…</div>
        : (
          <div className="nf-meals">
            {MEAL_TYPES.map(type => {
              const items    = byMeal[type] || [];
              const mealCals = items.reduce((s, i) => s + i.calories, 0);
              const budget   = mealBudgets[type];
              const mpct     = budget > 0 ? mealCals / budget : 0;
              const isOpen   = activeForm === type;

              return (
                <div key={type} className="nf-meal">
                  <div className="nf-meal-header">
                    <span className="nf-meal-icon">{MEAL_ICONS[type]}</span>
                    <span className="nf-meal-label">{MEAL_LABELS[type]}</span>
                    {mealCals > 0 && (
                      <span className="nf-meal-cals" style={{ color: mpct > 1.1 ? "var(--danger)" : mpct >= 0.9 ? "var(--success)" : "var(--text-muted)" }}>
                        {mealCals}{budget ? ` / ${budget}` : ""} cal
                      </span>
                    )}
                    {!isFuture && (
                      <button
                        className={`nf-meal-add-btn${isOpen ? " open" : ""}`}
                        onClick={() => openForm(isOpen ? null : type)}
                      >{isOpen ? "✕" : "+"}</button>
                    )}
                  </div>

                  {items.length === 0 && !isOpen && (
                    <div className="nf-meal-empty">
                      {!isFuture ? <span style={{ color:"var(--text-dim)", fontSize:"0.72rem" }}>Nothing logged</span> : null}
                      {budget > 0 && !isOpen && !isFuture && items.length === 0 && (
                        <span style={{ color:"var(--text-dim)", fontSize:"0.72rem" }}> · ~{budget} cal</span>
                      )}
                    </div>
                  )}

                  {items.map(item => (
                    <div key={item.id} className="nf-food-row">
                      <span className="nf-food-name">{item.food_name}</span>
                      <span className="nf-food-cal">{item.calories}</span>
                      {!isFuture && (
                        <button className="nf-food-del" onClick={() => handleDelete(item.id)}>✕</button>
                      )}
                    </div>
                  ))}

                  {isOpen && (
                    <form className="nf-food-form" onSubmit={handleAdd}>
                      <input className="form-input" placeholder="Food name" value={form.food_name}
                        onChange={e => setForm(f => ({...f, food_name:e.target.value}))} required autoFocus />
                      <div className="nf-food-form-row">
                        <input className="form-input" type="number" min="0" max="10000"
                          placeholder="Calories" value={form.calories}
                          onChange={e => setForm(f => ({...f, calories:e.target.value}))} required />
                        <input className="form-input" type="number" min="0" step="0.1"
                          placeholder="Protein g" value={form.protein_g}
                          onChange={e => setForm(f => ({...f, protein_g:e.target.value}))} />
                        <input className="form-input" type="number" min="0" step="0.1"
                          placeholder="Carbs g" value={form.carbs_g}
                          onChange={e => setForm(f => ({...f, carbs_g:e.target.value}))} />
                        <input className="form-input" type="number" min="0" step="0.1"
                          placeholder="Fat g" value={form.fat_g}
                          onChange={e => setForm(f => ({...f, fat_g:e.target.value}))} />
                      </div>
                      {error && <div className="alert alert-error" style={{ fontSize:"0.75rem", padding:"0.3rem 0.6rem" }}>✗ {error}</div>}
                      <div style={{ display:"flex", gap:"0.4rem" }}>
                        <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex:1, fontSize:"0.8rem", padding:"0.4rem" }}>
                          {saving ? "Saving…" : "Add"}
                        </button>
                        <button type="button" className="btn btn-ghost" style={{ fontSize:"0.8rem", padding:"0.4rem" }}
                          onClick={() => openForm(null)}>Cancel</button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </div>

    {showPhotoScanner && (
      <FoodPhotoAnalyzer
        date={date}
        onAdd={handlePhotoAdd}
        onClose={() => setShowPhotoScanner(false)}
      />
    )}
    </>
  );
}

// ---------------------------------------------------------------------------
// ExerciseLogForm — inline modal for logging exercise
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

    if (isStrength) {
      const validRows = rows.filter(r => r.name.trim());
      if (!validRows.length) {
        setAiError("Enter at least one exercise name first.");
        setAiLoading(false);
        return;
      }
      const res = await fetch("/api/exercise/estimate-calories", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          exercises: validRows.map(r => ({
            name:       r.name.trim(),
            sets:       r.sets   ? parseInt(r.sets, 10)   : null,
            reps:       r.reps   ? parseInt(r.reps, 10)   : null,
            weight_lbs: r.weight ? parseFloat(r.weight)   : null,
          })),
        }),
      });
      const json = await res.json();
      setAiLoading(false);
      if (!res.ok) { setAiError(json.error || "Failed to estimate"); return; }
      // Auto-fill calories for each matching row
      setRows(prev => prev.map(r => {
        const match = json.exercises?.find(
          e => e.name.toLowerCase() === r.name.trim().toLowerCase()
        );
        return match ? { ...r, calories: String(match.calories) } : r;
      }));
      setAiSummary(`~${json.total} cal estimated. ${json.note || ""}`);
    } else {
      const res = await fetch("/api/exercise/ai-summary", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ date }),
      });
      const json = await res.json();
      setAiLoading(false);
      if (!res.ok) { setAiError(json.error || "Failed to generate"); return; }
      setAiSummary(json.summary);
    }
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

        <div className={`mef-headers${isStrength ? " mef-4col" : ""}`}>
          <span className="mef-col-name">Exercise Name</span>
          {isStrength ? (
            <><span className="mef-col-num">Sets</span><span className="mef-col-num">Reps</span><span className="mef-col-num">Lbs</span><span className="mef-col-num">Cal</span></>
          ) : (
            <><span className="mef-col-num">Min</span><span className="mef-col-num">Effort</span><span className="mef-col-num">Cal</span></>
          )}
          <span className="mef-col-del" />
        </div>

        <div className={`mef-rows${isStrength ? " mef-4col" : ""}`}>
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
                  <input className="form-input mef-col-num" type="number" min="0"
                    placeholder="—" value={r.calories} onChange={e => updateRow(i, "calories", e.target.value)}
                    title="Calories burned (⚡ AI Estimate to auto-fill)" />
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

        <div className="mef-ai-section">
          <button type="button" className="mef-ai-btn" onClick={generateAI} disabled={aiLoading}>
            {aiLoading ? <><span className="spinner" style={{ width:11,height:11 }} /> Estimating…</> : isStrength ? "⚡ Estimate Calories" : "⚡ AI Summary"}
          </button>
          {!aiSummary && !aiLoading && !aiError && (
            <span className="mef-ai-hint">
              {isStrength ? "Auto-fill Cal column with AI estimates per exercise" : "Estimate calories burned from today's logged exercises"}
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
// ExerciseAISummary
// ---------------------------------------------------------------------------

function ExerciseAISummary({ date, hasEntries }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

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
// ExerciseDaySection
// ---------------------------------------------------------------------------

function ExerciseDaySection({ date, isFuture, onChanged }) {
  const [entries,         setEntries]         = useState([]);
  const [loading,         setLoading]         = useState(false);
  const [showAdd,         setShowAdd]         = useState(false);
  const [addDefaultGroup, setAddDefaultGroup] = useState(null);
  const [renamingGroup,   setRenamingGroup]   = useState(null);
  const [renameValue,     setRenameValue]     = useState("");
  const [showNewGroup,    setShowNewGroup]    = useState(false);
  const [newGroupName,    setNewGroupName]    = useState("");
  const newGroupRef = useRef(null);

  const grouped = useMemo(() => {
    const order = []; const map = {};
    entries.forEach(e => {
      const key = e.group_name || "__none__";
      if (!map[key]) { map[key] = []; order.push(key); }
      map[key].push(e);
    });
    return { order, map };
  }, [entries]);

  const fetchEntries = useCallback(() => {
    setLoading(true);
    fetch(`/api/exercise?date=${date}`)
      .then(r => r.json())
      .then(data => { setEntries(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [date]);

  useEffect(() => {
    fetchEntries();
    setShowAdd(false);
    setRenamingGroup(null);
    setShowNewGroup(false);
  }, [date, fetchEntries]);

  useEffect(() => { if (showNewGroup) newGroupRef.current?.focus(); }, [showNewGroup]);

  async function handleDelete(id) {
    if (!window.confirm("Delete this exercise?")) return;
    await fetch(`/api/exercise/${id}`, { method:"DELETE" });
    setEntries(prev => prev.filter(e => e.id !== id));
    onChanged?.();
  }

  function handleAdded(entries) {
    setEntries(prev => [...prev, ...entries]);
    setShowAdd(false);
    setAddDefaultGroup(null);
    onChanged?.();
  }

  function openAddForGroup(groupKey) {
    setAddDefaultGroup(groupKey === "__none__" ? null : groupKey);
    setShowAdd(true);
  }

  function startRename(key) {
    setRenamingGroup(key);
    setRenameValue(key === "__none__" ? "" : key);
  }

  async function saveRename() {
    if (!renamingGroup) return;
    const newName = renameValue.trim();
    const oldName = renamingGroup === "__none__" ? null : renamingGroup;
    if (newName === (oldName || "")) { setRenamingGroup(null); return; }
    await fetch("/api/exercise/rename-group", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ date, old_name: oldName || "", new_name: newName || null }),
    });
    setRenamingGroup(null);
    fetchEntries();
  }

  function handleRenameKey(e) {
    if (e.key === "Enter")  { e.preventDefault(); saveRename(); }
    if (e.key === "Escape") { setRenamingGroup(null); }
  }

  function handleNewGroupKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const name = newGroupName.trim();
      setShowNewGroup(false); setNewGroupName("");
      setAddDefaultGroup(name || null);
      setShowAdd(true);
    }
    if (e.key === "Escape") { setShowNewGroup(false); setNewGroupName(""); }
  }

  const totalMins = entries.reduce((s, e) => s + e.duration_minutes, 0);
  const totalCal  = entries.reduce((s, e) => s + (e.calories_burned || 0), 0);

  return (
    <>
      <div className="nf-panel card">
        <div className="nf-panel-header">
          <span className="nf-panel-icon">🏋️</span>
          <span className="nf-panel-title">Exercise</span>
          {!isFuture && (
            <button className="btn btn-primary btn-sm" style={{ marginLeft:"auto" }}
              onClick={() => { setAddDefaultGroup(null); setShowAdd(true); }}>+ Log</button>
          )}
        </div>

        {loading
          ? <div className="brief-loading"><span className="spinner" /> Loading…</div>
          : entries.length === 0
            ? (
              <div className="nf-ex-empty">
                {isFuture
                  ? <span style={{ color:"var(--text-dim)" }}>Future date</span>
                  : <span>No workouts logged. Hit <strong>+ Log</strong> to add one.</span>}
              </div>
            )
            : (
              <div className="ex-grouped-list">
                {grouped.order.map(key => {
                  const groupEntries = grouped.map[key];
                  const isNone       = key === "__none__";
                  const isRenaming   = renamingGroup === key;
                  return (
                    <div key={key} className="ex-group">
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
                        {!isRenaming && !isFuture && (
                          <button className="ex-group-rename-btn" onClick={() => startRename(key)} title="Rename group">✎</button>
                        )}
                        {!isFuture && (
                          <button className="ex-group-add-btn" onClick={() => openAddForGroup(key)}>+ Add</button>
                        )}
                      </div>
                      {groupEntries.map(e => {
                        const meta       = TYPE_META[e.exercise_type] || TYPE_META.other;
                        const isStrength = e.exercise_type === "strength" && e.sets;
                        const detail     = isStrength
                          ? `${e.sets}×${e.reps ?? "?"}${e.weight_lbs ? ` @ ${e.weight_lbs} lbs` : ""}`
                          : `${e.duration_minutes} min${e.intensity ? ` · ${e.intensity}/10` : ""}`;
                        return (
                          <div key={e.id} className="nf-ex-item">
                            <span className="nf-ex-icon" style={{ color:meta.color }}>{meta.icon}</span>
                            <div className="nf-ex-info">
                              <span className="nf-ex-name">{e.name}</span>
                              <span className="nf-ex-meta">
                                {meta.label} · {detail}
                                {e.calories_burned ? ` · ~${e.calories_burned} cal` : ""}
                              </span>
                            </div>
                            {!isFuture && (
                              <button className="nf-ex-del" onClick={() => handleDelete(e.id)}>✕</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

        {!isFuture && entries.length > 0 && (
          showNewGroup ? (
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
            <button className="ex-new-group-btn" onClick={() => setShowNewGroup(true)}>
              ＋ New Group
            </button>
          )
        )}

        {totalMins > 0 && (
          <div className="nf-ex-totals">
            <span>{totalMins} min total</span>
            {totalCal > 0 && <span>~{totalCal} cal burned</span>}
          </div>
        )}
      </div>

      <ExerciseAISummary date={date} hasEntries={entries.length > 0} />

      {showAdd && (
        <MultiExerciseForm
          date={date}
          defaultGroup={addDefaultGroup}
          onSave={handleAdded}
          onCancel={() => { setShowAdd(false); setAddDefaultGroup(null); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// NutritionChatbot
// ---------------------------------------------------------------------------

const CHAT_CHIPS = [
  "Am I on track today?",
  "What can I eat for dinner?",
  "High protein snack under 400 cal?",
  "Suggest a meal for my remaining calories",
];

function NutritionChatbot({ goal, consumed, burned, date, onDraftEntry }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "I'm your nutrition coach. Ask me what to eat, whether you're on track, or anything about food and calories.",
    },
  ]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const msgsEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(text) {
    const userText = text.trim();
    if (!userText || loading) return;

    const history = messages.map(m => ({ role: m.role, content: m.content }));
    const nextMessages = [...messages, { role: "user", content: userText }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/food/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          history,
          calorie_goal: goal,
          consumed,
          burned,
          date,
          today_logged: consumed > 0
            ? `${consumed} cal consumed, ${goal - consumed + burned} remaining`
            : "",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed");
      setMessages(prev => [...prev, { role: "assistant", content: json.reply ?? json.message ?? "", drafts: json.drafts || [] }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div className="nf-chat-card card">
      <div className="nf-panel-header" style={{ marginBottom:"0.5rem" }}>
        <span className="nf-panel-icon">🤖</span>
        <span className="nf-panel-title">Nutrition Coach</span>
        {consumed > 0 && (
          <span style={{ marginLeft:"auto", fontSize:"0.72rem", color:"var(--text-dim)" }}>
            {consumed} consumed · {burned > 0 ? `${burned} burned · ` : ""}{goal - consumed + burned} remaining
          </span>
        )}
      </div>

      {/* Messages area */}
      <div className="nf-chat-msgs">
        {messages.map((msg, i) => (
          <div key={i} className={`nf-chat-msg ${msg.role}`}>
            {msg.role === "assistant" && (
              <span className="nf-chat-avatar">🤖</span>
            )}
            <div className="chat-msg-col">
              <div className="nf-chat-bubble">{msg.content}</div>
              {msg.drafts && msg.drafts.length > 0 && (
                <div className="chat-draft-btns">
                  {msg.drafts.map((d, di) => (
                    <button
                      key={di}
                      className="chat-draft-btn"
                      onClick={() => onDraftEntry && onDraftEntry(d)}
                      title="Pre-fill food log form with this item"
                    >
                      ➕ {d.food_name} · {d.calories} cal → Log
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="nf-chat-msg assistant">
            <span className="nf-chat-avatar">🤖</span>
            <div className="nf-chat-typing">
              <span /><span /><span />
            </div>
          </div>
        )}

        {error && (
          <div className="nf-chat-msg assistant">
            <span className="nf-chat-avatar">🤖</span>
            <div className="nf-chat-bubble" style={{ color:"var(--danger)" }}>
              Sorry, something went wrong: {error}
            </div>
          </div>
        )}

        <div ref={msgsEndRef} />
      </div>

      {/* Quick chips */}
      {messages.length <= 2 && (
        <div className="nf-chat-chips">
          {CHAT_CHIPS.map(chip => (
            <button
              key={chip}
              className="nf-chat-chip"
              onClick={() => sendMessage(chip)}
              disabled={loading}
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="nf-chat-input-row">
        <textarea
          ref={textareaRef}
          className="nf-chat-textarea form-input"
          rows={1}
          placeholder="Ask about food, calories, meals…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          className="btn btn-primary nf-chat-send"
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
        >
          ➤
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WeeklyStrip — energy balance: consumed − burned = net vs goal
// ---------------------------------------------------------------------------

const TRACK_H = 76; // px — represents one day's calorie goal

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function weekLabel(monday, weekOffset) {
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  if (weekOffset === 0) return "This Week";
  const fmt = d => `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
  const yearSuffix = sunday.getFullYear() !== new Date().getFullYear()
    ? ` ${sunday.getFullYear()}` : "";
  return `${fmt(monday)} – ${fmt(sunday)}${yearSuffix}`;
}

function WeeklyStrip({ calSummary, goal, burnedByDay }) {
  const [weekOffset, setWeekOffset] = useState(0);

  const now      = new Date();
  const todayStr = toDateISO(now);

  // Monday of the current week
  const dow         = now.getDay();
  const baseOffset  = dow === 0 ? -6 : 1 - dow;
  const curMonday   = new Date(now);
  curMonday.setDate(now.getDate() + baseOffset);
  curMonday.setHours(0,0,0,0);

  // Monday of the viewed week (shifted by weekOffset weeks)
  const monday = new Date(curMonday);
  monday.setDate(curMonday.getDate() + weekOffset * 7);

  const weekDays = Array.from({ length:7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i); return toDateISO(d);
  });

  const trackedDays   = weekDays.filter(d => d <= todayStr);
  const totalConsumed = trackedDays.reduce((s, d) => s + (calSummary[d]?.calories || 0), 0);
  const totalBurned   = trackedDays.reduce((s, d) => s + (burnedByDay?.[d] || 0), 0);
  const netIntake     = totalConsumed - totalBurned;
  const goalSoFar     = goal * trackedDays.length;
  const weekBalance   = netIntake - goalSoFar;
  const isSurplus     = weekBalance > 0;
  const isCurrentWeek = weekOffset === 0;

  return (
    <div className="nf-week-strip card">
      <div className="nf-eb-header">
        <div style={{ flex:1 }}>
          <span className="nf-eb-title">⚡ Weekly Energy Balance</span>
          <span className="nf-eb-sub"> · {trackedDays.length}/7 days · {goal.toLocaleString()} cal/day goal</span>
        </div>
        <div className="nf-week-nav">
          <button className="ex-date-nav-btn" onClick={() => setWeekOffset(o => o - 1)}>‹</button>
          <span className={`nf-week-nav-label${isCurrentWeek ? " is-current" : ""}`}>
            {weekLabel(monday, weekOffset)}
          </span>
          {!isCurrentWeek && (
            <button className="ex-date-nav-today" onClick={() => setWeekOffset(0)}>↩ Now</button>
          )}
          <button className="ex-date-nav-btn" onClick={() => setWeekOffset(o => o + 1)} disabled={isCurrentWeek}>›</button>
        </div>
      </div>

      {/* Day bars */}
      <div className="nf-eb-bars">
        {weekDays.map((dk, i) => {
          const consumed = calSummary[dk]?.calories || 0;
          const burned   = burnedByDay?.[dk] || 0;
          const net      = Math.max(consumed - burned, 0);
          const isPast   = dk <= todayStr;
          const isToday  = dk === todayStr;
          const isFuture = dk > todayStr;
          const hasData  = isPast && consumed > 0;

          const overGoal = net > goal * 1.05;
          const nearGoal = net >= goal * 0.85 && !overGoal;
          const netColor = overGoal ? "var(--danger)" : nearGoal ? "var(--success)" : "var(--accent)";

          // Scale: goal = TRACK_H px. Cap total bar at TRACK_H.
          const scale    = goal > 0 ? TRACK_H / goal : 0;
          const totalBarH = hasData ? Math.min(consumed * scale, TRACK_H) : 0;
          // Burned shown as fraction of the bar (capped at 45% so net always visible)
          const burnedBarH = hasData && burned > 0
            ? Math.min(burned * scale, totalBarH * 0.45)
            : 0;
          const netBarH   = totalBarH - burnedBarH;

          return (
            <div key={dk} className={`nf-eb-day${isToday ? " today" : ""}${isFuture ? " future" : ""}`}>
              {/* Bar: flex column-reverse → first child at bottom, second on top */}
              <div className="nf-eb-bar-track" style={{ height: TRACK_H }}>
                {hasData && (
                  <>
                    <div className="nf-eb-bar-net"    style={{ height: netBarH,    background: netColor }} />
                    {burnedBarH > 0 && (
                      <div className="nf-eb-bar-burned" style={{ height: burnedBarH }} />
                    )}
                  </>
                )}
              </div>

              <div className={`nf-eb-day-label${isToday ? " is-today" : ""}`}>{WEEK_DAY_LABELS[i]}</div>

              <div className="nf-eb-day-nums">
                {isFuture || !hasData
                  ? <span className="nf-eb-dim">—</span>
                  : <>
                      <span className="nf-eb-net-num" style={{ color: netColor }}>
                        {net > 999 ? `${(net/1000).toFixed(1)}k` : net}
                      </span>
                      {burned > 0 && (
                        <span className="nf-eb-burned-num">
                          −{burned > 999 ? `${(burned/1000).toFixed(1)}k` : burned}🔥
                        </span>
                      )}
                    </>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="nf-eb-legend">
        <span><span className="nf-eb-swatch" style={{ background:"var(--accent)" }} />Net intake</span>
        <span><span className="nf-eb-swatch" style={{ background:"rgba(192,132,252,0.75)" }} />Exercise burned</span>
        <span className="nf-eb-legend-note">Top of bar = daily goal</span>
      </div>

      {/* Equation row */}
      <div className="nf-eb-equation">
        <div className="nf-eb-eq-col">
          <span className="nf-eb-eq-num">{totalConsumed.toLocaleString()}</span>
          <span className="nf-eb-eq-label">consumed</span>
        </div>

        <span className="nf-eb-eq-op">−</span>

        <div className="nf-eb-eq-col">
          <span className="nf-eb-eq-num" style={{ color:"#c084fc" }}>{totalBurned.toLocaleString()}</span>
          <span className="nf-eb-eq-label">burned</span>
        </div>

        <span className="nf-eb-eq-op">=</span>

        <div className="nf-eb-eq-col">
          <span className="nf-eb-eq-num">{netIntake.toLocaleString()}</span>
          <span className="nf-eb-eq-label">net intake</span>
        </div>

        <div className="nf-eb-eq-vs">
          vs <strong>{goalSoFar.toLocaleString()}</strong>
          <span style={{ color:"var(--text-dim)" }}> goal</span>
        </div>

        <div className={`nf-eb-balance${isSurplus ? " surplus" : " deficit"}`}>
          <span className="nf-eb-balance-num">{isSurplus ? "+" : "−"}{Math.abs(weekBalance).toLocaleString()}</span>
          <span className="nf-eb-balance-label">{isSurplus ? "surplus" : "deficit"}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DailyCombinedSummary — consumed − burned = net vs goal for the selected day
// ---------------------------------------------------------------------------

function DailyCombinedSummary({ date, calSummary, burnedByDay, goal }) {
  const consumed  = calSummary[date]?.calories || 0;
  const burned    = burnedByDay[date] || 0;
  const net       = consumed - burned;
  const remaining = goal - net;
  const isOver    = remaining < 0;

  return (
    <div className="nf-combined-bar">
      <div className="nf-cb-col">
        <span className="nf-cb-val">{consumed > 0 ? consumed.toLocaleString() : "—"}</span>
        <span className="nf-cb-label">eaten</span>
      </div>

      <span className="nf-cb-op">−</span>

      <div className="nf-cb-col">
        <span className="nf-cb-val nf-cb-burned">{burned > 0 ? burned.toLocaleString() : "—"}</span>
        <span className="nf-cb-label">burned 🔥</span>
      </div>

      <span className="nf-cb-op">=</span>

      <div className="nf-cb-col">
        <span className="nf-cb-val">{consumed > 0 ? net.toLocaleString() : "—"}</span>
        <span className="nf-cb-label">net</span>
      </div>

      <div className="nf-cb-sep" />

      <div className="nf-cb-goal">
        <span className="nf-cb-goal-label">goal</span>
        <span className="nf-cb-goal-val">{goal.toLocaleString()}</span>
      </div>

      {consumed > 0 && (
        <div className={`nf-cb-remain${isOver ? " over" : ""}`}>
          <span className="nf-cb-remain-val">
            {isOver ? "+" : ""}{Math.abs(remaining).toLocaleString()}
          </span>
          <span className="nf-cb-remain-label">{isOver ? "over goal" : "remaining"}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NutritionFitnessModule
// ---------------------------------------------------------------------------

const DEFAULT_GOAL = 2000;

export default function NutritionFitnessModule({ onBack, onOpenCalories, onOpenExercise }) {
  const today = localDateISO();

  const [date,         setDate]         = useState(today);
  const [goal,         setGoal]         = useState(() => parseInt(localStorage.getItem("cal_goal") || DEFAULT_GOAL, 10));
  const [calSummary,   setCalSummary]   = useState({});
  const [burnedByDay,  setBurnedByDay]  = useState({});
  const [calRefresh,   setCalRefresh]   = useState(0);
  const [pendingDraft, setPendingDraft] = useState(null);

  const isFuture = date > today;

  // Sync goal from backend profile on mount (overrides localStorage if profile has a value)
  useEffect(() => {
    fetch("/api/profile")
      .then(r => r.json())
      .then(d => {
        const serverGoal = d?.profile?.calorie_goal;
        if (serverGoal && serverGoal >= 500) {
          setGoal(serverGoal);
          localStorage.setItem("cal_goal", String(serverGoal));
        }
      })
      .catch(() => {});
  }, []);

  const fetchCalSummary = useCallback(() => {
    fetch("/api/food/daily-summary")
      .then(r => r.json())
      .then(data => setCalSummary(data))
      .catch(() => {});
  }, []);

  const fetchWeekEx = useCallback(async () => {
    const r   = await fetch("/api/exercise?limit=500");
    const all = await r.json();
    const byCal = {};
    all.forEach(e => { byCal[e.entry_date] = (byCal[e.entry_date] || 0) + (e.calories_burned || 0); });
    setBurnedByDay(byCal);
  }, []);

  useEffect(() => {
    fetchCalSummary();
    fetchWeekEx();
  }, [fetchCalSummary, fetchWeekEx, calRefresh]);

  function handleGoalChange(val) {
    setGoal(val);
    localStorage.setItem("cal_goal", val);
    fetch("/api/profile/calorie-goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calorie_goal: val }),
    }).catch(() => {});
  }

  const selectedConsumed = calSummary[date]?.calories || 0;
  const selectedBurned   = burnedByDay[date] || 0;

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <button className="back-btn" onClick={onBack}>← Hub</button>
          <div className="brand">
            <span className="brand-icon">⚡</span>
            <div>
              <div className="brand-name">Nutrition & Fitness</div>
              <div className="brand-sub">DAILY LOG · calories & workouts</div>
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:"0.5rem" }}>
          {onOpenCalories && (
            <button className="nf-full-link" onClick={onOpenCalories} title="Full calorie tracker with calendar & AI">
              🥗 Full View
            </button>
          )}
          {onOpenExercise && (
            <button className="nf-full-link" onClick={onOpenExercise} title="Full exercise tracker with routines">
              🏋️ Full View
            </button>
          )}
        </div>
      </header>

      <main style={{ maxWidth:1100, margin:"0 auto", padding:"1.25rem 1.5rem" }}>
        <ErrorBoundary>
          <DateNav date={date} today={today} onChange={setDate} />

          <DailyCombinedSummary
            date={date}
            calSummary={calSummary}
            burnedByDay={burnedByDay}
            goal={goal}
          />

          <div className="nf-day-grid">
            <CalorieDaySection
              date={date}
              goal={goal}
              onGoalChange={handleGoalChange}
              isFuture={isFuture}
              onMutated={() => { setCalRefresh(k => k + 1); }}
              prefillEntry={pendingDraft}
              onPrefillConsumed={() => setPendingDraft(null)}
            />
            <ExerciseDaySection
              date={date}
              isFuture={isFuture}
              onChanged={() => { setCalRefresh(k => k + 1); }}
            />
          </div>

          <NutritionChatbot
            goal={goal}
            consumed={selectedConsumed}
            burned={selectedBurned}
            date={date}
            onDraftEntry={setPendingDraft}
          />

          <WeeklyStrip
            calSummary={calSummary}
            goal={goal}
            burnedByDay={burnedByDay}
          />
        </ErrorBoundary>
      </main>
    </div>
  );
}
