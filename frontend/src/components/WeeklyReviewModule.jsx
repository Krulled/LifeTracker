import React, { useState, useEffect, useCallback } from "react";

function localDateISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

const RATING_LABELS = { 1:"Poor", 2:"Fair", 3:"Good", 4:"Great", 5:"Excellent" };

const CATEGORIES = [
  { key: "sleep",     label: "Sleep",     icon: "🌙" },
  { key: "nutrition", label: "Nutrition", icon: "🥗" },
  { key: "exercise",  label: "Exercise",  icon: "🏋️" },
  { key: "mood",      label: "Mood",      icon: "😊" },
  { key: "habits",    label: "Habits",    icon: "🔥" },
  { key: "overall",   label: "Overall",   icon: "⭐" },
];

const PLAN_FIELDS = [
  { key: "target_sleep_hours",  label: "Sleep",          icon: "🌙", unit: "h / night", step: "0.5", min: "4",  max: "12",  placeholder: "e.g. 7.5" },
  { key: "target_workouts",     label: "Workouts",       icon: "🏋️", unit: "days",       step: "1",   min: "1",  max: "7",   placeholder: "e.g. 4" },
  { key: "target_calorie_days", label: "Calorie Log",    icon: "🥗", unit: "days",       step: "1",   min: "1",  max: "7",   placeholder: "e.g. 5" },
  { key: "target_habit_pct",    label: "Habit Compliance",icon: "🔥", unit: "%",         step: "5",   min: "10", max: "100", placeholder: "e.g. 80" },
];

const SCORE_ROWS = [
  { key: "sleep",        label: "Sleep",     icon: "🌙" },
  { key: "workouts",     label: "Workouts",  icon: "🏋️" },
  { key: "calorie_days", label: "Cal Log",   icon: "🥗" },
  { key: "habit_pct",    label: "Habits",    icon: "🔥" },
];

const LIGHT_COLOR = { green: "#4ade80", yellow: "#f59e0b", red: "#f87171", gray: "#6b7280" };
const LIGHT_LABEL = { green: "Hit ✓", yellow: "Close", red: "Missed", gray: "No data" };

function StarRating({ value, onChange, disabled }) {
  const [hovered, setHovered] = useState(0);
  const display = hovered || value || 0;
  return (
    <div className="star-rating">
      {[1,2,3,4,5].map(star => (
        <button
          key={star}
          type="button"
          className={`star-btn${display >= star ? " filled" : ""}`}
          onMouseEnter={() => !disabled && setHovered(star)}
          onMouseLeave={() => !disabled && setHovered(0)}
          onClick={() => !disabled && onChange(value === star ? 0 : star)}
          disabled={disabled}
          aria-label={`${star} star`}
        >★</button>
      ))}
      {value > 0 && <span className="star-label">{RATING_LABELS[value]}</span>}
    </div>
  );
}

function StatBadge({ icon, label, value, sub, color }) {
  return (
    <div className="wr-stat-badge">
      <span className="wr-stat-badge-icon">{icon}</span>
      <span className="wr-stat-badge-val" style={{ color: color || "var(--text-primary)" }}>{value ?? "—"}</span>
      <span className="wr-stat-badge-label">{label}</span>
      {sub && <span className="wr-stat-badge-sub">{sub}</span>}
    </div>
  );
}

function weekLabel(ws, we) {
  const fmt = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month:"short", day:"numeric" });
  return `${fmt(ws)} – ${fmt(we)}`;
}

function PlanScorecard({ scores }) {
  const rows = SCORE_ROWS.filter(r => scores[r.key]);
  if (!rows.length) return null;
  return (
    <div className="wr-scorecard">
      <div className="wr-scorecard-title">📊 This Week vs Your Plan</div>
      <div className="wr-scorecard-rows">
        {rows.map(r => {
          const s = scores[r.key];
          return (
            <div key={r.key} className="wr-scorecard-row">
              <span className="wr-scorecard-icon">{r.icon}</span>
              <span className="wr-scorecard-label">{r.label}</span>
              <span className="wr-scorecard-nums">
                {s.actual ?? "—"}{s.unit === "h avg" ? "h" : s.unit === "%" ? "%" : ""} / {s.target}{s.unit === "h avg" ? "h" : s.unit === "%" ? "%" : ""}
              </span>
              <span className="wr-scorecard-light" style={{ color: LIGHT_COLOR[s.light] }}>
                ● {LIGHT_LABEL[s.light]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function WeeklyReviewModule({ onBack }) {
  const [weekData,      setWeekData]      = useState(null);
  const [history,       setHistory]       = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [generating,    setGenerating]    = useState(false);
  const [saveMsg,       setSaveMsg]       = useState(null);
  const [expandedPast,  setExpandedPast]  = useState(null);
  const [activeTab,     setActiveTab]     = useState("review");

  // Review form state
  const [ratings,   setRatings]   = useState({ sleep:0, nutrition:0, exercise:0, mood:0, habits:0, overall:0 });
  const [wentWell,  setWentWell]  = useState("");
  const [fellApart, setFellApart] = useState("");
  const [nextFocus, setNextFocus] = useState("");
  const [aiSummary, setAiSummary] = useState("");

  // Plan form state
  const [planForm,    setPlanForm]    = useState({ target_sleep_hours:"", target_workouts:"", target_calorie_days:"", target_habit_pct:"", notes:"" });
  const [planSaving,  setPlanSaving]  = useState(false);
  const [planSaveMsg, setPlanSaveMsg] = useState(null);

  const calGoal = parseInt(localStorage.getItem("cal_goal") || "2000", 10);

  const fetchCurrentWeek = useCallback(async () => {
    const r = await fetch(`/api/weekly-review/current?cal_goal=${calGoal}&date=${localDateISO()}`);
    const d = await r.json();
    setWeekData(d);
    if (d.review) {
      setRatings({
        sleep:     d.review.rating_sleep     || 0,
        nutrition: d.review.rating_nutrition || 0,
        exercise:  d.review.rating_exercise  || 0,
        mood:      d.review.rating_mood      || 0,
        habits:    d.review.rating_habits    || 0,
        overall:   d.review.rating_overall   || 0,
      });
      setWentWell(d.review.went_well   || "");
      setFellApart(d.review.fell_apart || "");
      setNextFocus(d.review.next_focus || "");
      setAiSummary(d.review.ai_summary || "");
    }
    // Load plan (current week, or pre-fill from prev week)
    const src = d.plan || d.prev_plan;
    if (src) {
      setPlanForm({
        target_sleep_hours:  src.target_sleep_hours  ?? "",
        target_workouts:     src.target_workouts     ?? "",
        target_calorie_days: src.target_calorie_days ?? "",
        target_habit_pct:    src.target_habit_pct    ?? "",
        notes:               d.plan ? (src.notes ?? "") : "",
      });
    }
  }, [calGoal]);

  const fetchHistory = useCallback(async () => {
    const r = await fetch("/api/weekly-review");
    const d = await r.json();
    setHistory(Array.isArray(d) ? d : []);
  }, []);

  useEffect(() => {
    Promise.all([fetchCurrentWeek(), fetchHistory()]).finally(() => setLoading(false));
  }, [fetchCurrentWeek, fetchHistory]);

  async function handleSave(e) {
    e.preventDefault();
    if (!weekData) return;
    setSaving(true); setSaveMsg(null);
    const res = await fetch("/api/weekly-review", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        week_start:       weekData.week_start,
        rating_sleep:     ratings.sleep     || null,
        rating_nutrition: ratings.nutrition || null,
        rating_exercise:  ratings.exercise  || null,
        rating_mood:      ratings.mood      || null,
        rating_habits:    ratings.habits    || null,
        rating_overall:   ratings.overall   || null,
        went_well:  wentWell  || null,
        fell_apart: fellApart || null,
        next_focus: nextFocus || null,
      }),
    });
    const saved = await res.json();
    setSaving(false);
    if (!res.ok) { setSaveMsg({ ok:false, text: saved.error || "Save failed" }); return; }
    setSaveMsg({ ok:true, text:"Review saved!" });
    setTimeout(() => setSaveMsg(null), 2500);
    await Promise.all([fetchCurrentWeek(), fetchHistory()]);
  }

  async function handlePlanSave() {
    if (!weekData) return;
    setPlanSaving(true); setPlanSaveMsg(null);
    const res = await fetch("/api/weekly-plan", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week_start: weekData.week_start, ...planForm }),
    });
    const saved = await res.json();
    setPlanSaving(false);
    if (!res.ok) { setPlanSaveMsg({ ok:false, text: saved.error || "Save failed" }); return; }
    setPlanSaveMsg({ ok:true, text:"Plan saved!" });
    setTimeout(() => setPlanSaveMsg(null), 2500);
    await fetchCurrentWeek();
  }

  function fillFromPrevPlan() {
    const src = weekData?.prev_plan;
    if (!src) return;
    setPlanForm({
      target_sleep_hours:  src.target_sleep_hours  ?? "",
      target_workouts:     src.target_workouts     ?? "",
      target_calorie_days: src.target_calorie_days ?? "",
      target_habit_pct:    src.target_habit_pct    ?? "",
      notes:               "",
    });
  }

  async function handleGenerate() {
    if (!weekData?.review) return;
    setGenerating(true);
    const res = await fetch(`/api/weekly-review/${weekData.review.id}/generate-summary`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ cal_goal: calGoal }),
    });
    const d = await res.json();
    setGenerating(false);
    if (d.summary) { setAiSummary(d.summary); await fetchCurrentWeek(); }
  }

  const filledRatings  = Object.values(ratings).filter(Boolean).length;
  const hasReflection  = wentWell || fellApart || nextFocus;
  const hasPlan        = weekData?.plan != null;
  const planScores     = weekData?.plan_scores || {};
  const scoredCount    = Object.keys(planScores).length;
  const metCount       = Object.values(planScores).filter(s => s.light === "green").length;

  if (loading) return (
    <div className="app-wrapper">
      <header className="app-header">
        <button className="back-btn" onClick={onBack}>← Hub</button>
      </header>
      <main style={{ padding:"2rem" }}>
        <div className="brief-loading"><span className="spinner" /> Loading…</div>
      </main>
    </div>
  );

  const stats = weekData?.stats;

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <button className="back-btn" onClick={onBack}>← Hub</button>
          <div className="brand">
            <span className="brand-icon">📋</span>
            <div>
              <div className="brand-name">Weekly Review</div>
              <div className="brand-sub">
                {weekData ? weekLabel(weekData.week_start, weekData.week_end) : ""}
              </div>
            </div>
          </div>
        </div>
        <div className="wr-progress">
          {hasPlan && scoredCount > 0 && (
            <span className={`wr-progress-chip${metCount === scoredCount ? " done" : ""}`}>
              📊 {metCount}/{scoredCount} targets
            </span>
          )}
          <span className={`wr-progress-chip${filledRatings > 0 ? " done" : ""}`}>
            ★ {filledRatings}/6 rated
          </span>
          <span className={`wr-progress-chip${hasReflection ? " done" : ""}`}>
            ✏️ Reflected
          </span>
          <span className={`wr-progress-chip${aiSummary ? " done" : ""}`}>
            🤖 AI
          </span>
        </div>
      </header>

      {/* Tab bar */}
      <div className="wr-tab-bar">
        <button
          className={`wr-tab${activeTab === "plan" ? " active" : ""}`}
          onClick={() => setActiveTab("plan")}
        >
          🎯 Plan
          {hasPlan && <span className="wr-tab-dot" />}
        </button>
        <button
          className={`wr-tab${activeTab === "review" ? " active" : ""}`}
          onClick={() => setActiveTab("review")}
        >
          📋 Review
        </button>
      </div>

      <main style={{ maxWidth:900, margin:"0 auto", padding:"1.25rem 1.5rem" }}>

        {/* ── PLAN TAB ── */}
        {activeTab === "plan" && (
          <div className="wr-plan-layout">
            <div className="card" style={{ padding:"1.25rem" }}>
              <div className="habit-panel-header" style={{ marginBottom:"1rem" }}>
                <span className="habit-panel-title">
                  Set Targets for {weekData ? weekLabel(weekData.week_start, weekData.week_end) : "This Week"}
                </span>
                {weekData?.prev_plan && !hasPlan && (
                  <button className="btn btn-ghost btn-sm" onClick={fillFromPrevPlan}>
                    ↩ Copy last week
                  </button>
                )}
              </div>

              <div className="wr-plan-fields">
                {PLAN_FIELDS.map(f => (
                  <label key={f.key} className="wr-plan-field">
                    <span className="wr-plan-field-label">
                      {f.icon} {f.label}
                    </span>
                    <div className="wr-plan-field-row">
                      <input
                        type="number"
                        step={f.step}
                        min={f.min}
                        max={f.max}
                        placeholder={f.placeholder}
                        value={planForm[f.key]}
                        onChange={e => setPlanForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                        className="wr-plan-input"
                      />
                      <span className="wr-plan-unit">{f.unit}</span>
                    </div>
                  </label>
                ))}
              </div>

              <div className="form-group" style={{ marginTop:"0.75rem", marginBottom:"0.75rem" }}>
                <label className="form-label">Notes / intentions (optional)</label>
                <textarea
                  className="form-input wr-textarea"
                  rows={2}
                  placeholder="What's your focus this week?"
                  value={planForm.notes}
                  onChange={e => setPlanForm(prev => ({ ...prev, notes: e.target.value }))}
                />
              </div>

              {planSaveMsg && (
                <div className={`alert ${planSaveMsg.ok ? "alert-success" : "alert-error"}`} style={{ marginBottom:"0.6rem" }}>
                  {planSaveMsg.ok ? "✓" : "✗"} {planSaveMsg.text}
                </div>
              )}
              <div style={{ display:"flex", gap:"0.5rem" }}>
                <button className="btn btn-primary" onClick={handlePlanSave} disabled={planSaving} style={{ flex:1 }}>
                  {planSaving ? "Saving…" : hasPlan ? "Update Plan" : "Save Plan"}
                </button>
                {weekData?.prev_plan && hasPlan && (
                  <button className="btn btn-ghost btn-sm" onClick={fillFromPrevPlan} title="Copy last week's targets">
                    ↩ Copy last week
                  </button>
                )}
              </div>
            </div>

            {/* Show scorecard in plan tab too if plan exists */}
            {hasPlan && scoredCount > 0 && (
              <PlanScorecard scores={planScores} />
            )}
          </div>
        )}

        {/* ── REVIEW TAB ── */}
        {activeTab === "review" && (
          <form onSubmit={handleSave}>
            {/* Traffic light scorecard */}
            {hasPlan && scoredCount > 0 && (
              <PlanScorecard scores={planScores} />
            )}

            <div className="wr-layout">
              {/* Left column */}
              <div className="wr-left">
                {stats && (
                  <div className="card wr-auto-stats">
                    <div className="habit-panel-header" style={{ marginBottom:"0.85rem" }}>
                      <span className="habit-panel-title">This Week's Data</span>
                      <span style={{ fontSize:"0.7rem", color:"var(--text-dim)" }}>auto-populated</span>
                    </div>
                    <div className="wr-stats-grid">
                      <StatBadge icon="🌙" label="Sleep"
                        value={stats.sleep.avg_hours != null ? `${stats.sleep.avg_hours}h avg` : "No data"}
                        sub={`${stats.sleep.nights}/7 nights · energy ${stats.sleep.avg_energy ?? "—"}/10`}
                        color={stats.sleep.avg_hours >= 7 ? "#4ade80" : stats.sleep.avg_hours >= 6 ? "#f59e0b" : "#f87171"}
                      />
                      <StatBadge icon="🥗" label="Nutrition"
                        value={stats.nutrition.avg_calories != null ? `${stats.nutrition.avg_calories} cal avg` : "No data"}
                        sub={`${stats.nutrition.days_tracked}/7 days · ${stats.nutrition.days_over} days over goal`}
                        color={stats.nutrition.avg_calories && stats.nutrition.avg_calories <= calGoal * 1.1 ? "#4ade80" : "#f59e0b"}
                      />
                      <StatBadge icon="🏋️" label="Exercise"
                        value={stats.exercise.workout_days > 0 ? `${stats.exercise.workout_days} days` : "None"}
                        sub={stats.exercise.total_mins > 0 ? `${stats.exercise.sessions} sessions · ${stats.exercise.total_mins} min` : ""}
                        color={stats.exercise.workout_days >= 3 ? "#4ade80" : stats.exercise.workout_days > 0 ? "#f59e0b" : "var(--text-dim)"}
                      />
                      <StatBadge icon="😊" label="Mood"
                        value={stats.mood.avg_score != null ? `${stats.mood.avg_score}/10` : "No data"}
                        sub={`${stats.mood.days_logged}/7 days logged`}
                        color={stats.mood.avg_score >= 7 ? "#4ade80" : stats.mood.avg_score >= 5 ? "#f59e0b" : "#f87171"}
                      />
                      <StatBadge icon="🔥" label="Habits"
                        value={`${stats.habits.pct}%`}
                        sub={`${stats.habits.logs}/${stats.habits.possible} completed`}
                        color={stats.habits.pct >= 80 ? "#4ade80" : stats.habits.pct >= 50 ? "#f59e0b" : "#f87171"}
                      />
                    </div>
                  </div>
                )}

                <div className="card" style={{ padding:"1.1rem" }}>
                  <div className="habit-panel-header" style={{ marginBottom:"0.9rem" }}>
                    <span className="habit-panel-title">Reflections</span>
                  </div>
                  <div className="form-group">
                    <label className="form-label">✅ What went well this week?</label>
                    <textarea className="form-input wr-textarea" rows={3}
                      placeholder="Wins, streaks, moments you're proud of…"
                      value={wentWell} onChange={e => setWentWell(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">⚠️ What fell apart or needs improvement?</label>
                    <textarea className="form-input wr-textarea" rows={3}
                      placeholder="Be honest — what slipped and why?"
                      value={fellApart} onChange={e => setFellApart(e.target.value)} />
                  </div>
                  <div className="form-group" style={{ marginBottom:0 }}>
                    <label className="form-label">🎯 One focus for next week</label>
                    <textarea className="form-input wr-textarea" rows={2}
                      placeholder="The single most important thing to improve…"
                      value={nextFocus} onChange={e => setNextFocus(e.target.value)} />
                  </div>
                </div>

              </div>

              {/* Right column */}
              <div className="wr-right">
                <div className="card" style={{ padding:"1.1rem" }}>
                  <div className="habit-panel-header" style={{ marginBottom:"0.9rem" }}>
                    <span className="habit-panel-title">Rate Your Week</span>
                    <span style={{ fontSize:"0.7rem", color:"var(--text-dim)" }}>1 = poor · 5 = excellent</span>
                  </div>
                  <div className="wr-ratings-col">
                    {CATEGORIES.map(cat => (
                      <div key={cat.key} className="wr-rating-row">
                        <span className="wr-rating-icon">{cat.icon}</span>
                        <span className="wr-rating-label">{cat.label}</span>
                        <StarRating value={ratings[cat.key]} onChange={v => setRatings(r => ({ ...r, [cat.key]: v }))} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="wr-actions">
                  {saveMsg && (
                    <div className={`alert ${saveMsg.ok ? "alert-success" : "alert-error"}`}>
                      {saveMsg.ok ? "✓" : "✗"} {saveMsg.text}
                    </div>
                  )}
                  <button type="submit" className="btn btn-primary" disabled={saving} style={{ width:"100%" }}>
                    {saving ? "Saving…" : weekData?.review ? "Update Review" : "Save Review"}
                  </button>
                  {weekData?.review && (
                    <button type="button" className="btn btn-ghost wr-ai-btn"
                      onClick={handleGenerate} disabled={generating} style={{ width:"100%", marginTop:"0.5rem" }}>
                      {generating
                        ? <><span className="spinner" style={{ width:13, height:13 }} /> Generating…</>
                        : "🤖 Generate AI Summary"}
                    </button>
                  )}
                  {!weekData?.review && (
                    <p className="wr-ai-hint">Save your review first to generate an AI summary.</p>
                  )}
                </div>

                {aiSummary && (
                  <div className="card wr-ai-summary">
                    <div className="habit-panel-header" style={{ marginBottom:"0.75rem" }}>
                      <span className="habit-panel-title">🤖 AI Coach Summary</span>
                    </div>
                    <p className="wr-ai-text">{aiSummary}</p>
                  </div>
                )}
              </div>
            </div>
          </form>
        )}

        {/* ── Past Reviews ── */}
        {activeTab === "review" && history.filter(r => r.week_start !== weekData?.week_start).length > 0 && (
          <div className="card wr-history-card">
            <div className="habit-panel-header" style={{ marginBottom:"0.75rem" }}>
              <span className="habit-panel-title">Past Reviews</span>
            </div>
            {history.filter(r => r.week_start !== weekData?.week_start).map(r => (
              <div key={r.id} className="wr-past-row">
                <button
                  className="wr-past-toggle"
                  onClick={() => setExpandedPast(expandedPast === r.id ? null : r.id)}
                >
                  <span className="wr-past-week">{weekLabel(r.week_start, r.week_end)}</span>
                  <div className="wr-past-ratings">
                    {CATEGORIES.filter(c => c.key !== "overall").map(c => {
                      const v = r[`rating_${c.key}`];
                      return v
                        ? <span key={c.key} title={c.label}
                            style={{ fontSize:"0.7rem", color: v >= 4 ? "#4ade80" : v >= 3 ? "#f59e0b" : "#f87171" }}>
                            {c.icon}{v}★
                          </span>
                        : null;
                    })}
                  </div>
                  {r.rating_overall && <span className="wr-past-overall">Overall {r.rating_overall}★</span>}
                  <span className="wr-past-chevron">{expandedPast === r.id ? "▲" : "▼"}</span>
                </button>
                {expandedPast === r.id && (
                  <div className="wr-past-body">
                    {r.went_well  && <p><strong>✅ Went well:</strong> {r.went_well}</p>}
                    {r.fell_apart && <p><strong>⚠️ Fell apart:</strong> {r.fell_apart}</p>}
                    {r.next_focus && <p><strong>🎯 Next focus:</strong> {r.next_focus}</p>}
                    {r.ai_summary && (
                      <div className="wr-past-ai">
                        <span className="wr-past-ai-label">🤖 AI Summary</span>
                        <p>{r.ai_summary}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
