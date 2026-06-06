import React, { useState, useEffect, useCallback } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";

const ACTIVITY_OPTIONS = [
  { value: "sedentary",   label: "Sedentary",        sub: "Desk job, no exercise" },
  { value: "light",       label: "Lightly Active",   sub: "1–3x / week" },
  { value: "moderate",    label: "Moderately Active", sub: "3–5x / week" },
  { value: "active",      label: "Very Active",       sub: "6–7x / week" },
  { value: "very_active", label: "Athlete",           sub: "Twice/day or physical job" },
];

function inchesToFtIn(totalIn) {
  if (!totalIn) return { ft: "", inch: "" };
  return { ft: Math.floor(totalIn / 12), inch: Math.round(totalIn % 12) };
}

function ftInToInches(ft, inch) {
  const f = parseFloat(ft) || 0;
  const i = parseFloat(inch) || 0;
  if (!f && !i) return null;
  return f * 12 + i;
}

export default function ProfileModule({ onBack }) {
  const [profile,      setProfile]      = useState(null);
  const [computed,     setComputed]     = useState(null);
  const [progress,     setProgress]     = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);

  // Bio fields
  const [ft,       setFt]       = useState("");
  const [inch,     setInch]     = useState("");
  const [weight,   setWeight]   = useState("");
  const [age,      setAge]      = useState("");
  const [sex,      setSex]      = useState("");
  const [activity, setActivity] = useState("moderate");

  // Goal fields
  const [calGoal,      setCalGoal]      = useState("");
  const [sleepGoal,    setSleepGoal]    = useState("7.5");
  const [habitGoalPct, setHabitGoalPct] = useState("75");
  const [goalWeight,   setGoalWeight]   = useState("");
  const [weeklyPace,   setWeeklyPace]   = useState(1.0);

  const fetchProfile = useCallback(async () => {
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    const r = await fetch(`/api/profile?date=${localDate}`);
    const d = await r.json();
    setProgress(d.progress);
    setComputed(d.computed);
    if (d.profile) {
      const p = d.profile;
      setProfile(p);
      const { ft: f, inch: i } = inchesToFtIn(p.height_in);
      setFt(f ?? "");
      setInch(i ?? "");
      setWeight(p.weight_lbs ?? "");
      setAge(p.age ?? "");
      setSex(p.sex ?? "");
      setActivity(p.activity_level ?? "moderate");
      setCalGoal(p.calorie_goal ?? "");
      setSleepGoal(p.sleep_goal_hrs ?? "7.5");
      setHabitGoalPct(p.habit_goal_pct ?? "75");
      setGoalWeight(p.goal_weight_lbs ?? "");
      setWeeklyPace(p.weekly_pace_lbs ?? 1.0);
    }
  }, []);

  useEffect(() => {
    fetchProfile().finally(() => setLoading(false));
  }, [fetchProfile]);

  // Live TDEE — suggested_calories driven by goal weight + pace
  function liveCompute() {
    const h = ftInToInches(ft, inch);
    const w = parseFloat(weight);
    const a = parseInt(age);
    if (!h || !w || !a || !sex) return null;
    const wkg  = w * 0.453592;
    const hcm  = h * 2.54;
    const bmr  = Math.round(10 * wkg + 6.25 * hcm - 5 * a + (sex === "male" ? 5 : -161));
    const mults = { sedentary:1.2, light:1.375, moderate:1.55, active:1.725, very_active:1.9 };
    const tdee  = Math.round(bmr * (mults[activity] ?? 1.55));
    const gw    = parseFloat(goalWeight);
    const pace  = parseFloat(weeklyPace) || 1.0;
    let suggested = tdee;
    if (gw && Math.abs(w - gw) > 0.5) {
      const adj = pace * 500;
      suggested = Math.round(tdee + (w > gw ? -adj : adj));
    }
    return { bmr, tdee, suggested_calories: suggested };
  }

  const liveCalc = liveCompute();
  const display  = liveCalc || computed;

  // Body goal summary for the hint line in Calorie Plan
  const curW = parseFloat(weight);
  const gW   = parseFloat(goalWeight);
  const pace = parseFloat(weeklyPace) || 1.0;
  const bodyGoal = (curW && gW && Math.abs(curW - gW) > 0.5 && display?.tdee) ? {
    diff:      Math.abs(curW - gW),
    direction: curW > gW ? "lose" : "gain",
    weeks:     Math.round(Math.abs(curW - gW) / pace * 10) / 10,
  } : null;

  async function handleSave() {
    setSaving(true);
    const heightIn = ftInToInches(ft, inch);
    const goalType = gW && curW
      ? (curW > gW ? "lose" : curW < gW ? "gain" : "maintain")
      : "maintain";
    const body = {
      height_in:       heightIn,
      weight_lbs:      parseFloat(weight) || null,
      age:             parseInt(age) || null,
      sex:             sex || null,
      activity_level:  activity,
      goal_type:       goalType,
      calorie_goal:    parseInt(calGoal) || display?.suggested_calories || null,
      sleep_goal_hrs:  parseFloat(sleepGoal) || null,
      habit_goal_pct:  parseInt(habitGoalPct) || null,
      goal_weight_lbs: parseFloat(goalWeight) || null,
      weekly_pace_lbs: parseFloat(weeklyPace) || null,
    };
    const r = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    setComputed(d.computed);
    setProfile(d.profile);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    if (body.calorie_goal) localStorage.setItem("cal_goal", String(body.calorie_goal));
  }

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <button className="back-btn" onClick={onBack}>← Hub</button>
          <div className="brand">
            <span className="brand-icon">⚙️</span>
            <div>
              <div className="brand-name">Profile & Goals</div>
              <div className="brand-sub">TDEE · TARGETS · TRACKING</div>
            </div>
          </div>
        </div>
        {saved && <span style={{ fontSize:"0.72rem", color:"var(--success)" }}>✓ Saved</span>}
      </header>

      <main style={{ maxWidth:960, margin:"0 auto", padding:"1.25rem 1.5rem" }}>
        <ErrorBoundary>
          {loading
            ? <div className="brief-loading"><span className="spinner" /> Loading…</div>
            : (
              <div className="prof-layout">

                {/* ── Left column: 2 cards ── */}
                <div className="prof-left">

                  {/* Card 1 — Body Stats */}
                  <div className="card">
                    <div className="habit-panel-header">
                      <span className="habit-panel-title">📐 Body Stats</span>
                    </div>
                    <div className="prof-fields">
                      <div className="form-group">
                        <label className="form-label">Height</label>
                        <div className="prof-height-row">
                          <input className="form-input prof-short-input" type="number" placeholder="ft" min="3" max="8"
                            value={ft} onChange={e => setFt(e.target.value)} />
                          <span className="prof-unit">ft</span>
                          <input className="form-input prof-short-input" type="number" placeholder="in" min="0" max="11"
                            value={inch} onChange={e => setInch(e.target.value)} />
                          <span className="prof-unit">in</span>
                        </div>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Current Weight</label>
                        <div className="prof-inline-input">
                          <input className="form-input" type="number" placeholder="e.g. 185" step="0.1"
                            value={weight} onChange={e => setWeight(e.target.value)} />
                          <span className="prof-unit">lbs</span>
                        </div>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Age</label>
                        <div className="prof-inline-input">
                          <input className="form-input prof-short-input" type="number" placeholder="e.g. 28" min="10" max="100"
                            value={age} onChange={e => setAge(e.target.value)} />
                          <span className="prof-unit">years</span>
                        </div>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Biological Sex</label>
                        <div className="prof-sex-row">
                          {["male","female"].map(s => (
                            <button key={s} type="button"
                              className={`prof-sex-btn${sex === s ? " selected" : ""}`}
                              onClick={() => setSex(s)}>
                              {s === "male" ? "♂ Male" : "♀ Female"}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card 2 — Activity & Weight Goal */}
                  <div className="card" style={{ marginTop:"1rem" }}>
                    <div className="habit-panel-header">
                      <span className="habit-panel-title">🎯 Activity & Weight Goal</span>
                    </div>

                    <p className="prof-section-label">Activity Level</p>
                    <div className="prof-activity-grid">
                      {ACTIVITY_OPTIONS.map(opt => (
                        <button key={opt.value} type="button"
                          className={`prof-activity-btn${activity === opt.value ? " selected" : ""}`}
                          onClick={() => setActivity(opt.value)}>
                          <span className="prof-act-label">{opt.label}</span>
                          <span className="prof-act-sub">{opt.sub}</span>
                        </button>
                      ))}
                    </div>

                    <div className="prof-section-divider" />

                    <p className="prof-section-label">Goal Weight</p>
                    <div className="prof-inline-input" style={{ marginBottom:"0.85rem" }}>
                      <input className="form-input" type="number" placeholder="e.g. 150" step="0.5"
                        value={goalWeight} onChange={e => setGoalWeight(e.target.value)} />
                      <span className="prof-unit">lbs</span>
                    </div>

                    <p className="prof-section-label">Weekly Pace</p>
                    <div className="prof-pace-row">
                      {[0.5, 1.0, 1.5, 2.0].map(p => (
                        <button key={p} type="button"
                          className={`prof-pace-btn${weeklyPace === p ? " selected" : ""}`}
                          onClick={() => setWeeklyPace(p)}>
                          {p} lb/wk
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ── Right column ── */}
                <div className="prof-right">

                  {/* Calorie Plan — prominent, at top */}
                  <div className="card">
                    <div className="habit-panel-header">
                      <span className="habit-panel-title">🔢 Calorie Plan</span>
                    </div>
                    {display ? (() => {
                      const avg    = progress?.calories_7d_avg;
                      const target = display.suggested_calories;
                      const gap    = avg != null ? avg - target : null;
                      return (
                        <>
                          <div className="prof-plan-rows">
                            <div className="prof-plan-row">
                              <span className="prof-plan-label">BMR</span>
                              <div className="prof-plan-right">
                                <span className="prof-plan-val">{display.bmr?.toLocaleString()} <span style={{ fontSize:"0.7rem", color:"var(--text-muted)" }}>kcal</span></span>
                                <span className="prof-plan-sub">base metabolic rate at rest</span>
                              </div>
                            </div>
                            <div className="prof-plan-row">
                              <span className="prof-plan-label">TDEE</span>
                              <div className="prof-plan-right">
                                <span className="prof-plan-val" style={{ color:"var(--accent)" }}>{display.tdee?.toLocaleString()} <span style={{ fontSize:"0.7rem", color:"var(--text-muted)" }}>kcal</span></span>
                                <span className="prof-plan-sub">total daily energy with activity</span>
                              </div>
                            </div>
                            <div className="prof-plan-divider" />
                            <div className="prof-plan-row">
                              <span className="prof-plan-label">Target</span>
                              <div className="prof-plan-right">
                                <span className="prof-plan-val prof-plan-val--lg" style={{ color:"#f59e0b" }}>{target?.toLocaleString()} <span style={{ fontSize:"0.7rem", color:"var(--text-muted)" }}>kcal/day</span></span>
                                <span className="prof-plan-sub">
                                  {bodyGoal
                                    ? `${bodyGoal.direction} ${bodyGoal.diff.toFixed(1)} lbs at ${pace} lb/wk · ~${bodyGoal.weeks} wks`
                                    : "maintenance — at TDEE"}
                                </span>
                              </div>
                            </div>
                            {avg != null && (
                              <>
                                <div className="prof-plan-divider" />
                                <div className="prof-plan-row">
                                  <span className="prof-plan-label">7-day avg</span>
                                  <div className="prof-plan-right">
                                    <span className="prof-plan-val" style={{ color:"var(--text-muted)" }}>{avg.toLocaleString()} <span style={{ fontSize:"0.7rem" }}>kcal</span></span>
                                    <span className="prof-plan-sub" style={{ color: Math.abs(gap) < 150 ? "#4ade80" : gap > 0 ? "#f87171" : "#60a5fa" }}>
                                      {Math.abs(gap) < 10 ? "on target" : gap > 0
                                        ? `+${gap.toLocaleString()} kcal surplus vs target`
                                        : `${gap.toLocaleString()} kcal deficit vs target`}
                                    </span>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                          <button className="btn btn-ghost btn-sm" style={{ marginTop:"0.85rem", width:"100%" }}
                            onClick={async () => {
                              setCalGoal(String(target));
                              setSaving(true);
                              const heightIn = ftInToInches(ft, inch);
                              const goalType = gW && curW
                                ? (curW > gW ? "lose" : curW < gW ? "gain" : "maintain")
                                : "maintain";
                              const body = {
                                height_in:       heightIn,
                                weight_lbs:      parseFloat(weight) || null,
                                age:             parseInt(age) || null,
                                sex:             sex || null,
                                activity_level:  activity,
                                goal_type:       goalType,
                                calorie_goal:    target,
                                sleep_goal_hrs:  parseFloat(sleepGoal) || null,
                                habit_goal_pct:  parseInt(habitGoalPct) || null,
                                goal_weight_lbs: parseFloat(goalWeight) || null,
                                weekly_pace_lbs: parseFloat(weeklyPace) || null,
                              };
                              const r = await fetch("/api/profile", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(body),
                              });
                              const d = await r.json();
                              setComputed(d.computed);
                              setProfile(d.profile);
                              setSaving(false);
                              setSaved(true);
                              setTimeout(() => setSaved(false), 3000);
                              localStorage.setItem("cal_goal", String(target));
                            }}>
                            Apply to calorie target ↓
                          </button>
                        </>
                      );
                    })() : (
                      <p className="prof-body-goal-hint">
                        Fill in Body Stats and Activity Level to see your calorie plan.
                      </p>
                    )}
                  </div>

                  {/* Daily Targets */}
                  <div className="card" style={{ marginTop:"1rem" }}>
                    <div className="habit-panel-header">
                      <span className="habit-panel-title">🎯 Daily Targets</span>
                    </div>

                    <div className="prof-goal-section">
                      <div className="prof-goal-section-header">
                        <span className="prof-goal-section-title">🥗 Calories</span>
                      </div>
                      <div className="prof-inline-input">
                        <input className="form-input" type="number" placeholder="e.g. 2200" step="50"
                          value={calGoal} onChange={e => setCalGoal(e.target.value)} />
                        <span className="prof-unit">kcal/day</span>
                      </div>
                      {progress?.calories_7d_avg && (
                        <div className="prof-progress-hint">
                          7-day avg: <strong>{progress.calories_7d_avg.toLocaleString()} kcal</strong>
                          {calGoal && (
                            <span style={{ color: Math.abs(progress.calories_7d_avg - parseInt(calGoal)) < 200 ? "#4ade80" : "#f59e0b" }}>
                              {" "}({progress.calories_7d_avg > parseInt(calGoal) ? "+" : ""}{(progress.calories_7d_avg - parseInt(calGoal)).toLocaleString()} vs goal)
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="prof-goal-section">
                      <div className="prof-goal-section-header">
                        <span className="prof-goal-section-title">🌙 Sleep</span>
                      </div>
                      <div className="prof-inline-input">
                        <input className="form-input prof-short-input" type="number" placeholder="7.5" step="0.5" min="4" max="12"
                          value={sleepGoal} onChange={e => setSleepGoal(e.target.value)} />
                        <span className="prof-unit">hrs / night</span>
                      </div>
                      {progress?.sleep_7d_avg != null && (
                        <div className="prof-progress-hint">
                          7-day avg: <strong>{progress.sleep_7d_avg}h</strong>
                          {sleepGoal && (
                            <span style={{ color: progress.sleep_7d_avg >= parseFloat(sleepGoal) ? "#4ade80" : progress.sleep_7d_avg >= parseFloat(sleepGoal) * 0.9 ? "#f59e0b" : "#f87171" }}>
                              {" "}({progress.sleep_7d_avg >= parseFloat(sleepGoal) ? "✓ on track" : `${(parseFloat(sleepGoal) - progress.sleep_7d_avg).toFixed(1)}h short`})
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="prof-goal-section">
                      <div className="prof-goal-section-header">
                        <span className="prof-goal-section-title">🔥 Habits</span>
                      </div>
                      <div className="prof-inline-input">
                        <input className="form-input prof-short-input" type="number" placeholder="75" step="5" min="0" max="100"
                          value={habitGoalPct} onChange={e => setHabitGoalPct(e.target.value)} />
                        <span className="prof-unit">% / day</span>
                      </div>
                      {progress?.habit_7d_pct != null && (
                        <div className="prof-progress-hint">
                          7-day avg: <strong>{progress.habit_7d_pct}%</strong>
                          {habitGoalPct && (
                            <span style={{ color: progress.habit_7d_pct >= parseInt(habitGoalPct) ? "#4ade80" : progress.habit_7d_pct >= parseInt(habitGoalPct) * 0.85 ? "#f59e0b" : "#f87171" }}>
                              {" "}({progress.habit_7d_pct >= parseInt(habitGoalPct) ? "✓ on track" : `${parseInt(habitGoalPct) - progress.habit_7d_pct}% short`})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <button className="btn btn-primary" style={{ marginTop:"1rem", width:"100%" }}
                    onClick={handleSave} disabled={saving}>
                    {saving ? "Saving…" : profile ? "Update Profile" : "Save Profile"}
                  </button>

                  {/* 7-day snapshot */}
                  {progress && (
                    <div className="card" style={{ marginTop:"1rem" }}>
                      <div className="habit-panel-header">
                        <span className="habit-panel-title">📊 7-Day Snapshot</span>
                      </div>
                      <div className="prof-snapshot">
                        <div className="prof-snap-row">
                          <span className="prof-snap-icon">🌙</span>
                          <span className="prof-snap-label">Avg sleep</span>
                          <span className="prof-snap-val" style={{ color: progress.sleep_7d_avg >= parseFloat(sleepGoal || 7.5) ? "#00d4aa" : "#f59e0b" }}>
                            {progress.sleep_7d_avg != null ? `${progress.sleep_7d_avg}h` : "—"}
                          </span>
                        </div>
                        <div className="prof-snap-row">
                          <span className="prof-snap-icon">🔥</span>
                          <span className="prof-snap-label">Avg habits</span>
                          <span className="prof-snap-val" style={{ color: (progress.habit_7d_pct ?? 0) >= parseInt(habitGoalPct || 75) ? "#4ade80" : "#f59e0b" }}>
                            {progress.habit_7d_pct != null ? `${progress.habit_7d_pct}%` : "—"}
                          </span>
                        </div>
                        <div className="prof-snap-row">
                          <span className="prof-snap-icon">🥗</span>
                          <span className="prof-snap-label">Avg calories</span>
                          <span className="prof-snap-val" style={{ color:"var(--text-muted)" }}>
                            {progress.calories_7d_avg != null ? `${progress.calories_7d_avg.toLocaleString()} kcal` : "—"}
                          </span>
                        </div>
                      </div>
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
