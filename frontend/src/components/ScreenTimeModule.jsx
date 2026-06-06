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

function focusColor(v)  { return v >= 4 ? "#4ade80" : v >= 2 ? "#f59e0b" : "#f87171"; }
function screenColor(v) { return v <= 3 ? "#4ade80" : v <= 6 ? "#f59e0b" : "#f87171"; }

const FOCUS_TIPS  = ["", "Low focus day", "Some deep work", "Getting productive", "Solid focus session", "Great focus day!"];
const SCREEN_TIPS = { low: "Great digital balance", mid: "Moderate screen use", high: "High screen time" };

function focusTip(v)  { return FOCUS_TIPS[Math.min(Math.floor(v), 4)] ?? "Peak productivity!"; }
function screenTip(v) { return v <= 3 ? SCREEN_TIPS.low : v <= 6 ? SCREEN_TIPS.mid : SCREEN_TIPS.high; }

export default function ScreenTimeModule({ onBack }) {
  const today = localDateISO();

  const [selectedDate, setSelectedDate] = useState(today);
  const [dayEntry,     setDayEntry]     = useState(null);
  const [history,      setHistory]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [editMode,     setEditMode]     = useState(false);

  const [focusHours,  setFocusHours]  = useState(4);
  const [screenHours, setScreenHours] = useState(3);
  const [note,        setNote]        = useState("");

  const fetchSelected = useCallback(async () => {
    const r = await fetch(`/api/screen-time?date=${selectedDate}`);
    const d = await r.json();
    if (d) {
      setDayEntry(d);
      setFocusHours(d.focus_hours  ?? 4);
      setScreenHours(d.screen_hours ?? 3);
      setNote(d.note ?? "");
    } else {
      setDayEntry(null);
      setFocusHours(4); setScreenHours(3); setNote("");
    }
  }, [selectedDate]);

  const fetchHistory = useCallback(async () => {
    const r = await fetch("/api/screen-time?limit=14");
    setHistory(await r.json());
  }, []);

  useEffect(() => {
    setLoading(true);
    setEditMode(false);
    Promise.all([fetchSelected(), fetchHistory()]).finally(() => setLoading(false));
  }, [fetchSelected, fetchHistory]);

  async function handleSave() {
    setSaving(true); setSaved(false);
    await fetch("/api/screen-time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry_date: selectedDate, focus_hours: focusHours, screen_hours: screenHours, note }),
    });
    setSaving(false); setSaved(true); setEditMode(false);
    setTimeout(() => setSaved(false), 3000);
    await fetchSelected();
    fetchHistory();
  }

  async function handleDelete() {
    if (!dayEntry || !window.confirm("Delete this entry?")) return;
    await fetch(`/api/screen-time/${dayEntry.id}`, { method: "DELETE" });
    setDayEntry(null);
    setFocusHours(4); setScreenHours(3); setNote("");
    fetchHistory();
  }

  function prevDay() { setSelectedDate(d => offsetDate(d, -1)); }
  function nextDay() { setSelectedDate(d => offsetDate(d, 1)); }
  function goToday() { setSelectedDate(today); }

  const isToday   = selectedDate === today;
  const dateLabel = isToday
    ? "Today"
    : new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });

  const showForm = !dayEntry || editMode;

  // weekly averages from history
  const weekEntries = history.slice(0, 7);
  const avgFocus  = weekEntries.filter(e => e.focus_hours  != null).length
    ? (weekEntries.reduce((s, e) => s + (e.focus_hours  ?? 0), 0) / weekEntries.filter(e => e.focus_hours  != null).length).toFixed(1)
    : null;
  const avgScreen = weekEntries.filter(e => e.screen_hours != null).length
    ? (weekEntries.reduce((s, e) => s + (e.screen_hours ?? 0), 0) / weekEntries.filter(e => e.screen_hours != null).length).toFixed(1)
    : null;

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <button className="back-btn" onClick={onBack}>← Hub</button>
          <div className="brand">
            <span className="brand-icon">📱</span>
            <div>
              <div className="brand-name">Screen Time</div>
              <div className="brand-sub">FOCUS & DIGITAL WELLNESS</div>
            </div>
          </div>
        </div>
        {saved && <span style={{ fontSize:"0.72rem", color:"var(--success)" }}>✓ Saved</span>}
      </header>

      <main style={{ maxWidth:900, margin:"0 auto", padding:"1.25rem 1.5rem" }}>
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
              <>
                {/* 7-day summary chips */}
                {(avgFocus || avgScreen) && (
                  <div className="st-week-summary">
                    {avgFocus  && <span className="st-week-chip" style={{ color: focusColor(parseFloat(avgFocus)) }}>🎯 7-day avg focus: <strong>{avgFocus}h</strong></span>}
                    {avgScreen && <span className="st-week-chip" style={{ color: screenColor(parseFloat(avgScreen)) }}>📱 7-day avg screen: <strong>{avgScreen}h</strong></span>}
                  </div>
                )}

                <div className="st-layout">
                  {/* Entry card */}
                  <div className="card st-entry-card">
                    <div className="habit-panel-header">
                      <span className="habit-panel-title">
                        {dayEntry && !editMode ? (isToday ? "Today's Log" : `${dateLabel}'s Log`) : (isToday ? "Log Today" : `Log ${dateLabel}`)}
                      </span>
                      {dayEntry && !editMode && (
                        <div style={{ display:"flex", gap:"0.4rem" }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditMode(true)}>✎ Edit</button>
                          <button className="btn btn-ghost btn-sm" style={{ color:"var(--danger)" }} onClick={handleDelete}>✕</button>
                        </div>
                      )}
                    </div>

                    {dayEntry && !editMode ? (
                      <div className="st-summary">
                        <div className="st-summary-row">
                          <span className="st-sum-icon">🎯</span>
                          <span className="st-sum-label">Deep Focus</span>
                          <div className="st-sum-bar-wrap">
                            <div className="st-sum-bar" style={{ width:`${Math.min(dayEntry.focus_hours/12*100,100)}%`, background: focusColor(dayEntry.focus_hours) }} />
                          </div>
                          <span className="st-sum-val" style={{ color: focusColor(dayEntry.focus_hours) }}>
                            {dayEntry.focus_hours}h
                          </span>
                        </div>
                        <div className="st-summary-row">
                          <span className="st-sum-icon">📱</span>
                          <span className="st-sum-label">Screen Time</span>
                          <div className="st-sum-bar-wrap">
                            <div className="st-sum-bar" style={{ width:`${Math.min(dayEntry.screen_hours/12*100,100)}%`, background: screenColor(dayEntry.screen_hours) }} />
                          </div>
                          <span className="st-sum-val" style={{ color: screenColor(dayEntry.screen_hours) }}>
                            {dayEntry.screen_hours}h
                          </span>
                        </div>
                        {dayEntry.note && <p className="mood-note-display">"{dayEntry.note}"</p>}
                      </div>
                    ) : (
                      <div className="st-form">
                        {/* Focus slider */}
                        <div className="st-slider-group">
                          <div className="st-slider-header">
                            <span className="st-slider-label">🎯 Deep Focus Hours</span>
                            <span className="st-slider-val" style={{ color: focusColor(focusHours) }}>{focusHours}h</span>
                          </div>
                          <input
                            type="range" min="0" max="12" step="0.5" value={focusHours}
                            className="mood-range"
                            style={{ "--track-fill": focusColor(focusHours) }}
                            onChange={e => setFocusHours(parseFloat(e.target.value))}
                          />
                          <div className="st-slider-footer">
                            <div className="st-scale-labels"><span>0h</span><span>3h</span><span>6h</span><span>9h</span><span>12h</span></div>
                            <span className="st-slider-tip" style={{ color: focusColor(focusHours) }}>{focusTip(focusHours)}</span>
                          </div>
                        </div>

                        {/* Screen time slider */}
                        <div className="st-slider-group">
                          <div className="st-slider-header">
                            <span className="st-slider-label">📱 Leisure Screen Time</span>
                            <span className="st-slider-val" style={{ color: screenColor(screenHours) }}>{screenHours}h</span>
                          </div>
                          <input
                            type="range" min="0" max="12" step="0.5" value={screenHours}
                            className="mood-range"
                            style={{ "--track-fill": screenColor(screenHours) }}
                            onChange={e => setScreenHours(parseFloat(e.target.value))}
                          />
                          <div className="st-slider-footer">
                            <div className="st-scale-labels"><span>0h ✨</span><span>3h</span><span>6h</span><span>9h</span><span>12h</span></div>
                            <span className="st-slider-tip" style={{ color: screenColor(screenHours) }}>{screenTip(screenHours)}</span>
                          </div>
                        </div>

                        <div className="form-group" style={{ marginTop:"0.5rem" }}>
                          <label className="form-label">Note (optional)</label>
                          <input
                            className="form-input"
                            placeholder="What did you work on today?"
                            value={note}
                            onChange={e => setNote(e.target.value)}
                          />
                        </div>

                        <div style={{ display:"flex", gap:"0.5rem", marginTop:"1rem" }}>
                          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex:1 }}>
                            {saving ? "Saving…" : dayEntry ? "Update" : "Save Log"}
                          </button>
                          {editMode && (
                            <button className="btn btn-ghost" onClick={() => setEditMode(false)}>Cancel</button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* History — click row to jump to that day */}
                  <div className="card st-history-card">
                    <div className="habit-panel-header">
                      <span className="habit-panel-title">14-Day History</span>
                      <span style={{ fontSize:"0.65rem", color:"var(--text-dim)" }}>click row to edit</span>
                    </div>
                    {history.length === 0 ? (
                      <p style={{ padding:"1rem", color:"var(--text-dim)", fontSize:"0.82rem" }}>No entries yet.</p>
                    ) : (
                      <div className="st-hist-list">
                        {history.map(e => {
                          const label = new Date(e.entry_date + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });
                          const isActive = e.entry_date === selectedDate;
                          return (
                            <div
                              key={e.id}
                              className={`st-hist-row${isActive ? " st-hist-row--active" : ""}`}
                              onClick={() => setSelectedDate(e.entry_date)}
                              style={{ cursor:"pointer" }}
                            >
                              <span className="st-hist-date">{label}</span>
                              <div className="st-hist-bars">
                                {e.focus_hours != null && (
                                  <div className="st-hist-bar-row">
                                    <span className="st-hist-bar-icon">🎯</span>
                                    <div className="st-hist-bar-track">
                                      <div className="st-hist-bar-fill" style={{ width:`${Math.min(e.focus_hours/12*100,100)}%`, background: focusColor(e.focus_hours) }} />
                                    </div>
                                    <span className="st-hist-val" style={{ color: focusColor(e.focus_hours) }}>{e.focus_hours}h</span>
                                  </div>
                                )}
                                {e.screen_hours != null && (
                                  <div className="st-hist-bar-row">
                                    <span className="st-hist-bar-icon">📱</span>
                                    <div className="st-hist-bar-track">
                                      <div className="st-hist-bar-fill" style={{ width:`${Math.min(e.screen_hours/12*100,100)}%`, background: screenColor(e.screen_hours) }} />
                                    </div>
                                    <span className="st-hist-val" style={{ color: screenColor(e.screen_hours) }}>{e.screen_hours}h</span>
                                  </div>
                                )}
                              </div>
                              {e.note && <span className="st-hist-note" title={e.note}>💬</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
