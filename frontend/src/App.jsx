import React, { useState, useEffect } from "react";
import PinLock          from "./components/PinLock.jsx";
import ErrorBoundary    from "./components/ErrorBoundary.jsx";
import SleepModule      from "./components/SleepModule.jsx";
import CalorieModule    from "./components/CalorieModule.jsx";
import TaskModule       from "./components/TaskModule.jsx";
import HabitModule      from "./components/HabitModule.jsx";
import MoodModule       from "./components/MoodModule.jsx";
import ExerciseModule   from "./components/ExerciseModule.jsx";
import HydrationModule  from "./components/HydrationModule.jsx";
import HealthDashboard  from "./components/HealthDashboard.jsx";
import AIInsights       from "./components/AIInsights.jsx";
import HealthChatbot    from "./components/HealthChatbot.jsx";
import WeightModule     from "./components/WeightModule.jsx";
import WeeklyReviewModule     from "./components/WeeklyReviewModule.jsx";
import ChoresModule            from "./components/ChoresModule.jsx";
import NutritionFitnessModule    from "./components/NutritionFitnessModule.jsx";
import BodyMeasurementsModule    from "./components/BodyMeasurementsModule.jsx";
import CorrelationInsights       from "./components/CorrelationInsights.jsx";
import ScreenTimeModule          from "./components/ScreenTimeModule.jsx";
import ProfileModule             from "./components/ProfileModule.jsx";
import SkinCareModule            from "./components/SkinCareModule.jsx";
import RemindersModule           from "./components/RemindersModule.jsx";

const VALID_MODULES = ["sleep","calories","tasks","habits","mood","exercise","hydration","weight","weekly-review","chores","nutrition","body-measurements","screen-time","profile","skin-care","reminders"];

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authed,    setAuthed]    = useState(false);

  useEffect(() => {
    fetch("/api/auth/status", { credentials: "same-origin" })
      .then(r => r.json())
      .then(d => { setAuthed(d.authenticated); setAuthReady(true); })
      .catch(() => { setAuthed(true); setAuthReady(true); }); // fail open locally
  }, []);

  async function lock() {
    await fetch("/api/auth/lock", { method: "POST", credentials: "same-origin" });
    setAuthed(false);
  }

  if (!authReady) return null;
  if (!authed)    return <PinLock onUnlock={() => setAuthed(true)} />;

  return <AuthedApp onLock={lock} />;
}

function AuthedApp({ onLock }) {
  const [module,  setModule]  = useState(() => {
    const hash = window.location.hash.slice(1);
    return VALID_MODULES.includes(hash) ? hash : null;
  });
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    window.history.replaceState({ module }, "", window.location.href);
    function handlePopState(e) {
      const mod = e.state?.module ?? null;
      setModule(mod);
      setAnimKey(k => k + 1);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function navigate(id) {
    window.history.pushState({ module: id }, "", `#${id}`);
    setModule(id);
    setAnimKey(k => k + 1);
  }

  function goHome() {
    window.history.pushState({ module: null }, "", window.location.pathname);
    setModule(null);
    setAnimKey(k => k + 1);
  }

  return (
    <div className="app-root">
      <div key={animKey} className="page-enter">
        <ErrorBoundary>
          {module === null          && <LifeHub onSelect={navigate} onLock={onLock} />}
          {module === "sleep"       && <SleepModule      onBack={goHome} />}
          {module === "calories"    && <CalorieModule    onBack={goHome} />}
          {module === "tasks"       && <TaskModule       onBack={goHome} />}
          {module === "habits"      && <HabitModule      onBack={goHome} />}
          {module === "mood"        && <MoodModule       onBack={goHome} />}
          {module === "exercise"    && <ExerciseModule      onBack={goHome} />}
          {module === "nutrition"   && (
            <NutritionFitnessModule
              onBack={goHome}
              onOpenCalories={() => navigate("calories")}
              onOpenExercise={() => navigate("exercise")}
            />
          )}
          {module === "hydration"   && <HydrationModule   onBack={goHome} />}
          {module === "weight"        && <WeightModule       onBack={goHome} />}
          {module === "weekly-review" && <WeeklyReviewModule onBack={goHome} />}
          {module === "chores"           && <ChoresModule            onBack={goHome} />}
          {module === "body-measurements" && <BodyMeasurementsModule   onBack={goHome} />}
          {module === "screen-time"       && <ScreenTimeModule         onBack={goHome} />}
          {module === "profile"           && <ProfileModule            onBack={goHome} />}
          {module === "skin-care"         && <SkinCareModule           onBack={goHome} />}
          {module === "reminders"         && <RemindersModule          onBack={goHome} />}
        </ErrorBoundary>
      </div>
    </div>
  );
}

const MOOD_SCORE_EMOJI = ["","😞","😟","😕","😐","🙂","😊","😄","😁","🤩","🌟"];

function ModuleTile({ id, icon, label, badge, badgeDanger, statusColor, onSelect }) {
  return (
    <button className="hub-mod-tile" onClick={() => onSelect(id)}>
      <span className="hub-mod-icon">{icon}</span>
      <span className="hub-mod-label">{label}</span>
      {badge != null
        ? <span className={`hub-mod-badge${badgeDanger ? " hub-mod-badge-danger" : ""}`}>{badge}</span>
        : statusColor && <span className="hub-status-dot" style={{ background: statusColor }} />
      }
    </button>
  );
}

function ChoresTile({ onOpen }) {
  const [stats, setStats] = React.useState(null);
  React.useEffect(() => {
    const now = new Date();
    const diff = (now.getDay() + 6) % 7;
    const mon  = new Date(now); mon.setDate(now.getDate() - diff);
    const ws   = `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,"0")}-${String(mon.getDate()).padStart(2,"0")}`;
    fetch(`/api/chores/week?week_start=${ws}`).then(r => r.json()).then(d => setStats(d.stats)).catch(() => {});
  }, []);
  const badge = stats?.total > 0 ? `${stats.completed}/${stats.total}` : null;
  return (
    <button className="hub-mod-tile" onClick={onOpen}>
      <span className="hub-mod-icon">🧹</span>
      <span className="hub-mod-label">Chores</span>
      {badge && <span className="hub-mod-badge">{badge}</span>}
    </button>
  );
}

function LifeHub({ onSelect, onLock }) {
  const now    = new Date();
  const days   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dateStr = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
  const todayISO = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;

  const [hubStatus, setHubStatus] = React.useState(null);
  React.useEffect(() => {
    fetch(`/api/hub/today-status?date=${todayISO}`)
      .then(r => r.json())
      .then(setHubStatus)
      .catch(() => {});
  }, [todayISO]);

  const s = hubStatus;

  // Sleep
  const sleepColor = s ? (s.sleep.logged ? "#4ade80" : "var(--text-dim)") : null;

  // Mood — badge shows emoji + score if logged
  const moodBadge = s?.mood?.logged ? `${MOOD_SCORE_EMOJI[s.mood.score]} ${s.mood.score}` : null;
  const moodColor = s && !s.mood.logged ? "var(--text-dim)" : null;

  // Habits — fraction badge
  const habitsBadge = s?.habits?.total > 0 ? `${s.habits.done}/${s.habits.total}` : null;

  // Hydration — fraction badge
  const hydBadge = s ? `${s.hydration.glasses}/${s.hydration.goal}` : null;

  // Tasks — overdue badge
  const tasksBadge  = s?.tasks?.overdue > 0 ? `${s.tasks.overdue} overdue` : s?.tasks?.active > 0 ? `${s.tasks.active}` : null;
  const tasksDanger = s?.tasks?.overdue > 0;

  return (
    <div className="hub-wrapper">
      <div className="hub-header">
        <h1 className="hub-title">Life Tracker</h1>
        <p className="hub-date">{dateStr}</p>
      </div>

      <ErrorBoundary>
        <HealthDashboard onSelect={onSelect} />
      </ErrorBoundary>

      <ErrorBoundary>
        <AIInsights />
      </ErrorBoundary>

      <div className="hub-nav">
        <div className="hub-nav-group">
          <span className="hub-section-label">Daily</span>
          <div className="hub-modules-grid">
            <ModuleTile id="sleep"  icon="🌙" label="Sleep"  statusColor={sleepColor} onSelect={onSelect} />
            <ModuleTile id="mood"   icon="🎭" label="Mood"   badge={moodBadge} statusColor={moodColor} onSelect={onSelect} />
            <ModuleTile id="habits" icon="🔥" label="Habits" badge={habitsBadge} onSelect={onSelect} />
            <ModuleTile id="tasks"  icon="✅" label="Tasks"  badge={tasksBadge} badgeDanger={tasksDanger} onSelect={onSelect} />
            <ChoresTile onOpen={() => onSelect("chores")} />
          </div>
        </div>

        <div className="hub-nav-group">
          <span className="hub-section-label">Body & Fitness</span>
          <div className="hub-modules-grid">
            <ModuleTile id="nutrition"         icon="⚡" label="Nutrition & Fitness" onSelect={onSelect} />
            <ModuleTile id="hydration"         icon="💧" label="Hydration"           badge={hydBadge} onSelect={onSelect} />
            <ModuleTile id="weight"            icon="⚖️" label="Weight"              onSelect={onSelect} />
            <ModuleTile id="body-measurements" icon="📏" label="Measurements"        onSelect={onSelect} />
          </div>
        </div>

        <div className="hub-nav-group">
          <span className="hub-section-label">Lifestyle & Tools</span>
          <div className="hub-modules-grid">
            <ModuleTile id="screen-time"   icon="📱" label="Screen Time"   onSelect={onSelect} />
            <ModuleTile id="skin-care"     icon="✨" label="Skin Care"     onSelect={onSelect} />
            <ModuleTile id="weekly-review" icon="📋" label="Weekly Review" onSelect={onSelect} />
            <ModuleTile id="reminders"     icon="🔔" label="Reminders"     onSelect={onSelect} />
            <ModuleTile id="profile"       icon="⚙️" label="Profile"       onSelect={onSelect} />
          </div>
        </div>
      </div>

      <ErrorBoundary>
        <CorrelationInsights />
      </ErrorBoundary>

      <ErrorBoundary>
        <HealthChatbot />
      </ErrorBoundary>

      <div className="hub-footer">
        <span>All data stored locally · Groq AI</span>
        {onLock && (
          <button className="hub-lock-btn" onClick={onLock}>🔒 Lock</button>
        )}
      </div>
    </div>
  );
}
