import React, { useState, useEffect, useCallback } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";

const TAG_GROUPS = [
  { label: "Sleep", tags: ["bad sleep", "poor recovery", "napped", "oversleep"] },
  { label: "Work",  tags: ["stressful work", "long shift", "slow day", "deadline"] },
  { label: "Exercise", tags: ["good workout", "skipped workout", "active day", "rest day"] },
  { label: "Social",   tags: ["socializing", "alone time", "alcohol", "late night"] },
];

function TagPicker({ selected, onChange }) {
  function toggle(tag) {
    onChange(
      selected.includes(tag)
        ? selected.filter(t => t !== tag)
        : [...selected, tag]
    );
  }
  return (
    <div className="mood-tag-picker">
      <span className="mood-tag-heading">Triggers / Context</span>
      {TAG_GROUPS.map(g => (
        <div key={g.label} className="mood-tag-group">
          <span className="mood-tag-group-label">{g.label}</span>
          <div className="mood-tag-chips">
            {g.tags.map(tag => (
              <button
                key={tag}
                type="button"
                className={`mood-tag-chip${selected.includes(tag) ? " active" : ""}`}
                onClick={() => toggle(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function localDateISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function offsetDate(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

const MOOD_EMOJI  = ["","😞","😟","😕","😐","🙂","😊","😄","😁","🤩","🌟"];
const MOOD_LABELS = ["","Awful","Bad","Poor","Meh","Okay","Good","Great","Awesome","Excellent","Perfect"];

function ScoreSlider({ label, value, onChange, colorFn, emoji }) {
  return (
    <div className="mood-slider-group">
      <div className="mood-slider-header">
        <span className="mood-slider-label">{label}</span>
        <span className="mood-slider-val" style={{ color: colorFn(value) }}>
          {emoji ? (MOOD_EMOJI[value] + " ") : ""}{value}/10
        </span>
      </div>
      <input
        type="range" min="1" max="10" value={value}
        className="mood-range"
        style={{ "--track-fill": colorFn(value) }}
        onChange={e => onChange(parseInt(e.target.value, 10))}
      />
      {emoji && <span className="mood-desc">{MOOD_LABELS[value]}</span>}
    </div>
  );
}

function moodColor(v)    { return v >= 7 ? "#4ade80" : v >= 5 ? "#f59e0b" : "#f87171"; }
function energyColor(v)  { return v >= 7 ? "#00d4aa" : v >= 5 ? "#60a5fa" : "#f87171"; }
function anxietyColor(v) { return v <= 3 ? "#4ade80" : v <= 6 ? "#f59e0b" : "#f87171"; }

function MoodSparkline({ history }) {
  const entries = [...history].reverse().slice(-7);
  if (entries.length < 2) return null;
  const W = 110, H = 34, PAD = 5;
  const n = entries.length;
  const xs = entries.map((_, i) => PAD + (i / (n - 1)) * (W - PAD * 2));
  const ys = entries.map(e  => PAD + ((10 - e.mood_score) / 9) * (H - PAD * 2));
  const pts = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display:"block", flexShrink:0 }}>
      <polyline points={pts} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" strokeLinejoin="round" />
      {entries.map((e, i) => (
        <circle key={i} cx={xs[i]} cy={ys[i]} r="2.8" fill={moodColor(e.mood_score)} />
      ))}
    </svg>
  );
}

export default function MoodModule({ onBack }) {
  const today = localDateISO();

  const [selectedDate, setSelectedDate] = useState(today);
  const [dayEntry,    setDayEntry]    = useState(null);
  const [history,     setHistory]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [editMode,    setEditMode]    = useState(false);

  // Form state
  const [mood,    setMood]    = useState(7);
  const [energy,  setEnergy]  = useState(7);
  const [anxiety, setAnxiety] = useState(3);
  const [note,    setNote]    = useState("");
  const [tags,    setTags]    = useState([]);

  const fetchSelected = useCallback(async () => {
    const r = await fetch(`/api/mood?date=${selectedDate}`);
    const d = await r.json();
    if (d) {
      setDayEntry(d);
      setMood(d.mood_score);
      setEnergy(d.energy_score ?? 7);
      setAnxiety(d.anxiety_score ?? 3);
      setNote(d.note ?? "");
      setTags(d.tags ?? []);
    } else {
      setDayEntry(null);
      setMood(7); setEnergy(7); setAnxiety(3); setNote(""); setTags([]);
    }
  }, [selectedDate]);

  const fetchHistory = useCallback(async () => {
    const r = await fetch("/api/mood?limit=14");
    setHistory(await r.json());
  }, []);

  useEffect(() => {
    setLoading(true);
    setEditMode(false);
    Promise.all([fetchSelected(), fetchHistory()]).finally(() => setLoading(false));
  }, [fetchSelected, fetchHistory]);

  async function handleSave() {
    setSaving(true); setSaved(false);
    await fetch("/api/mood", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry_date: selectedDate, mood_score: mood, energy_score: energy, anxiety_score: anxiety, note, tags }),
    });
    setSaving(false); setSaved(true); setEditMode(false);
    setTimeout(() => setSaved(false), 3000);
    await fetchSelected();
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

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <button className="back-btn" onClick={onBack}>← Hub</button>
          <div className="brand">
            <span className="brand-icon">😊</span>
            <div>
              <div className="brand-name">Mood</div>
              <div className="brand-sub">MENTAL WELLNESS LOG</div>
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
              <div className="mood-layout">
                {/* Check-in card */}
                <div className="card mood-checkin-card">
                  <div className="habit-panel-header">
                    <span className="habit-panel-title">
                      {dayEntry && !editMode
                        ? (isToday ? "Today's Check-in" : `${dateLabel}'s Check-in`)
                        : (isToday ? "Daily Check-in" : `Log ${dateLabel}`)}
                    </span>
                    {dayEntry && !editMode && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditMode(true)}>✎ Edit</button>
                    )}
                  </div>

                  {dayEntry && !editMode ? (
                    <div className="mood-summary">
                      <div className="mood-summary-row">
                        <span className="mood-sum-icon">😊</span>
                        <span className="mood-sum-label">Mood</span>
                        <div className="mood-sum-bar-wrap">
                          <div className="mood-sum-bar" style={{ width:`${dayEntry.mood_score*10}%`, background: moodColor(dayEntry.mood_score) }} />
                        </div>
                        <span className="mood-sum-val" style={{ color: moodColor(dayEntry.mood_score) }}>
                          {MOOD_EMOJI[dayEntry.mood_score]} {dayEntry.mood_score}/10
                        </span>
                      </div>
                      {dayEntry.energy_score && (
                        <div className="mood-summary-row">
                          <span className="mood-sum-icon">⚡</span>
                          <span className="mood-sum-label">Energy</span>
                          <div className="mood-sum-bar-wrap">
                            <div className="mood-sum-bar" style={{ width:`${dayEntry.energy_score*10}%`, background: energyColor(dayEntry.energy_score) }} />
                          </div>
                          <span className="mood-sum-val" style={{ color: energyColor(dayEntry.energy_score) }}>
                            {dayEntry.energy_score}/10
                          </span>
                        </div>
                      )}
                      {dayEntry.anxiety_score && (
                        <div className="mood-summary-row">
                          <span className="mood-sum-icon">🧘</span>
                          <span className="mood-sum-label">Anxiety</span>
                          <div className="mood-sum-bar-wrap">
                            <div className="mood-sum-bar" style={{ width:`${dayEntry.anxiety_score*10}%`, background: anxietyColor(dayEntry.anxiety_score) }} />
                          </div>
                          <span className="mood-sum-val" style={{ color: anxietyColor(dayEntry.anxiety_score) }}>
                            {dayEntry.anxiety_score}/10
                          </span>
                        </div>
                      )}
                      {dayEntry.tags?.length > 0 && (
                        <div className="mood-tag-display">
                          {dayEntry.tags.map(t => (
                            <span key={t} className="mood-tag-chip active" style={{ cursor:"default" }}>{t}</span>
                          ))}
                        </div>
                      )}
                      {dayEntry.note && (
                        <p className="mood-note-display">"{dayEntry.note}"</p>
                      )}
                    </div>
                  ) : (
                    <div className="mood-form">
                      <ScoreSlider label="Mood" value={mood} onChange={setMood} colorFn={moodColor} emoji />
                      <ScoreSlider label="Energy" value={energy} onChange={setEnergy} colorFn={energyColor} emoji={false} />
                      <ScoreSlider label="Anxiety (1=calm, 10=anxious)" value={anxiety} onChange={setAnxiety} colorFn={anxietyColor} emoji={false} />
                      <TagPicker selected={tags} onChange={setTags} />
                      <div className="form-group" style={{ marginTop:"0.75rem" }}>
                        <label className="form-label">Note (optional)</label>
                        <textarea
                          className="form-input"
                          placeholder="How are you feeling today?"
                          value={note}
                          onChange={e => setNote(e.target.value)}
                          rows={3}
                          style={{ resize: "vertical" }}
                        />
                      </div>
                      <div style={{ display:"flex", gap:"0.5rem", marginTop:"1rem" }}>
                        <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex:1 }}>
                          {saving ? "Saving…" : dayEntry ? "Update" : "Save Check-in"}
                        </button>
                        {editMode && (
                          <button className="btn btn-ghost" onClick={() => setEditMode(false)}>Cancel</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* History — click row to jump to that day */}
                <div className="card mood-history-card">
                  <div className="habit-panel-header" style={{ alignItems:"center" }}>
                    <span className="habit-panel-title">14-Day History</span>
                    <MoodSparkline history={history} />
                    <span style={{ fontSize:"0.65rem", color:"var(--text-dim)" }}>click to edit</span>
                  </div>
                  {history.length === 0 ? (
                    <p style={{ padding:"1rem", color:"var(--text-dim)", fontSize:"0.82rem" }}>No entries yet.</p>
                  ) : (
                    <div className="mood-hist-list">
                      {history.map(e => {
                        const label = new Date(e.entry_date + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });
                        const isActive = e.entry_date === selectedDate;
                        return (
                          <div
                            key={e.id}
                            className={`mood-hist-row${isActive ? " mood-hist-row--active" : ""}`}
                            onClick={() => setSelectedDate(e.entry_date)}
                            style={{ cursor:"pointer" }}
                          >
                            <span className="mood-hist-date">{label}</span>
                            <span className="mood-hist-emoji">{MOOD_EMOJI[e.mood_score]}</span>
                            <div className="mood-hist-bars">
                              <div className="mood-hist-bar" style={{ width:`${e.mood_score*10}%`, background: moodColor(e.mood_score) }} title={`Mood: ${e.mood_score}`} />
                              {e.energy_score && <div className="mood-hist-bar" style={{ width:`${e.energy_score*10}%`, background: energyColor(e.energy_score) }} title={`Energy: ${e.energy_score}`} />}
                            </div>
                            <span className="mood-hist-score" style={{ color: moodColor(e.mood_score) }}>{e.mood_score}/10</span>
                            {e.tags?.length > 0 && (
                              <div className="mood-hist-tags">
                                {e.tags.map(t => <span key={t} className="mood-hist-tag">{t}</span>)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
