import React, { useState, useEffect } from "react";

const PRI_ICONS = { 1: "🔴", 2: "🟠", 3: "🟡", 4: "⚪" };

export default function TodayStrip() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const goal = parseInt(localStorage.getItem("cal_goal") || "2000", 10);
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    fetch(`/api/today?cal_goal=${goal}&date=${localDate}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="today-strip today-strip-skeleton">
        {[0,1,2,3].map(i => <div key={i} className="today-pill-skeleton" />)}
      </div>
    );
  }
  if (!data) return null;

  const { sleep, calories, tasks, habits } = data;
  const calPct   = calories.goal > 0 ? calories.total / calories.goal : 0;
  const calColor = calPct > 1.1 ? "var(--danger)" : calPct > 0.9 ? "var(--warning)" : "var(--success)";
  const habitPct = habits.total > 0 ? habits.done / habits.total : 0;

  return (
    <div className="today-strip">
      {/* Sleep */}
      <div className="today-pill">
        <span className="today-pill-icon">🌙</span>
        <div className="today-pill-text">
          <div className="today-pill-val">
            {sleep ? `${sleep.duration_hours}h` : "—"}
          </div>
          <div className="today-pill-sub">
            {sleep ? `energy ${sleep.energy_score}/10` : "no data yet"}
          </div>
        </div>
      </div>

      <div className="today-strip-div" />

      {/* Calories */}
      <div className="today-pill">
        <span className="today-pill-icon">🥗</span>
        <div className="today-pill-text">
          <div className="today-pill-val" style={{ color: calColor }}>
            {calories.total.toLocaleString()} cal
          </div>
          <div className="today-pill-sub">
            {calories.remaining >= 0
              ? `${calories.remaining.toLocaleString()} remaining`
              : `${Math.abs(calories.remaining).toLocaleString()} over`}
          </div>
        </div>
      </div>

      <div className="today-strip-div" />

      {/* Tasks */}
      <div className="today-pill">
        <span className="today-pill-icon">✅</span>
        <div className="today-pill-text">
          <div className="today-pill-val">{tasks.active} active</div>
          <div className="today-pill-sub today-pill-trunc">
            {tasks.top_task
              ? <>{PRI_ICONS[tasks.top_priority] ?? "🟡"} {tasks.top_task}</>
              : "all clear"}
          </div>
        </div>
      </div>

      <div className="today-strip-div" />

      {/* Habits */}
      <div className="today-pill">
        <span className="today-pill-icon">🔥</span>
        <div className="today-pill-text">
          <div className="today-pill-val">{habits.done}/{habits.total}</div>
          <div className="today-pill-sub">
            {habits.total === 0
              ? "no habits set"
              : habitPct === 1
              ? "all done! 🎉"
              : "habits today"}
          </div>
        </div>
      </div>
    </div>
  );
}
