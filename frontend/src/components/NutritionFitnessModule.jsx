import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";
import FoodPhotoAnalyzer from "./FoodPhotoAnalyzer.jsx";
import TemplatesPanel from "./TemplatesPanel.jsx";
import {
  PROTEIN_MEAL_WEIGHTS, MAIN_MEALS, pacificParts, mealProteinStatus, cutoffLabel,
} from "./proteinTiming.mjs";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function toDateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function localDateISO() { return toDateISO(new Date()); }

const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const MEAL_TYPES  = ["breakfast","lunch","dinner","snack"];
const MEAL_ICONS  = { breakfast:"🌅", lunch:"☀️", dinner:"🌙", snack:"🍎" };
const MEAL_LABELS = { breakfast:"Breakfast", lunch:"Lunch", dinner:"Dinner", snack:"Snacks" };
const MEAL_WEIGHTS = { breakfast:25, lunch:35, dinner:35, snack:5 };
// PROTEIN_MEAL_WEIGHTS + Pacific-time meal-skip logic live in ./proteinTiming.mjs

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
// ProteinTracker — target = body weight in lbs (1g protein per lb).
// Flags meals lacking protein (skipped/under-target) and grams left in the day.
// ---------------------------------------------------------------------------

function ProteinTracker({ byMeal, totalProtein, target, weightSource, onSetWeight, date }) {
  const [editWeight, setEditWeight] = useState("");

  // Realtime Pacific clock — re-evaluate "skipped vs upcoming" as time passes.
  const [pacific, setPacific] = useState(() => pacificParts());
  useEffect(() => {
    const id = setInterval(() => setPacific(pacificParts()), 30000); // every 30s
    return () => clearInterval(id);
  }, []);

  // No body weight yet → let the user set it so we can derive the target.
  if (!target) {
    return (
      <div className="nf-protein">
        <div className="nf-protein-head">
          <span className="nf-protein-title">💪 Protein</span>
        </div>
        <div className="nf-protein-setup">
          <span>Target <strong>1g protein per lb</strong> — enter your body weight:</span>
          <div className="nf-protein-setup-row">
            <input
              className="form-input" type="number" min="50" max="600" step="1"
              placeholder="Weight (lb)" value={editWeight}
              onChange={e => setEditWeight(e.target.value)}
            />
            <button
              className="btn btn-primary btn-sm" disabled={!editWeight}
              onClick={() => { const w = parseFloat(editWeight); if (w > 0) onSetWeight(w); }}
            >Set</button>
          </div>
        </div>
      </div>
    );
  }

  const consumed   = Math.round(totalProtein || 0);
  const remaining  = Math.max(0, target - consumed);
  const pct        = target > 0 ? consumed / target : 0;
  const statusCls  = pct >= 1 ? "good" : pct >= 0.6 ? "mid" : "low";

  const mealProtein = t => Math.round((byMeal[t] || []).reduce((s, e) => s + (e.protein_g || 0), 0));

  // Per-meal status is Pacific-time-aware: a main meal with nothing logged is
  // only "skipped" once its PST cutoff has passed (e.g. breakfast after noon).
  const statusOf = t => mealProteinStatus({
    mealKey: t, grams: mealProtein(t), dayTarget: target, selectedDate: date, pacific,
  });

  const skippedNames  = MAIN_MEALS.filter(t => statusOf(t).status === "skipped");
  const upcomingNames = MAIN_MEALS.filter(t => statusOf(t).status === "upcoming");
  const perNext       = upcomingNames.length ? Math.ceil(remaining / upcomingNames.length) : null;
  const joinMeals     = arr => arr.map(s => MEAL_LABELS[s]).join(" & ");

  let note;
  if (consumed >= target) {
    note = `✅ Protein goal hit — ${consumed}g of ${target}g.`;
  } else if (skippedNames.length) {
    note = `Skipped ${joinMeals(skippedNames)}. ${remaining}g left today`
         + (perNext ? ` — aim ~${perNext}g at ${joinMeals(upcomingNames)}.` : ".");
  } else if (upcomingNames.length) {
    note = `${remaining}g protein left — aim ~${perNext}g across ${joinMeals(upcomingNames)}.`;
  } else {
    note = `${remaining}g protein left today.`;
  }

  return (
    <div className="nf-protein">
      <div className="nf-protein-head">
        <span className="nf-protein-title">💪 Protein</span>
        <span className="nf-protein-target">
          <span className={`nf-protein-consumed ${statusCls}`}>{consumed}</span>
          <span className="nf-protein-sep">/</span>{target}g
        </span>
        <span className="nf-protein-target-note">
          {target}g = body weight{weightSource === "manual" ? " (set)" : ""}
        </span>
      </div>

      <div className="nf-protein-bar-track">
        <div className={`nf-protein-bar-fill ${statusCls}`} style={{ width: `${Math.min(pct * 100, 100).toFixed(1)}%` }} />
      </div>

      <div className={`nf-protein-remaining ${statusCls}`}>
        {remaining > 0
          ? <><strong>{remaining}g</strong> needed left today</>
          : <><strong>Goal met</strong> — {consumed}g 💪</>}
      </div>

      {/* Per-meal protein with Pacific-time-aware gap flags */}
      <div className="nf-protein-meals">
        {MEAL_TYPES.map(t => {
          const g = mealProtein(t);
          const { status, tgt } = statusOf(t);
          const cls = status === "good" ? "good"
                    : status === "low"  ? "low"
                    : status === "skipped" ? "skip"
                    : status === "upcoming" ? "upcoming" : "snack";
          return (
            <div key={t} className={`nf-protein-meal ${cls}`}>
              <span className="nf-protein-meal-icon">{MEAL_ICONS[t]}</span>
              <span className="nf-protein-meal-name">{MEAL_LABELS[t]}</span>
              <span className="nf-protein-meal-g">{g}{tgt > 0 ? `/${tgt}` : ""}g</span>
              {status === "skipped"  && <span className="nf-protein-flag skip">{g > 0 ? "low" : "skipped"} +{tgt - g}g</span>}
              {status === "low"      && <span className="nf-protein-flag low">need +{tgt - g}g</span>}
              {status === "upcoming" && <span className="nf-protein-flag upcoming">by {cutoffLabel(t)}</span>}
              {status === "good"     && <span className="nf-protein-flag good">✓</span>}
            </div>
          );
        })}
      </div>

      <div className={`nf-protein-note ${statusCls}`}>{note}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CalorieDaySection
// ---------------------------------------------------------------------------

function CalorieDaySection({ date, goal, onGoalChange, isFuture, onMutated, prefillEntry, onPrefillConsumed, proteinTarget, weightSource, onSetWeight }) {
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

      {!isFuture && (
        <ProteinTracker
          byMeal={byMeal}
          totalProtein={total.protein_g}
          target={proteinTarget}
          weightSource={weightSource}
          onSetWeight={onSetWeight}
          date={date}
        />
      )}

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
// EnergyBalanceExplorer — all-time energy balance, filterable by week/month/year
//
// Energy balance = calories consumed − calories expended, where daily
// expenditure = maintenance baseline (TDEE or calorie goal) + exercise burned.
// Only days with food logged ("tracked days") count, so un-logged days never
// inflate the surplus/deficit. Surplus (+) ⇒ predicted gain; deficit (−) ⇒ loss.
// All math is computed authoritatively by GET /api/energy-balance.
// ---------------------------------------------------------------------------

const GRANULARITIES = [
  { key: "week",  label: "Weeks"  },
  { key: "month", label: "Months" },
  { key: "year",  label: "Years"  },
];
const BAR_MAX_H = 56; // px — tallest half of a balance bar

function signedCal(n) {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString()}`;
}
function signedLbs(lbs) {
  return `${lbs > 0 ? "+" : lbs < 0 ? "−" : ""}${Math.abs(lbs).toFixed(2)} lb`;
}

function EnergyBalanceExplorer({ goal, today, refreshKey }) {
  const [granularity, setGranularity] = useState("month");
  const [baseline,    setBaseline]    = useState(null);   // null=auto | "goal" | "tdee"
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [selectedKey, setSelectedKey] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ granularity, date: today });
    if (baseline) params.set("baseline", baseline);
    fetch(`/api/energy-balance?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
        const last = d.buckets?.[d.buckets.length - 1]?.key ?? null;
        setSelectedKey(prev =>
          d.buckets?.some(b => b.key === prev) ? prev : last
        );
      })
      .catch(() => setLoading(false));
  }, [granularity, baseline, today, refreshKey]);

  // Keep the most-recent bucket scrolled into view when data changes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [data, granularity]);

  const buckets = data?.buckets || [];
  const overall = data?.overall;
  const selected = buckets.find(b => b.key === selectedKey) || overall;
  const maxAbs   = Math.max(1, ...buckets.map(b => Math.abs(b.balance)));

  const usingTdee   = data?.baseline_source === "tdee";
  const baselineCal = data?.baseline_per_day ?? goal;
  const hasTdee     = !!data?.tdee;

  const overSurplus = overall && overall.balance > 0;

  return (
    <div className="nf-eb-card card">
      {/* Header + granularity toggle */}
      <div className="nf-eb-top">
        <div className="nf-eb-headline">
          <span className="nf-eb-title">⚡ Energy Balance</span>
          <span className="nf-eb-sub">
            {" "}· all-time intake vs. expenditure
          </span>
        </div>
        <div className="nf-eb-gran">
          {GRANULARITIES.map(g => (
            <button
              key={g.key}
              className={`nf-eb-gran-btn${granularity === g.key ? " active" : ""}`}
              onClick={() => setGranularity(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* All-time overall summary */}
      {overall && overall.tracked_days > 0 ? (
        <div className="nf-eb-overall">
          <div className={`nf-eb-overall-balance${overSurplus ? " surplus" : " deficit"}`}>
            <span className="nf-eb-overall-num">{signedCal(overall.balance)}</span>
            <span className="nf-eb-overall-cap">
              cal {overSurplus ? "surplus" : "deficit"} · all time
            </span>
            <span className="nf-eb-overall-lbs">
              ≈ {signedLbs(overall.weight_change_lbs)} body weight
            </span>
          </div>
          <div className="nf-eb-overall-stats">
            <div className="nf-eb-stat">
              <span className="nf-eb-stat-num">{overall.consumed.toLocaleString()}</span>
              <span className="nf-eb-stat-lbl">eaten</span>
            </div>
            <span className="nf-eb-stat-op">−</span>
            <div className="nf-eb-stat">
              <span className="nf-eb-stat-num">{overall.expenditure.toLocaleString()}</span>
              <span className="nf-eb-stat-lbl">expended</span>
            </div>
            <div className="nf-eb-stat nf-eb-stat-muted">
              <span className="nf-eb-stat-num">{overall.tracked_days}</span>
              <span className="nf-eb-stat-lbl">days logged</span>
            </div>
            <div className="nf-eb-stat nf-eb-stat-muted">
              <span className="nf-eb-stat-num">{signedCal(overall.avg_daily_balance)}</span>
              <span className="nf-eb-stat-lbl">avg/day</span>
            </div>
          </div>
        </div>
      ) : !loading ? (
        <div className="nf-eb-empty">
          Log some food to see your energy balance. Days you don't log don't count.
        </div>
      ) : null}

      {/* Baseline note + toggle */}
      <div className="nf-eb-baseline">
        <span className="nf-eb-baseline-note">
          Maintenance baseline: <strong>{baselineCal.toLocaleString()} cal/day</strong>{" "}
          {usingTdee ? "(TDEE from profile)" : "(calorie goal)"} + exercise burned
        </span>
        {hasTdee && (
          <div className="nf-eb-baseline-toggle">
            <button
              className={`nf-eb-bt-btn${usingTdee ? " active" : ""}`}
              onClick={() => setBaseline("tdee")}
            >TDEE</button>
            <button
              className={`nf-eb-bt-btn${!usingTdee ? " active" : ""}`}
              onClick={() => setBaseline("goal")}
            >Goal</button>
          </div>
        )}
      </div>

      {/* Bucket bar chart */}
      {loading ? (
        <div className="brief-loading"><span className="spinner" /> Loading…</div>
      ) : buckets.length > 0 ? (
        <div className="nf-eb-chart" ref={scrollRef}>
          {buckets.map(b => {
            const surplus = b.balance > 0;
            const h = Math.round(Math.abs(b.balance) / maxAbs * BAR_MAX_H);
            const isSel = b.key === selectedKey;
            return (
              <button
                key={b.key}
                className={`nf-eb-col${isSel ? " selected" : ""}`}
                onClick={() => setSelectedKey(b.key)}
                title={`${b.label}: ${signedCal(b.balance)} cal`}
              >
                <div className="nf-eb-col-top">
                  {surplus && <div className="nf-eb-bar surplus" style={{ height: h }} />}
                </div>
                <div className="nf-eb-zero" />
                <div className="nf-eb-col-bot">
                  {!surplus && b.balance !== 0 && (
                    <div className="nf-eb-bar deficit" style={{ height: h }} />
                  )}
                </div>
                <span className="nf-eb-col-lbl">{b.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Selected-period equation breakdown */}
      {selected && selected.tracked_days > 0 && (
        <div className="nf-eb-detail">
          <div className="nf-eb-detail-title">
            {selected.label}
            <span className="nf-eb-detail-days"> · {selected.tracked_days} day{selected.tracked_days !== 1 ? "s" : ""} logged</span>
          </div>
          <div className="nf-eb-equation">
            <div className="nf-eb-eq-col">
              <span className="nf-eb-eq-num">{selected.consumed.toLocaleString()}</span>
              <span className="nf-eb-eq-label">eaten</span>
            </div>
            <span className="nf-eb-eq-op">−</span>
            <div className="nf-eb-eq-col">
              <span className="nf-eb-eq-num">{selected.baseline_total.toLocaleString()}</span>
              <span className="nf-eb-eq-label">maintenance</span>
            </div>
            <span className="nf-eb-eq-op">−</span>
            <div className="nf-eb-eq-col">
              <span className="nf-eb-eq-num" style={{ color:"#c084fc" }}>{selected.burned.toLocaleString()}</span>
              <span className="nf-eb-eq-label">burned 🔥</span>
            </div>
            <span className="nf-eb-eq-op">=</span>
            <div className={`nf-eb-balance${selected.balance > 0 ? " surplus" : " deficit"}`}>
              <span className="nf-eb-balance-num">{signedCal(selected.balance)}</span>
              <span className="nf-eb-balance-label">
                {selected.balance > 0 ? "surplus" : "deficit"} · {signedLbs(selected.weight_change_lbs)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="nf-eb-legend">
        <span><span className="nf-eb-swatch" style={{ background:"var(--danger)" }} />Surplus (over)</span>
        <span><span className="nf-eb-swatch" style={{ background:"var(--success)" }} />Deficit (under)</span>
        <span className="nf-eb-legend-note">3,500 cal ≈ 1 lb</span>
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
  const [bodyWeight,   setBodyWeight]   = useState(() => {
    const s = parseFloat(localStorage.getItem("protein_weight_lbs"));
    return s > 0 ? s : null;
  });
  const [weightSource, setWeightSource] = useState(() =>
    localStorage.getItem("protein_weight_lbs") ? "manual" : null);

  const isFuture = date > today;

  // On mount: sync calorie goal + derive the protein target from body weight.
  // Body-weight priority: latest logged weight → profile weight → manual (localStorage).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let profile = null;
      try {
        const d = await (await fetch("/api/profile")).json();
        profile = d?.profile || null;
        const serverGoal = profile?.calorie_goal;
        if (!cancelled && serverGoal && serverGoal >= 500) {
          setGoal(serverGoal);
          localStorage.setItem("cal_goal", String(serverGoal));
        }
      } catch { /* ignore */ }

      let w = null, src = null;
      try {
        const wj = await (await fetch("/api/weight?limit=1")).json();
        if (Array.isArray(wj) && wj.length && wj[wj.length - 1]?.weight_lbs) {
          w = wj[wj.length - 1].weight_lbs; src = "log";
        }
      } catch { /* ignore */ }
      if (w == null && profile?.weight_lbs) { w = profile.weight_lbs; src = "profile"; }
      if (!cancelled && w != null) { setBodyWeight(w); setWeightSource(src); }
    })();
    return () => { cancelled = true; };
  }, []);

  function handleSetWeight(w) {
    setBodyWeight(w);
    setWeightSource("manual");
    localStorage.setItem("protein_weight_lbs", String(w));
  }

  const proteinTarget = bodyWeight != null ? Math.round(bodyWeight) : null;

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
              proteinTarget={proteinTarget}
              weightSource={weightSource}
              onSetWeight={handleSetWeight}
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

          <EnergyBalanceExplorer
            goal={goal}
            today={today}
            refreshKey={calRefresh}
          />
        </ErrorBoundary>
      </main>
    </div>
  );
}
