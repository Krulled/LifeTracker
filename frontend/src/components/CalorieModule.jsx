import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";
import FoodPhotoAnalyzer from "./FoodPhotoAnalyzer.jsx";
import NutritionLabelScanner from "./NutritionLabelScanner.jsx";
import TemplatesPanel from "./TemplatesPanel.jsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
const DAY_HEADERS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MEAL_TYPES  = ["breakfast","lunch","dinner","snack"];
const MEAL_ICONS  = { breakfast:"🌅", lunch:"☀️", dinner:"🌙", snack:"🍎" };

function toKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function todayKey() { return toKey(new Date()); }

function pctColor(pct) {
  if (pct <= 0)   return null;
  if (pct <= 1.1) return "good";
  if (pct <= 1.3) return "ok";
  return "poor";
}

// ---------------------------------------------------------------------------
// CalorieCalendar
// ---------------------------------------------------------------------------

function CalorieCalendar({ summary, goal, onDaySelect, selectedDate }) {
  const now = new Date();
  const [viewYear,  setViewYear]  = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const cells = useMemo(() => {
    const first    = new Date(viewYear, viewMonth, 1);
    const last     = new Date(viewYear, viewMonth + 1, 0);
    const startDow = first.getDay();
    const days     = last.getDate();
    const grid     = [];
    for (let i = 0; i < startDow; i++)
      grid.push({ date: new Date(viewYear, viewMonth, 1 - (startDow - i)), current: false });
    for (let d = 1; d <= days; d++)
      grid.push({ date: new Date(viewYear, viewMonth, d), current: true });
    const base = startDow + days;
    while (grid.length < 42)
      grid.push({ date: new Date(viewYear, viewMonth + 1, grid.length - base + 1), current: false });
    return grid;
  }, [viewYear, viewMonth]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const today   = todayKey();
  const monthKeys = cells.filter(c => c.current).map(c => toKey(c.date));
  const logged    = monthKeys.filter(k => summary[k]).length;

  return (
    <div className="calendar-wrapper card">
      <div className="calendar-header">
        <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
        <div style={{ textAlign:"center" }}>
          <div className="cal-month-label">{MONTH_NAMES[viewMonth]} {viewYear}</div>
          <div className="cal-coverage">{logged}/{monthKeys.length} days logged</div>
        </div>
        <button className="cal-nav-btn" onClick={nextMonth}>›</button>
      </div>

      {(viewYear !== now.getFullYear() || viewMonth !== now.getMonth()) && (
        <button className="cal-today-btn" onClick={() => { setViewYear(now.getFullYear()); setViewMonth(now.getMonth()); }}>↩ Today</button>
      )}

      <div className="calendar-grid">
        {DAY_HEADERS.map(d => <div key={d} className="cal-day-header">{d}</div>)}
        {cells.map((cell, i) => {
          const key      = toKey(cell.date);
          const data     = summary[key];
          const pct      = data && goal > 0 ? data.calories / goal : 0;
          const quality  = data ? pctColor(pct) : null;
          const isToday  = key === today;
          const isFuture = key > today;
          const clickable = cell.current && !isFuture;

          let cls = "cal-day";
          if (!cell.current)  cls += " other-month";
          if (isToday)        cls += " today";
          if (data)           cls += ` logged${quality ? " " + quality : ""}`;
          if (key === selectedDate) cls += " selected";
          if (isFuture)       cls += " future no-click";
          if (!clickable)     cls += " no-click";

          const label = data
            ? `${key}, ${data.calories} cal (${Math.round(pct * 100)}% of goal)`
            : clickable ? `${key}, not logged` : undefined;

          return (
            <div
              key={i}
              className={cls}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={label}
              onClick={() => clickable && onDaySelect(key, data || null)}
              onKeyDown={e => clickable && (e.key === "Enter" || e.key === " ") && onDaySelect(key, data || null)}
              title={data ? `${key} · ${data.calories} cal · ${data.items} items` : key}
            >
              <span className="cal-day-num">{cell.date.getDate()}</span>
              {data && <span className="cal-dot" aria-hidden="true" />}
            </div>
          );
        })}
      </div>

      <div className="cal-legend">
        <span><span className="cal-legend-dot good" /> At goal</span>
        <span><span className="cal-legend-dot ok"   /> Slightly over</span>
        <span><span className="cal-legend-dot poor" /> Way over</span>
        <span><span className="cal-legend-today"   /> Today</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CalorieChatbot
// ---------------------------------------------------------------------------

const CHAT_SUGGESTIONS = [
  "How many calories in a banana?",
  "Calories in 2 scrambled eggs?",
  "Chicken breast 200g?",
  "Big Mac calories?",
  "Calories in a cup of white rice?",
  "Avocado toast calories?",
];

function CalorieChatbot({ todayEntries, goal }) {
  const [messages,  setMessages]  = useState([
    { role: "assistant", content: "Ask me about calories in any food — I'll give you quick estimates to help plan your meals." },
  ]);
  const [input,     setInput]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const bottomRef = React.useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function buildTodayContext() {
    if (!todayEntries || todayEntries.length === 0) return "";
    const names = todayEntries.map(e => `${e.food_name} (${e.calories} cal)`).join(", ");
    return names;
  }

  async function sendMessage(text) {
    const trimmed = (text || input).trim();
    if (!trimmed || loading) return;

    const userMsg   = { role: "user",      content: trimmed };
    const newMsgs   = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    setLoading(true);
    setError(null);

    // Only send actual conversation turns (skip the initial greeting)
    const historyToSend = newMsgs
      .slice(1)                      // skip greeting
      .slice(-10)                    // last 10 messages max
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const res  = await fetch("/api/food/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          message:      trimmed,
          history:      historyToSend.slice(0, -1),  // history before current user msg
          today_logged: buildTodayContext(),
          calorie_goal: goal || 0,
          consumed:     (todayEntries || []).reduce((s, e) => s + e.calories, 0),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Request failed");
      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  return (
    <div className="card calorie-chat-card">
      <div className="calorie-chat-header">
        <span className="calorie-chat-icon">🤖</span>
        <span className="calorie-chat-title">Nutrition AI</span>
        <span className="calorie-chat-sub">Ask about calories in any food</span>
      </div>

      {/* Message list */}
      <div className="calorie-chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            {m.role === "assistant" && <span className="chat-msg-avatar">🤖</span>}
            <div className="chat-msg-bubble">{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="chat-msg chat-msg-assistant">
            <span className="chat-msg-avatar">🤖</span>
            <div className="chat-msg-bubble chat-msg-typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        {error && (
          <div className="chat-msg chat-msg-assistant">
            <span className="chat-msg-avatar">⚠️</span>
            <div className="chat-msg-bubble chat-msg-error">Error: {error}</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick suggestions */}
      {messages.length <= 2 && !loading && (
        <div className="calorie-chat-suggestions">
          {CHAT_SUGGESTIONS.map(s => (
            <button key={s} className="chat-suggestion-chip" onClick={() => sendMessage(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="calorie-chat-input-row">
        <input
          className="calorie-chat-input"
          placeholder="e.g. How many calories in a chicken sandwich?"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          className="calorie-chat-send"
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          aria-label="Send"
        >
          {loading ? <span className="spinner" style={{ width:14, height:14 }} /> : "↑"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CalorieDayPanel
// ---------------------------------------------------------------------------

const MEAL_LABELS   = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snacks" };
const MEAL_WEIGHTS  = { breakfast: 25, lunch: 35, dinner: 35, snack: 5 };

// ---------------------------------------------------------------------------
// MealSection
// ---------------------------------------------------------------------------

function MealSection({
  type, items, isFuture, activeForm, onOpenForm, onDelete,
  form, setForm, onSubmit, saving, error, budget,
}) {
  const mealCals = items.reduce((s, i) => s + i.calories, 0);
  const isOpen   = activeForm === type;
  const hasFood  = items.length > 0;
  const pct      = budget > 0 ? mealCals / budget : 0;

  return (
    <div className="meal-section">
      <div className="meal-section-header">
        <span className="meal-section-icon">{MEAL_ICONS[type]}</span>
        <span className="meal-section-title">{MEAL_LABELS[type]}</span>

        {/* Budget badge */}
        <div className="meal-section-budget-area">
          {hasFood && budget > 0 && (
            <span className={`meal-budget-actual${pct > 1.1 ? " over" : pct >= 0.9 ? " hit" : ""}`}>
              {mealCals} <span className="meal-budget-of">/ {budget} cal</span>
            </span>
          )}
          {!hasFood && budget > 0 && !isOpen && !isFuture && (
            <span className="meal-budget-target">~{budget} cal</span>
          )}
          {hasFood && !budget && (
            <span className="meal-section-cals">{mealCals} cal</span>
          )}
        </div>

        {/* Add food button */}
        {!isFuture && (
          <button
            className={`meal-add-btn${isOpen ? " open" : ""}`}
            onClick={() => onOpenForm(isOpen ? null : type)}
            aria-label={isOpen ? "Cancel" : `Add to ${MEAL_LABELS[type]}`}
          >
            {isOpen ? "✕" : "+"}
          </button>
        )}
      </div>

      {/* Mini progress bar */}
      {hasFood && budget > 0 && (
        <div className="meal-budget-bar-track">
          <div
            className="meal-budget-bar-fill"
            style={{
              width: `${Math.min(pct * 100, 100).toFixed(1)}%`,
              background: pct > 1.1 ? "var(--danger)" : pct >= 0.9 ? "var(--success)" : "var(--accent)",
            }}
          />
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && !isOpen && (
        <div className="meal-empty">
          Nothing logged yet.{!isFuture && " Hit + to add food."}
        </div>
      )}

      {/* Food items */}
      {items.map(item => (
        <div key={item.id} className="food-item-row">
          <span className="food-item-name">{item.food_name}</span>
          <div className="food-item-right">
            {item.protein_g > 0 && <span className="food-item-macro">P {Math.round(item.protein_g)}g</span>}
            {item.carbs_g   > 0 && <span className="food-item-macro">C {Math.round(item.carbs_g)}g</span>}
            {item.fat_g     > 0 && <span className="food-item-macro">F {Math.round(item.fat_g)}g</span>}
            <span className="food-item-cal">{item.calories} cal</span>
            {!isFuture && (
              <button className="food-item-del" onClick={() => onDelete(item.id)} title="Remove">✕</button>
            )}
          </div>
        </div>
      ))}

      {/* Add food inline form */}
      {isOpen && (
        <form onSubmit={onSubmit} className="meal-inline-form">
          <div className="form-group">
            <input
              className="form-input"
              placeholder="Food name (e.g. Chicken breast 150g)"
              value={form.food_name}
              onChange={e => setForm(f => ({...f, food_name: e.target.value}))}
              required
              autoFocus
            />
          </div>
          <div className="meal-inline-row">
            <input className="form-input" type="number" min="0" max="10000" placeholder="Calories (kcal)" value={form.calories}
              onChange={e => setForm(f => ({...f, calories: e.target.value}))} required />
            <input className="form-input" type="number" min="0" step="0.1" placeholder="Protein g" value={form.protein_g}
              onChange={e => setForm(f => ({...f, protein_g: e.target.value}))} />
            <input className="form-input" type="number" min="0" step="0.1" placeholder="Carbs g" value={form.carbs_g}
              onChange={e => setForm(f => ({...f, carbs_g: e.target.value}))} />
            <input className="form-input" type="number" min="0" step="0.1" placeholder="Fat g" value={form.fat_g}
              onChange={e => setForm(f => ({...f, fat_g: e.target.value}))} />
          </div>
          {error && <div className="alert alert-error" style={{ marginTop:"0.35rem", padding:"0.35rem 0.6rem", fontSize:"0.78rem" }}>✗ {error}</div>}
          <div style={{ display:"flex", gap:"0.5rem", marginTop:"0.5rem" }}>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex:1 }}>
              {saving ? "Saving…" : "Add"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onOpenForm(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function CalorieDayPanel({ date, goal, onGoalChange, onMutated }) {
  const [entries,       setEntries]       = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [activeForm,    setActiveForm]    = useState(null);
  const [form,          setForm]          = useState({ food_name:"", calories:"", protein_g:"", carbs_g:"", fat_g:"" });
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState(null);
  const [showTemplates,    setShowTemplates]    = useState(false);
  const [showPhotoScanner, setShowPhotoScanner] = useState(false);
  const [showLabelScanner, setShowLabelScanner] = useState(false);

  // ── Templates ──────────────────────────────────────────────────────────────
  const [templates, setTemplates] = useState([]);

  const fetchTemplates = useCallback(() => {
    fetch("/api/food/templates")
      .then(r => r.json())
      .then(data => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  async function handleApplyTemplate(templateId, mealType) {
    if (!date) return;
    const res = await fetch(`/api/food/templates/${templateId}/apply`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ entry_date: date, meal_type: mealType }),
    });
    if (!res.ok) return;
    const created = await res.json();
    setEntries(prev => [...prev, ...created]);
    onMutated();
  }

  async function handleSaveTemplate(items, name, mealType) {
    const payload = {
      name,
      meal_type: mealType,
      items: items.map(i => ({
        food_name: i.food_name,
        calories:  i.calories,
        protein_g: i.protein_g,
        carbs_g:   i.carbs_g,
        fat_g:     i.fat_g,
      })),
    };
    const res = await fetch("/api/food/templates", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) return false;
    const tpl = await res.json();
    setTemplates(prev => [...prev, tpl]);
    return true;
  }

  async function handleDeleteTemplate(templateId) {
    const res = await fetch(`/api/food/templates/${templateId}`, { method: "DELETE" });
    if (res.ok) setTemplates(prev => prev.filter(t => t.id !== templateId));
  }
  // ──────────────────────────────────────────────────────────────────────────

  const today = todayKey();

  const fetchEntries = useCallback(() => {
    if (!date) return;
    setLoading(true);
    fetch(`/api/food?date=${date}`)
      .then(r => r.json())
      .then(data => { setEntries(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [date]);

  useEffect(() => { fetchEntries(); setActiveForm(null); setError(null); }, [date, fetchEntries]);

  const total = useMemo(() => entries.reduce((s, e) => ({
    calories:  s.calories  + e.calories,
    protein_g: s.protein_g + (e.protein_g || 0),
    carbs_g:   s.carbs_g   + (e.carbs_g   || 0),
    fat_g:     s.fat_g     + (e.fat_g     || 0),
  }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }), [entries]);

  const byMeal = useMemo(() => {
    const m = { breakfast: [], lunch: [], dinner: [], snack: [] };
    entries.forEach(e => { (m[e.meal_type] ?? m.snack).push(e); });
    return m;
  }, [entries]);

  // Per-meal calorie budget: split remaining calories across unlogged meals
  // using weighted distribution (breakfast 25%, lunch 35%, dinner 35%, snacks 5%)
  const mealBudgets = useMemo(() => {
    const remaining = goal - total.calories;
    if (remaining <= 0) return {};
    const mealCals = t => (byMeal[t] || []).reduce((s, e) => s + e.calories, 0);
    const unlogged  = MEAL_TYPES.filter(t => mealCals(t) === 0);
    const logged    = MEAL_TYPES.filter(t => mealCals(t) > 0);
    const unloggedWeight = unlogged.reduce((s, t) => s + MEAL_WEIGHTS[t], 0);
    const budgets = {};
    // For unlogged meals: split remaining proportionally
    if (unloggedWeight > 0) {
      unlogged.forEach(t => {
        budgets[t] = Math.round(remaining * MEAL_WEIGHTS[t] / unloggedWeight);
      });
    }
    // For already-logged meals: show their original target share of the full goal
    logged.forEach(t => {
      budgets[t] = Math.round(goal * MEAL_WEIGHTS[t] / 100);
    });
    return budgets;
  }, [goal, total.calories, byMeal]);

  function openForm(mealType) {
    setActiveForm(mealType);
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
    // Append directly — no re-fetch, no loading flash
    setEntries(prev => [...prev, json]);
    setActiveForm(null);
    onMutated();
  }

  async function handleDelete(id) {
    // Remove immediately — no loading flash
    setEntries(prev => prev.filter(e => e.id !== id));
    fetch(`/api/food/${id}`, { method: "DELETE" });
    onMutated();
  }

  function handlePhotoAdd(entry) {
    setEntries(prev => [...prev, entry]);
    onMutated();
  }

  function handleLabelAdd(entry) {
    setEntries(prev => [...prev, entry]);
    onMutated();
  }

  if (!date) {
    return (
      <div className="brief-panel card">
        <div className="brief-empty-center">
          <div style={{ fontSize:"2.5rem", marginBottom:"0.5rem" }}>🥗</div>
          <p style={{ color:"var(--text-muted)", fontSize:"0.9rem" }}>Click any day to view or log calories.</p>
        </div>
      </div>
    );
  }

  const pct      = goal > 0 ? total.calories / goal : 0;
  const pctCls   = pctColor(pct);
  const isFuture = date > today;
  const remaining = goal - total.calories;

  return (
    <>
    <div className="brief-panel card">
      <div className="brief-date-row">
        <span className="brief-date">{date}</span>
        {date === today && <span className="brief-badge today-badge">Today</span>}
        {isFuture && <span className="brief-badge future-badge">Future</span>}
      </div>

      {/* Calorie summary */}
      <div className="cal-summary-row">
        <div className={`cal-total-badge ${pctCls || ""}`}>
          <span className="cal-total-num">{total.calories}</span>
          <span className="cal-total-label">/ {goal} cal</span>
        </div>
        <div style={{ flex:1 }}>
          <div className="cal-progress-bar">
            <div className="cal-progress-fill" style={{
              width: `${Math.min(pct * 100, 100)}%`,
              background: pctCls === "poor" ? "var(--danger)" : pctCls === "ok" ? "var(--warning)" : "var(--success)",
            }} />
          </div>
          <div style={{ display:"flex", gap:"1rem", marginTop:"0.4rem", fontSize:"0.75rem", color:"var(--text-dim)", fontFamily:"var(--font-mono)" }}>
            {!isFuture && remaining > 0 && <span style={{ color:"var(--accent)" }}>{remaining} remaining</span>}
            {!isFuture && remaining < 0 && <span style={{ color:"var(--danger)" }}>{Math.abs(remaining)} over</span>}
            {total.protein_g > 0 && <span>P {Math.round(total.protein_g)}g</span>}
            {total.carbs_g   > 0 && <span>C {Math.round(total.carbs_g)}g</span>}
            {total.fat_g     > 0 && <span>F {Math.round(total.fat_g)}g</span>}
          </div>
        </div>
      </div>

      {/* Goal editor + Templates toggle */}
      <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", marginBottom:"0.75rem", fontSize:"0.78rem", color:"var(--text-dim)" }}>
        <span>Daily goal:</span>
        <input
          type="number"
          className="form-input"
          style={{ width:80, padding:"2px 6px", fontSize:"0.78rem" }}
          value={goal}
          min={500} max={10000} step={50}
          onChange={e => onGoalChange(parseInt(e.target.value,10) || 2000)}
        />
        <span>cal</span>
        <div style={{ flex:1 }} />
        {!isFuture && (
          <>
            <button
              className="photo-scan-btn"
              onClick={() => { setShowPhotoScanner(true); setActiveForm(null); setShowTemplates(false); setShowLabelScanner(false); }}
              title="Scan a photo of your meal"
            >
              📷 Scan
            </button>
            <button
              className="photo-scan-btn nls-scan-btn"
              onClick={() => { setShowLabelScanner(true); setActiveForm(null); setShowTemplates(false); setShowPhotoScanner(false); }}
              title="Scan a nutrition label"
            >
              🏷️ Label
            </button>
          </>
        )}
        <button
          className={`tpl-toggle-btn${showTemplates ? " active" : ""}`}
          onClick={() => { setShowTemplates(v => !v); setActiveForm(null); setShowPhotoScanner(false); }}
        >
          📋 Templates{templates.length > 0 ? ` (${templates.length})` : ""}
          <span className="tpl-toggle-arrow">{showTemplates ? "▲" : "▼"}</span>
        </button>
      </div>

      {/* Templates panel */}
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

      {/* Meal sections */}
      {loading ? (
        <div className="brief-loading"><span className="spinner" /> Loading…</div>
      ) : (
        MEAL_TYPES.map(type => (
          <MealSection
            key={type}
            type={type}
            items={byMeal[type] || []}
            isFuture={isFuture}
            activeForm={activeForm}
            onOpenForm={openForm}
            onDelete={handleDelete}
            form={form}
            setForm={setForm}
            onSubmit={handleAdd}
            saving={saving}
            error={error}
            budget={mealBudgets[type]}
          />
        ))
      )}
    </div>

    {showPhotoScanner && (
      <FoodPhotoAnalyzer
        date={date}
        onAdd={handlePhotoAdd}
        onClose={() => setShowPhotoScanner(false)}
      />
    )}
    {showLabelScanner && (
      <NutritionLabelScanner
        date={date}
        onAdd={handleLabelAdd}
        onClose={() => setShowLabelScanner(false)}
      />
    )}
  </>
  );
}

// ---------------------------------------------------------------------------
// WeeklyCalorieSummary
// ---------------------------------------------------------------------------

const WEEK_DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function WeeklyCalorieSummary({ summary, goal }) {
  const now      = new Date();
  const todayStr = toKey(now);

  // Monday of the current week
  const dow    = now.getDay(); // 0=Sun…6=Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + offset);
  monday.setHours(0, 0, 0, 0);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toKey(d);
  });

  const trackedDays  = weekDays.filter(d => d <= todayStr);
  const totalConsumed = trackedDays.reduce((s, d) => s + (summary[d]?.calories || 0), 0);
  const goalSoFar    = goal * trackedDays.length;
  const weeklyGoal   = goal * 7;
  const net          = totalConsumed - goalSoFar; // positive = surplus, negative = deficit
  const isSurplus    = net >= 0;
  const pctOfGoal    = goalSoFar > 0 ? Math.min(totalConsumed / goalSoFar, 1.5) : 0;

  return (
    <div className="card week-cal-card">
      <div className="week-cal-header">
        <span className="week-cal-title">This Week</span>
        <span className="week-cal-goal-label">Goal: {weeklyGoal.toLocaleString()} cal</span>
      </div>

      {/* Day bars */}
      <div className="week-cal-days">
        {weekDays.map((dateKey, i) => {
          const cals      = summary[dateKey]?.calories || 0;
          const isPast    = dateKey <= todayStr;
          const isToday   = dateKey === todayStr;
          const isFuture  = dateKey > todayStr;
          const pct       = goal > 0 && isPast ? Math.min(cals / goal, 1.5) : 0;
          const overGoal  = cals > goal * 1.1;
          const hitGoal   = cals >= goal * 0.9 && !overGoal;
          const barColor  = overGoal ? "var(--danger)" : hitGoal ? "var(--success)" : "var(--accent)";

          return (
            <div key={dateKey} className={`week-cal-day${isToday ? " is-today" : ""}${isFuture ? " is-future" : ""}`}>
              <div className="week-cal-day-label">{WEEK_DAY_LABELS[i]}</div>
              <div className="week-cal-bar-track">
                {!isFuture && (
                  <div
                    className="week-cal-bar-fill"
                    style={{ height: `${(pct * 100).toFixed(1)}%`, background: barColor }}
                  />
                )}
              </div>
              <div className="week-cal-day-cals">
                {isFuture ? "—" : cals > 0 ? cals.toLocaleString() : "0"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress bar vs goal so far */}
      <div className="week-cal-progress-track">
        <div
          className="week-cal-progress-fill"
          style={{
            width: `${(pctOfGoal * 100).toFixed(1)}%`,
            background: pctOfGoal > 1.1 ? "var(--danger)" : pctOfGoal >= 0.9 ? "var(--success)" : "var(--accent)",
          }}
        />
      </div>

      {/* Totals row */}
      <div className="week-cal-totals">
        <div className="week-cal-total-consumed">
          <span className="week-cal-big-num">{totalConsumed.toLocaleString()}</span>
          <span className="week-cal-big-sub">cal consumed</span>
        </div>
        <div className={`week-cal-balance${isSurplus ? " surplus" : " deficit"}`}>
          <span className="week-cal-balance-num">
            {isSurplus ? "+" : "−"}{Math.abs(net).toLocaleString()}
          </span>
          <span className="week-cal-balance-label">{isSurplus ? "surplus" : "deficit"}</span>
        </div>
        <div className="week-cal-total-goal">
          <span className="week-cal-big-num">{goalSoFar.toLocaleString()}</span>
          <span className="week-cal-big-sub">goal so far</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CalorieModule
// ---------------------------------------------------------------------------

const DEFAULT_GOAL = 2000;

export default function CalorieModule({ onBack }) {
  const [summary,      setSummary]      = useState({});
  const [selectedDate, setSelectedDate] = useState(null);
  const [goal,         setGoal]         = useState(() => parseInt(localStorage.getItem("cal_goal") || DEFAULT_GOAL, 10));
  const [refreshKey,   setRefreshKey]   = useState(0);
  const [todayEntries, setTodayEntries] = useState([]);

  const todayStr = todayKey();

  const fetchSummary = useCallback(() => {
    fetch("/api/food/daily-summary")
      .then(r => r.json())
      .then(data => setSummary(data))
      .catch(() => {});
  }, []);

  const fetchTodayEntries = useCallback(() => {
    fetch(`/api/food?date=${todayStr}`)
      .then(r => r.json())
      .then(data => setTodayEntries(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [todayStr]);

  useEffect(() => {
    fetchSummary();
    fetchTodayEntries();
  }, [refreshKey, fetchSummary, fetchTodayEntries]);

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

  function handleGoalChange(val) {
    setGoal(val);
    localStorage.setItem("cal_goal", val);
    fetch("/api/profile/calorie-goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calorie_goal: val }),
    }).catch(() => {});
  }

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <button className="back-btn" onClick={onBack}>← Hub</button>
          <div className="brand">
            <span className="brand-icon">🥗</span>
            <div>
              <div className="brand-name">Calorie Tracker</div>
              <div className="brand-sub">NUTRITION LOG · daily tracking</div>
            </div>
          </div>
        </div>
      </header>

      <main>
        <ErrorBoundary>
          <div className="calendar-layout">
            <div className="calendar-left-col">
              <CalorieCalendar
                summary={summary}
                goal={goal}
                onDaySelect={date => setSelectedDate(date)}
                selectedDate={selectedDate}
              />
              <WeeklyCalorieSummary summary={summary} goal={goal} />
              <CalorieChatbot todayEntries={todayEntries} goal={goal} />
            </div>
            <div>
              <CalorieDayPanel
                date={selectedDate}
                goal={goal}
                onGoalChange={handleGoalChange}
                onMutated={() => { setRefreshKey(k => k + 1); }}
              />
            </div>
          </div>
        </ErrorBoundary>
      </main>
    </div>
  );
}
