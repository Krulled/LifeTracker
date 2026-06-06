import React, { useState, useEffect } from "react";

const MOOD_EMOJI = ["","😞","😟","😕","😐","🙂","😊","😄","😁","🤩","🌟"];

function Delta({ current, prev, invert, decimals = 1 }) {
  if (current == null || prev == null) return null;
  const diff = parseFloat((current - prev).toFixed(decimals));
  if (diff === 0) return null;
  const positive = invert ? diff < 0 : diff > 0;
  const arrow = diff > 0 ? "↑" : "↓";
  const abs   = Math.abs(diff);
  const label = decimals === 0 ? abs : abs.toFixed(decimals).replace(/\.0$/, "");
  return (
    <span className={`hd-delta ${positive ? "hd-delta-pos" : "hd-delta-neg"}`}>
      {arrow}{label}
    </span>
  );
}

function localDateISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function ProgressBar({ pct, color, thin }) {
  const clampPct = Math.min(1, Math.max(0, pct));
  return (
    <div className={`health-bar-track${thin ? " thin" : ""}`}>
      <div className="health-bar-fill" style={{ width:`${(clampPct*100).toFixed(1)}%`, background: color }} />
    </div>
  );
}

function StatusDot({ color }) {
  return <span className="health-status-dot" style={{ background: color }} />;
}

// Fuel & Body: nutrition+fitness (combined), hydration, weight
function PhysicalCard({ data, onSelect }) {
  if (!data) return (
    <div className="health-card card health-card-skeleton">
      <div className="health-card-shimmer" />
    </div>
  );

  const { calories, exercise, hydration, weight, yesterday } = data;

  const hydPct  = hydration.goal > 0 ? hydration.glasses / hydration.goal : 0;
  const hasEx   = exercise.total_minutes > 0;
  const hasWt   = weight && weight.current != null;

  const burned    = exercise.calories_burned || 0;
  const net       = calories.total - burned;
  const netPct    = calories.goal > 0 ? net / calories.goal : 0;
  const remaining = calories.goal - net;
  const isNetOver = calories.goal > 0 && remaining < 0;
  const netColor  = isNetOver ? "#f87171" : netPct > 0.9 ? "#f59e0b" : "#4ade80";

  const hydColor  = hydPct >= 1 ? "#00d4aa" : hydPct >= 0.5 ? "#60a5fa" : "#f59e0b";
  const exColor   = hasEx ? "#c084fc" : "var(--text-dim)";

  // Weight change color
  const wtChange  = hasWt && weight.change != null ? weight.change : null;
  const wtColor   = !hasWt ? "var(--text-dim)"
                  : wtChange == null ? "var(--text-muted)"
                  : wtChange < 0 ? "#4ade80"
                  : wtChange > 0 ? "#f87171"
                  : "#f59e0b";

  // Overall physical score
  const hasCalories = calories.total > 0 && calories.total <= calories.goal * 1.15;
  const score = [hasCalories, hasEx, hydPct >= 0.5].filter(Boolean).length;
  const dotColor = score === 3 ? "#4ade80" : score >= 1 ? "#f59e0b" : "var(--text-dim)";

  return (
    <div className="health-card card">
      <div className="health-card-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.5rem" }}>
          <StatusDot color={dotColor} />
          <span className="health-card-title">FUEL & BODY</span>
        </div>
        <span className="health-card-score" style={{ color: dotColor }}>
          {score === 3 ? "On Track" : score >= 1 ? "In Progress" : "Not Started"}
        </span>
      </div>

      <div className="health-stats">
        {/* Nutrition + Fitness — combined row */}
        <div className="health-stat hd-nf-stat" onClick={() => onSelect("nutrition")} title="Open Nutrition & Fitness">
          <div className="health-stat-row">
            <span className="health-stat-icon">⚡</span>
            <span className="health-stat-label">Nutrition & Fitness</span>
            <span className="hd-nf-arrow">→</span>
          </div>

          {/* Equation line: eaten − burned = net */}
          <div className="hd-nf-eq">
            <span className="hd-nf-eq-piece">
              <span className="hd-nf-eq-num">{calories.total > 0 ? calories.total.toLocaleString() : "—"}</span>
              <span className="hd-nf-eq-lbl">eaten</span>
            </span>
            <span className="hd-nf-eq-op">−</span>
            <span className="hd-nf-eq-piece">
              <span className="hd-nf-eq-num" style={{ color: "#c084fc" }}>{burned > 0 ? burned.toLocaleString() : "—"}</span>
              <span className="hd-nf-eq-lbl">burned 🔥</span>
            </span>
            <span className="hd-nf-eq-op">=</span>
            <span className="hd-nf-eq-piece">
              <span className="hd-nf-eq-num" style={{ color: calories.total > 0 ? netColor : "var(--text-dim)" }}>
                {calories.total > 0 ? net.toLocaleString() : "—"}
              </span>
              <span className="hd-nf-eq-lbl">net</span>
            </span>
            {calories.total > 0 && (
              <span className={`hd-nf-badge${isNetOver ? " over" : ""}`}>
                {isNetOver ? "+" : ""}{Math.abs(remaining).toLocaleString()} {isNetOver ? "over" : "left"}
              </span>
            )}
          </div>

          {/* Exercise sub-line */}
          <div className="hd-nf-ex-line" style={{ color: exColor }}>
            🏋️ {hasEx ? `${exercise.total_minutes} min · ${exercise.sessions} session${exercise.sessions !== 1 ? "s" : ""}` : "No workout logged"}
          </div>

          {/* Net progress bar */}
          <ProgressBar pct={Math.min(netPct, 1)} color={netColor} thin />
        </div>

        {/* Hydration */}
        <div className="health-stat">
          <div className="health-stat-row">
            <span className="health-stat-icon">💧</span>
            <span className="health-stat-label">Hydration</span>
            <span className="health-stat-val" style={{ color: hydColor }}>
              {hydration.glasses} / {hydration.goal} glasses
              <Delta current={hydration.glasses} prev={yesterday?.hydration_glasses} decimals={0} />
            </span>
          </div>
          <ProgressBar pct={hydPct} color={hydColor} thin />
        </div>

        {/* Weight */}
        <div className="health-stat">
          <div className="health-stat-row">
            <span className="health-stat-icon">⚖️</span>
            <span className="health-stat-label">Weight</span>
            <span className="health-stat-val" style={{ color: wtColor }}>
              {hasWt
                ? <>
                    {weight.current} lbs
                    {wtChange != null && (
                      <span style={{ fontSize:"0.7rem", marginLeft:"0.4rem" }}>
                        {wtChange > 0 ? "+" : ""}{wtChange.toFixed(1)} lbs
                      </span>
                    )}
                  </>
                : "No data"}
            </span>
          </div>
        </div>
      </div>

      <div className="health-modules">
        <button className="health-mod-btn hd-mod-nf" onClick={() => onSelect("nutrition")}>⚡ Nutrition & Fitness</button>
        <button className="health-mod-btn" onClick={() => onSelect("hydration")}>💧 Hydration</button>
        <button className="health-mod-btn" onClick={() => onSelect("weight")}>⚖️ Weight</button>
      </div>
    </div>
  );
}

function GoalBar({ value, goal, color, formatVal, formatGoal }) {
  if (!goal || value == null) return null;
  const pct   = Math.min(value / goal, 1);
  const label = `${formatVal(value)} / ${formatGoal(goal)} goal`;
  return (
    <div className="health-goal-bar-wrap" title={label}>
      <div className="health-goal-bar-track">
        <div className="health-goal-bar-fill" style={{ width:`${(pct*100).toFixed(1)}%`, background: color }} />
        <div className="health-goal-bar-marker" />
      </div>
      <span className="health-goal-bar-label">{label}</span>
    </div>
  );
}

// Rest & Mind: sleep, mood, habits
function MentalCard({ data, onSelect, goals, progress }) {
  if (!data) return (
    <div className="health-card card health-card-skeleton">
      <div className="health-card-shimmer" />
    </div>
  );

  const { sleep, mood, habits, yesterday } = data;

  const sleepOk   = sleep ? sleep.duration_hours >= 6 && sleep.energy_score >= 5 : false;
  const moodOk    = mood ? mood.score >= 5 : false;
  const habitsOk  = habits.total > 0 ? (habits.done / habits.total) >= 0.5 : false;

  const score    = [sleepOk, moodOk, habitsOk].filter(Boolean).length;
  const dotColor = score === 3 ? "#4ade80" : score >= 1 ? "#f59e0b" : "var(--text-dim)";

  const habitPct   = habits.total > 0 ? habits.done / habits.total : 0;
  const habitColor = habitPct >= 1 ? "#c084fc" : habitPct >= 0.5 ? "#f59e0b" : habits.total === 0 ? "var(--text-dim)" : "#f87171";
  const moodColor  = mood ? (mood.score >= 7 ? "#4ade80" : mood.score >= 5 ? "#f59e0b" : "#f87171") : "var(--text-dim)";
  const sleepColor = sleep ? (sleep.duration_hours >= 7 ? "#00d4aa" : sleep.duration_hours >= 6 ? "#f59e0b" : "#f87171") : "var(--text-dim)";

  // Goal bar colors
  const sleepGoalColor = progress?.sleep_7d_avg >= (goals?.sleep_goal_hrs ?? 99)
    ? "#00d4aa" : progress?.sleep_7d_avg >= (goals?.sleep_goal_hrs ?? 99) * 0.9 ? "#f59e0b" : "#f87171";
  const habitGoalColor = (progress?.habit_7d_pct ?? 0) >= (goals?.habit_goal_pct ?? 101)
    ? "#4ade80" : (progress?.habit_7d_pct ?? 0) >= (goals?.habit_goal_pct ?? 101) * 0.85 ? "#f59e0b" : "#f87171";

  return (
    <div className="health-card card">
      <div className="health-card-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.5rem" }}>
          <StatusDot color={dotColor} />
          <span className="health-card-title">REST & MIND</span>
        </div>
        <span className="health-card-score" style={{ color: dotColor }}>
          {score === 3 ? "Balanced" : score >= 1 ? "Check In" : "Needs Attention"}
        </span>
      </div>

      <div className="health-stats">
        {/* Sleep */}
        <div className="health-stat">
          <div className="health-stat-row">
            <span className="health-stat-icon">🌙</span>
            <span className="health-stat-label">Sleep</span>
            <span className="health-stat-val" style={{ color: sleepColor }}>
              {sleep ? `${sleep.duration_hours}h · energy ${sleep.energy_score}/10` : "No data"}
            </span>
            <Delta current={sleep?.duration_hours} prev={yesterday?.sleep_hours} />
          </div>
          <GoalBar
            value={progress?.sleep_7d_avg}
            goal={goals?.sleep_goal_hrs}
            color={sleepGoalColor}
            formatVal={v => `${v}h avg`}
            formatGoal={g => `${g}h`}
          />
        </div>

        {/* Mood */}
        <div className="health-stat">
          <div className="health-stat-row">
            <span className="health-stat-icon">😊</span>
            <span className="health-stat-label">Mood</span>
            <span className="health-stat-val" style={{ color: moodColor }}>
              {mood ? `${MOOD_EMOJI[mood.score]} ${mood.score}/10` : "Not logged"}
            </span>
            <Delta current={mood?.score} prev={yesterday?.mood_score} decimals={0} />
          </div>
          {mood && <ProgressBar pct={mood.score / 10} color={moodColor} thin />}
        </div>

        {/* Habits */}
        <div className="health-stat">
          <div className="health-stat-row">
            <span className="health-stat-icon">🔥</span>
            <span className="health-stat-label">Habits</span>
            <span className="health-stat-val" style={{ color: habitColor }}>
              {habits.total === 0 ? "None set" : `${habits.done}/${habits.total} today${habitPct === 1 ? " 🎉" : ""}`}
            </span>
            <Delta current={habits.total > 0 ? Math.round(habits.done / habits.total * 100) : null} prev={yesterday?.habit_pct} decimals={0} />
          </div>
          {habits.total > 0 && <ProgressBar pct={habitPct} color={habitColor} thin />}
          <GoalBar
            value={progress?.habit_7d_pct}
            goal={goals?.habit_goal_pct}
            color={habitGoalColor}
            formatVal={v => `${v}% avg`}
            formatGoal={g => `${g}%`}
          />
        </div>
      </div>

      <div className="health-modules">
        <button className="health-mod-btn" onClick={() => onSelect("sleep")}>🌙 Sleep</button>
        <button className="health-mod-btn" onClick={() => onSelect("mood")}>😊 Mood</button>
        <button className="health-mod-btn" onClick={() => onSelect("habits")}>🔥 Habits</button>
      </div>
    </div>
  );
}

// Energy Balance — full-width card below the Physical/Mental pair
function EnergyBalanceCard({ data }) {
  if (!data) return (
    <div className="energy-card card energy-card-skeleton">
      <div className="health-card-shimmer" />
    </div>
  );

  const eb       = data.energy_balance;
  const consumed = eb.consumed;
  const burned   = eb.burned;
  const net      = eb.net;
  const goal     = eb.goal;
  const balance  = eb.balance;          // positive = deficit, negative = surplus

  const isOnTarget = Math.abs(balance) <= 50;
  const isDeficit  = balance > 50;
  const isSurplus  = balance < -50;

  const statusColor = isOnTarget
    ? "#f59e0b"
    : isDeficit
      ? "#4ade80"
      : Math.abs(balance) > 300 ? "#f87171" : "#f59e0b";

  const statusLabel = isOnTarget
    ? "On Target"
    : isDeficit
      ? `${balance.toLocaleString()} cal deficit`
      : `${Math.abs(balance).toLocaleString()} cal surplus`;

  const statusIcon = isOnTarget ? "🎯" : isDeficit ? "📉" : "📈";

  // Bar: show consumed as fraction of goal, burned offsets it
  const consumedPct = goal > 0 ? Math.min(consumed / goal * 100, 100) : 0;
  const netPct      = goal > 0 ? Math.min(Math.max(net / goal * 100, 0), 100) : 0;
  const burnedPct   = consumedPct - netPct;   // visual width of "burned" offset segment

  const barColor = isSurplus
    ? (Math.abs(balance) > 300 ? "#f87171" : "#f59e0b")
    : "#00d4aa";

  return (
    <div className="energy-card card">
      {/* Header */}
      <div className="energy-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.5rem" }}>
          <span className="energy-header-icon">⚡</span>
          <span className="energy-header-title">TODAY'S BALANCE</span>
          <span className="energy-header-sub">Calorie flow</span>
        </div>
        <span className="energy-status-badge" style={{ color: statusColor, borderColor: statusColor }}>
          {statusIcon} {statusLabel}
        </span>
      </div>

      {/* Three-column flow */}
      <div className="energy-flow">
        <div className="energy-col">
          <span className="energy-col-icon">🥗</span>
          <span className="energy-col-num">{consumed > 0 ? consumed.toLocaleString() : "—"}</span>
          <span className="energy-col-label">Consumed</span>
          <span className="energy-col-sub">{data.calories.items} item{data.calories.items !== 1 ? "s" : ""} logged</span>
        </div>

        <div className="energy-operator">−</div>

        <div className="energy-col">
          <span className="energy-col-icon">🏋️</span>
          <span className="energy-col-num" style={{ color: burned > 0 ? "#c084fc" : "var(--text-dim)" }}>
            {burned > 0 ? burned.toLocaleString() : "—"}
          </span>
          <span className="energy-col-label">Burned</span>
          <span className="energy-col-sub">
            {burned > 0
              ? `${data.exercise.sessions} session${data.exercise.sessions !== 1 ? "s" : ""}`
              : "No exercise logged"}
          </span>
        </div>

        <div className="energy-operator">=</div>

        <div className="energy-col energy-col-net">
          <span className="energy-col-icon">⚡</span>
          <span className="energy-col-num" style={{ color: statusColor }}>
            {net > 0 ? net.toLocaleString() : consumed > 0 ? "0" : "—"}
          </span>
          <span className="energy-col-label">Net Calories</span>
          <span className="energy-col-sub" style={{ color: statusColor }}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="energy-bar-section">
        <div className="energy-bar-track">
          {/* Net calories portion */}
          {netPct > 0 && (
            <div
              className="energy-bar-segment net"
              style={{ width: `${netPct}%`, background: barColor }}
            />
          )}
          {/* Burned offset portion */}
          {burnedPct > 0 && (
            <div
              className="energy-bar-segment burned"
              style={{ width: `${burnedPct}%`, background: "#c084fc", opacity: 0.7 }}
            />
          )}
          {/* Goal marker line */}
          <div className="energy-bar-goal-marker" />
        </div>
        <div className="energy-bar-labels">
          <span style={{ color:"var(--text-dim)", fontSize:"0.68rem" }}>0</span>
          <span style={{ fontSize:"0.7rem", color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>
            Net {net > 0 ? net.toLocaleString() : "0"} / {goal.toLocaleString()} cal goal
          </span>
          <span style={{ color:"var(--text-dim)", fontSize:"0.68rem" }}>{goal.toLocaleString()}</span>
        </div>

        {/* Legend */}
        {burned > 0 && (
          <div className="energy-legend">
            <span className="energy-legend-dot" style={{ background: barColor }} />
            <span>Net intake</span>
            <span className="energy-legend-dot" style={{ background: "#c084fc", opacity:0.8 }} />
            <span>Exercise offset</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HealthDashboard({ onSelect }) {
  const [data,    setData]    = useState(null);
  const [goals,   setGoals]   = useState(null);
  const [progress,setProgress]= useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    setLoading(true);

    fetch(`/api/profile?date=${localDate}`)
      .then(r => r.json())
      .then(d => {
        if (d.profile) {
          setGoals(d.profile);
          if (d.profile.calorie_goal) localStorage.setItem("cal_goal", String(d.profile.calorie_goal));
        }
        if (d.progress) setProgress(d.progress);
        const goal = d.profile?.calorie_goal || parseInt(localStorage.getItem("cal_goal") || "2000", 10);
        return fetch(`/api/today?cal_goal=${goal}&date=${localDate}`);
      })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [refreshKey]);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") setRefreshKey(k => k + 1);
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return (
    <div className="health-dashboard">
      <EnergyBalanceCard data={loading ? null : data} />
      <PhysicalCard data={loading ? null : data} onSelect={onSelect} goals={goals} />
      <MentalCard   data={loading ? null : data} onSelect={onSelect} goals={goals} progress={progress} />
    </div>
  );
}
