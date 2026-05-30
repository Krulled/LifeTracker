import React, { useState, useEffect, useCallback, useRef } from "react";
import SkinProductScanner from "./SkinProductScanner.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";

const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function compressImage(file) {
  return new Promise((resolve) => {
    const MAX_DIM = 1024;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w > h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
        else       { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const [header, b64] = e.target.result.split(",");
          const mime = header.match(/:(.*?);/)[1];
          resolve({ b64, mime });
        };
        reader.readAsDataURL(blob);
      }, "image/jpeg", 0.82);
    };
    img.src = url;
  });
}

function toDateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function localDateISO() { return toDateISO(new Date()); }

// ---------------------------------------------------------------------------
// DateNavigator
// ---------------------------------------------------------------------------
function DateNavigator({ selectedDate, today, onChange }) {
  function shift(delta) {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + delta);
    const next = toDateISO(d);
    if (next <= today) onChange(next);
  }
  const d       = new Date(selectedDate + "T12:00:00");
  const isToday = selectedDate === today;
  const label   = isToday ? "Today" : `${DAY_NAMES[d.getDay()]} · ${selectedDate}`;
  return (
    <div className="ex-date-nav">
      <button className="ex-date-nav-btn" onClick={() => shift(-1)}>‹</button>
      <div className="ex-date-nav-center">
        <span className="ex-date-nav-label">{label}</span>
        {!isToday && <button className="ex-date-nav-today" onClick={() => onChange(today)}>↩ Today</button>}
      </div>
      <button className="ex-date-nav-btn" onClick={() => shift(1)} disabled={isToday}>›</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusDot
// ---------------------------------------------------------------------------
function StatusDot({ color }) {
  return <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:color, flexShrink:0 }} />;
}

// ---------------------------------------------------------------------------
// StepItem
// ---------------------------------------------------------------------------
function StepItem({ step, completed, productUsed, onToggle, onProductSave, onRename, onDelete }) {
  const [editing,   setEditing]   = useState(false);
  const [renameVal, setRenameVal] = useState(step.name);
  const [product,   setProduct]   = useState(productUsed || "");
  const productRef = useRef(null);

  useEffect(() => { setProduct(productUsed || ""); }, [productUsed]);

  function handleRenameKey(e) {
    if (e.key === "Enter")  { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { setEditing(false); setRenameVal(step.name); }
  }
  function commitRename() {
    const v = renameVal.trim();
    if (v && v !== step.name) onRename(step.step_id, v);
    setEditing(false);
  }
  function handleProductBlur() { onProductSave(step.step_id, product.trim()); }

  return (
    <div className={`sc-step-item${completed ? " sc-step-done" : ""}`}>
      <button
        className={`sc-check-btn${completed ? " sc-check-on" : ""}`}
        onClick={() => onToggle(step.step_id, completed)}
        aria-label={completed ? "Mark incomplete" : "Mark complete"}
      >
        {completed ? "✓" : ""}
      </button>
      <div className="sc-step-body">
        {editing ? (
          <input
            className="form-input sc-rename-input"
            value={renameVal}
            onChange={e => setRenameVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKey}
            autoFocus
          />
        ) : (
          <span className={`sc-step-name${completed ? " sc-step-name-done" : ""}`}
            onClick={() => setEditing(true)}>
            {step.name}
          </span>
        )}
        {completed && (
          <input
            ref={productRef}
            className="sc-product-input"
            placeholder="Product used (optional)"
            value={product}
            onChange={e => setProduct(e.target.value)}
            onBlur={handleProductBlur}
          />
        )}
      </div>
      <button className="sc-step-del" onClick={() => onDelete(step.step_id)} title="Remove step">✕</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConditionWidget — daily skin outcome check
// ---------------------------------------------------------------------------
const FEEL_LABELS    = ["","Rough","Poor","Okay","Good","Great"];
const FEEL_COLORS    = ["","#f87171","#fb923c","#f59e0b","#4ade80","#00d4aa"];
const OIL_LABELS     = ["","Very Oily","Oily","Balanced","Dry","Very Dry"];

function ConditionWidget({ date, condition, onChange }) {
  const [feel,     setFeel]     = useState(condition?.feel_score     ?? null);
  const [breakout, setBreakout] = useState(condition?.breakout_count ?? null);
  const [oiliness, setOiliness] = useState(condition?.oiliness_score ?? null);
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    setFeel(condition?.feel_score     ?? null);
    setBreakout(condition?.breakout_count ?? null);
    setOiliness(condition?.oiliness_score ?? null);
  }, [condition, date]);

  async function save(newFeel, newBreakout, newOiliness) {
    setSaving(true);
    const res = await fetch("/api/skincare/condition", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        date,
        feel_score:     newFeel,
        breakout_count: newBreakout,
        oiliness_score: newOiliness,
      }),
    });
    const json = await res.json();
    setSaving(false);
    onChange(json);
  }

  function handleFeel(v) {
    const next = feel === v ? null : v;
    setFeel(next);
    save(next, breakout, oiliness);
  }
  function handleBreakout(v) {
    const next = breakout === v ? null : v;
    setBreakout(next);
    save(feel, next, oiliness);
  }
  function handleOiliness(v) {
    const next = oiliness === v ? null : v;
    setOiliness(next);
    save(feel, breakout, next);
  }

  return (
    <div className="sc-condition-widget">
      <div className="sc-condition-header">
        <span className="sc-condition-title">Skin Check</span>
        {saving && <span className="sc-condition-saving">saving…</span>}
        {feel != null && (
          <span className="sc-condition-feel-badge" style={{ color: FEEL_COLORS[feel] }}>
            {FEEL_LABELS[feel]}
          </span>
        )}
      </div>

      {/* Feel score 1-5 */}
      <div className="sc-condition-row">
        <span className="sc-condition-label">Feel</span>
        <div className="sc-condition-pips">
          {[1,2,3,4,5].map(v => (
            <button
              key={v}
              className={`sc-pip${feel === v ? " sc-pip-active" : ""}`}
              style={feel === v ? { background: FEEL_COLORS[v], borderColor: FEEL_COLORS[v] } : {}}
              onClick={() => handleFeel(v)}
              title={FEEL_LABELS[v]}
            >
              {v}
            </button>
          ))}
        </div>
        {feel != null && <span className="sc-condition-val" style={{ color: FEEL_COLORS[feel] }}>{FEEL_LABELS[feel]}</span>}
      </div>

      {/* Breakout count 0-3 */}
      <div className="sc-condition-row">
        <span className="sc-condition-label">Breakouts</span>
        <div className="sc-condition-pips">
          {[0,1,2,3].map(v => (
            <button
              key={v}
              className={`sc-pip${breakout === v ? " sc-pip-active" : ""}`}
              style={breakout === v ? { background: v === 0 ? "#4ade80" : v === 1 ? "#f59e0b" : "#f87171", borderColor: v === 0 ? "#4ade80" : v === 1 ? "#f59e0b" : "#f87171" } : {}}
              onClick={() => handleBreakout(v)}
              title={v === 0 ? "None" : v === 1 ? "1-2" : v === 2 ? "3-5" : "6+"}
            >
              {v === 0 ? "✓" : v}
            </button>
          ))}
        </div>
        {breakout != null && (
          <span className="sc-condition-val">
            {breakout === 0 ? "None" : breakout === 1 ? "1-2" : breakout === 2 ? "3-5" : "6+"}
          </span>
        )}
      </div>

      {/* Oiliness 1-5 */}
      <div className="sc-condition-row">
        <span className="sc-condition-label">Oiliness</span>
        <div className="sc-condition-pips">
          {[1,2,3,4,5].map(v => (
            <button
              key={v}
              className={`sc-pip${oiliness === v ? " sc-pip-active" : ""}`}
              style={oiliness === v ? { background: "#818cf8", borderColor: "#818cf8" } : {}}
              onClick={() => handleOiliness(v)}
              title={OIL_LABELS[v]}
            >
              {v}
            </button>
          ))}
        </div>
        {oiliness != null && <span className="sc-condition-val">{OIL_LABELS[oiliness]}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HistoryStrip — 7-day completion + condition
// ---------------------------------------------------------------------------
function HistoryStrip({ history }) {
  if (!history || history.length === 0) return null;
  const recent = history.slice(-7);

  function completionColor(amPct, pmPct) {
    const both = amPct != null && pmPct != null;
    const avg  = both ? (amPct + pmPct) / 2 : (amPct ?? pmPct ?? 0);
    if (avg >= 80) return "#4ade80";
    if (avg >= 50) return "#f59e0b";
    if (avg > 0)   return "#f87171";
    return "var(--text-dim)";
  }

  function feelColor(feel) {
    const cols = ["","#f87171","#fb923c","#f59e0b","#4ade80","#00d4aa"];
    return cols[feel] ?? "var(--text-dim)";
  }

  return (
    <div className="sc-history-strip">
      <div className="sc-history-title">Last 7 Days</div>
      <div className="sc-history-cols">
        {recent.map(day => {
          const d      = new Date(day.date + "T12:00:00");
          const label  = DAY_NAMES[d.getDay()];
          const amPct  = day.am_pct;
          const pmPct  = day.pm_pct;
          const hasAM  = day.am_total > 0;
          const hasPM  = day.pm_total > 0;
          const feel   = day.feel_score;
          const today  = day.date === localDateISO();

          return (
            <div key={day.date} className={`sc-history-col${today ? " sc-history-today" : ""}`}>
              <span className="sc-history-day">{today ? "•" : label}</span>

              {/* Feel score dot */}
              <div className="sc-history-feel" title={feel != null ? `Skin feel: ${FEEL_LABELS[feel]}` : "No skin check"}>
                <StatusDot color={feel != null ? feelColor(feel) : "transparent"} />
              </div>

              {/* AM bar */}
              {hasAM && (
                <div className="sc-history-bar-wrap" title={`AM: ${amPct ?? 0}%`}>
                  <div className="sc-history-bar-track">
                    <div className="sc-history-bar-fill"
                      style={{ height:`${amPct ?? 0}%`, background: completionColor(amPct, null) }} />
                  </div>
                  <span className="sc-history-bar-label">AM</span>
                </div>
              )}

              {/* PM bar */}
              {hasPM && (
                <div className="sc-history-bar-wrap" title={`PM: ${pmPct ?? 0}%`}>
                  <div className="sc-history-bar-track">
                    <div className="sc-history-bar-fill"
                      style={{ height:`${pmPct ?? 0}%`, background: completionColor(null, pmPct) }} />
                  </div>
                  <span className="sc-history-bar-label">PM</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StreakBadge
// ---------------------------------------------------------------------------
function StreakBadge({ streak }) {
  if (!streak) return null;
  const { current_streak, longest_streak } = streak;
  const dotColor = current_streak >= 7 ? "#4ade80" : current_streak >= 3 ? "#f59e0b" : "var(--text-dim)";
  return (
    <div className="sc-streak-row">
      <StatusDot color={dotColor} />
      <span className="sc-streak-current" style={{ color: dotColor }}>
        {current_streak} day{current_streak !== 1 ? "s" : ""}
      </span>
      <span className="sc-streak-sep">·</span>
      <span className="sc-streak-best">best {longest_streak}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkinAnalysisPanel — photo upload + Claude Sonnet dermatologist analysis
// ---------------------------------------------------------------------------

const SCORE_META = {
  feel_score:     { label: "Overall",   vals: ["","Rough","Poor","Okay","Good","Great"],        colors: ["","#f87171","#fb923c","#f59e0b","#4ade80","#00d4aa"] },
  breakout_count: { label: "Breakouts", vals: ["None","1–2","3–5","6+"],                         colors: ["#4ade80","#f59e0b","#f87171","#f87171"] },
  oiliness_score: { label: "Oiliness",  vals: ["","Very Oily","Oily","Balanced","Dry","V.Dry"], colors: ["","#f87171","#fb923c","#4ade80","#818cf8","#818cf8"] },
  redness:        { label: "Redness",   vals: ["","Inflamed","Red","Mild","Minimal","Clear"],    colors: ["","#f87171","#fb923c","#f59e0b","#4ade80","#00d4aa"] },
  texture:        { label: "Texture",   vals: ["","Rough","Uneven","Ok","Smooth","V.Smooth"],    colors: ["","#f87171","#fb923c","#f59e0b","#4ade80","#00d4aa"] },
  hydration:      { label: "Hydration", vals: ["","Parched","Dry","Normal","Good","Excellent"],  colors: ["","#f87171","#fb923c","#f59e0b","#4ade80","#00d4aa"] },
};

function ScoreGrid({ result }) {
  const fields = ["feel_score","breakout_count","oiliness_score","redness","texture","hydration"];
  return (
    <div className="sc-analysis-scores">
      {fields.map(key => {
        const meta  = SCORE_META[key];
        const val   = result[key];
        if (val == null) return null;
        const color = meta.colors[val];
        const label = meta.vals[val];
        return (
          <div key={key} className="sc-analysis-score-card">
            <div className="sc-analysis-score-label">{meta.label}</div>
            <div className="sc-analysis-score-value" style={{ color }}>{label}</div>
            <div className="sc-analysis-score-num" style={{ color }}>{val}</div>
          </div>
        );
      })}
    </div>
  );
}

function SkinAnalysisPanel({ selectedDate, onApplied }) {
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [result,   setResult]   = useState(null);
  const [applying, setApplying] = useState(false);
  const [applied,  setApplied]  = useState(false);
  const [history,  setHistory]  = useState([]);
  const fileRef   = useRef(null);
  const uploadRef = useRef(null);

  const fetchHistory = useCallback(async () => {
    const r    = await fetch("/api/skincare/photo-analyses?days=60");
    const data = await r.json();
    setHistory(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { if (expanded) fetchHistory(); }, [expanded, fetchHistory]);

  useEffect(() => { setApplied(false); }, [selectedDate]);

  async function handleFile(file) {
    if (!file?.type?.startsWith("image/")) { setError("Please upload an image file."); return; }
    setError(null); setResult(null); setApplied(false); setLoading(true);
    try {
      const compressed = await compressImage(file);
      const res  = await fetch("/api/skincare/photo-analysis", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ image: compressed.b64, mime_type: compressed.mime, date: selectedDate }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Analysis failed"); setLoading(false); return; }
      setResult(json);
      fetchHistory();
    } catch {
      setError("Analysis failed. Please try again.");
    }
    setLoading(false);
  }

  function onFileChange(e) { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }
  function onDrop(e) {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0]; if (f) handleFile(f);
  }

  async function applyToLog() {
    if (!result) return;
    setApplying(true);
    const res  = await fetch(`/api/skincare/photo-analyses/${result.id}/apply`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ date: selectedDate }),
    });
    const json = await res.json();
    setApplying(false);
    if (res.ok) { setApplied(true); onApplied(json); }
  }

  function showHistoryItem(a) { setResult(a); setApplied(false); setError(null); }

  return (
    <div className="card sc-analysis-panel">
      <button className="sc-analysis-toggle" onClick={() => setExpanded(e => !e)}>
        <span>📸 Skin Analysis</span>
        <span className="sc-analysis-chevron">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="sc-analysis-body">
          {/* Dropzone */}
          {!result && !loading && (
            <div
              className={`sc-analysis-dropzone${dragging ? " sc-analysis-drop-active" : ""}`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input ref={fileRef}   type="file" accept="image/*" style={{ display:"none" }} onChange={onFileChange} capture="user" />
              <input ref={uploadRef} type="file" accept="image/*" style={{ display:"none" }} onChange={onFileChange} />
              <div className="sc-analysis-drop-icon">📷</div>
              <div className="sc-analysis-drop-text">Analyze your skin</div>
              <div className="sc-analysis-source-btns">
                <button className="sc-analysis-source-btn" onClick={() => fileRef.current?.click()}>📷 Snap</button>
                <button className="sc-analysis-source-btn" onClick={() => uploadRef.current?.click()}>📁 Upload</button>
              </div>
              <div className="sc-analysis-drop-sub">Or drag &amp; drop · Analyzed by Claude Sonnet</div>
            </div>
          )}

          {loading && (
            <div className="sc-analysis-loading">
              <span className="spinner" />
              <span>Analyzing with Claude Sonnet…</span>
            </div>
          )}

          {error && <div className="alert alert-error" style={{ marginTop:"0.5rem" }}>✗ {error}</div>}

          {result && !loading && (
            <div className="sc-analysis-result">
              <ScoreGrid result={result} />
              {result.report && <div className="sc-analysis-report">{result.report}</div>}
              <div className="sc-analysis-actions">
                <button className="btn btn-primary btn-sm" onClick={applyToLog} disabled={applying || applied}>
                  {applied
                    ? "✓ Applied"
                    : applying
                    ? "Applying…"
                    : selectedDate === localDateISO()
                    ? "Apply to Today's Log"
                    : `Apply to ${new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                  }
                </button>
                <button className="btn btn-sm" onClick={() => { setResult(null); setApplied(false); setError(null); }}>
                  New Photo
                </button>
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="sc-analysis-history">
              <div className="sc-analysis-history-title">Past Analyses</div>
              {history.map(a => (
                <div key={a.id} className="sc-analysis-history-item" onClick={() => showHistoryItem(a)}>
                  <img src={`/api/skincare/photo-analyses/${a.id}/photo`} alt="" className="sc-analysis-thumb" />
                  <div className="sc-analysis-history-meta">
                    <div className="sc-analysis-history-date">{a.photo_date}</div>
                    {a.feel_score != null && (
                      <div className="sc-analysis-history-score" style={{ color: SCORE_META.feel_score.colors[a.feel_score] }}>
                        {SCORE_META.feel_score.vals[a.feel_score]}
                      </div>
                    )}
                    {a.report && <div className="sc-analysis-history-report">{a.report.slice(0, 90)}…</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AIInsightsCard
// ---------------------------------------------------------------------------
function AIInsightsCard({ date, hasData }) {
  const [insights, setInsights] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  async function generate() {
    setLoading(true); setError(null); setInsights(null);
    const res  = await fetch("/api/skincare/ai-insights", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ date }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) { setError(json.error || "Failed to generate"); return; }
    setInsights(json.insights);
  }

  return (
    <div className="card sc-ai-card">
      <div className="habit-panel-header">
        <span style={{ fontSize:"1.1rem" }}>🤖</span>
        <span className="habit-panel-title">AI Skin Insights</span>
        <button
          className="btn btn-primary btn-sm"
          onClick={generate}
          disabled={loading || !hasData}
          style={{ marginLeft:"auto" }}
        >
          {loading ? <><span className="spinner" style={{ width:11,height:11 }} /> Analyzing…</> : "⚡ Generate"}
        </button>
      </div>
      {error    && <div className="alert alert-error" style={{ marginTop:"0.5rem" }}>✗ {error}</div>}
      {insights && <div className="sc-ai-text">{insights}</div>}
      {!insights && !loading && !error && (
        <div className="sc-ai-placeholder">
          {hasData
            ? "Analyzes 14 days of routine + skin condition + sleep + hydration for correlations."
            : "Log your routine and skin checks for a few days, then generate insights."}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkinCareModule
// ---------------------------------------------------------------------------
export default function SkinCareModule({ onBack }) {
  const today = localDateISO();

  const [selectedDate,      setSelectedDate]      = useState(today);
  const [condition,         setCondition]         = useState(null);
  const [history,           setHistory]           = useState([]);
  const [streak,            setStreak]            = useState(null);
  const [tab,               setTab]               = useState("routine");
  const [loading,           setLoading]           = useState(true);
  // AI Routine
  const [routine,           setRoutine]           = useState(null);
  const [routineLoading,    setRoutineLoading]    = useState(false);
  const [routineError,      setRoutineError]      = useState(null);
  const [routineExplanation,setRoutineExplanation]= useState(null);
  // Products
  const [products,          setProducts]          = useState([]);
  const [productsLoading,   setProductsLoading]   = useState(false);
  const [showScanner,       setShowScanner]       = useState(false);

  // Workout chat panel state
  const [wInput,    setWInput]    = useState("");
  const [wSending,  setWSending]  = useState(false);
  const [wStatus,   setWStatus]   = useState(null);  // null | {reply, exerciseName, sweatLevel}
  const [wError,    setWError]    = useState(null);
  const [wFallback, setWFallback] = useState(false); // true = show low/medium/high buttons

  const fetchCondition = useCallback(async (d) => {
    const r    = await fetch(`/api/skincare/condition?date=${d}`);
    const data = await r.json();
    setCondition(data);
  }, []);

  const fetchHistory = useCallback(async () => {
    const r    = await fetch(`/api/skincare/history?days=14&date=${today}`);
    const data = await r.json();
    setHistory(Array.isArray(data) ? data : []);
  }, [today]);

  const fetchStreak = useCallback(async () => {
    const r    = await fetch(`/api/skincare/streak?date=${today}`);
    const data = await r.json();
    setStreak(data);
  }, [today]);

  const fetchRoutine = useCallback(async (d) => {
    setRoutineLoading(true);
    setRoutineError(null);
    try {
      const res  = await fetch(`/api/skincare/routine?date=${d}&_t=${Date.now()}`);
      const data = await res.json();
      setRoutine(data.routine || null);
      setRoutineExplanation(data.explanation || null);
    } catch {
      setRoutineError("Failed to load routine");
    } finally {
      setRoutineLoading(false);
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const res  = await fetch("/api/skincare/products");
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch {}
    finally { setProductsLoading(false); }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchCondition(selectedDate),
      fetchHistory(),
      fetchStreak(),
    ]).finally(() => setLoading(false));
  }, [fetchCondition, fetchHistory, fetchStreak]); // eslint-disable-line

  useEffect(() => {
    fetchCondition(selectedDate);
  }, [selectedDate, fetchCondition]);

  useEffect(() => {
    if (tab === "routine") fetchRoutine(selectedDate);
    if (tab === "products") fetchProducts();
  }, [tab, selectedDate, fetchRoutine, fetchProducts]);

  useEffect(() => {
    setWStatus(null); setWError(null); setWFallback(false);
  }, [selectedDate]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function submitWorkout(payload) {
    setWSending(true);
    setWError(null);
    const now      = new Date();
    const logged_at = now.toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: true,
      timeZone: "America/Los_Angeles",
    });
    try {
      const res  = await fetch("/api/skincare/workout-chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...payload, date: selectedDate, logged_at }),
      });
      const json = await res.json();
      if (!res.ok) {
        setWError(json.error || "Something went wrong");
        return;
      }
      if (json.fallback) {
        setWFallback(true);
        setWError(json.error || "Couldn't parse workout — choose intensity below");
        return;
      }
      setWInput("");
      setWFallback(false);
      setWStatus({ reply: json.reply, exerciseName: json.created_exercise?.name,
                   sweatLevel: json.created_exercise?.sweat_level });
      fetchRoutine(selectedDate);
    } catch {
      setWError("Network error — try again");
    } finally {
      setWSending(false);
    }
  }

  async function toggleRoutineStep(stepKey) {
    const res = await fetch("/api/skincare/routine/step-toggle", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ date: selectedDate, step_key: stepKey }),
    });
    if (res.ok) {
      const { completed } = await res.json();
      setRoutine(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map(sec => ({
            ...sec,
            steps: sec.steps.map(st =>
              st.step_key === stepKey ? { ...st, completed } : st
            ),
          })),
        };
      });
    }
  }

  async function regenerateRoutine() {
    setRoutine(null);
    setRoutineLoading(true);
    try {
      const res = await fetch("/api/skincare/routine/generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ date: selectedDate }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setRoutineError(err.error || "Regeneration failed");
        setRoutineLoading(false);
        return;
      }
      await fetchRoutine(selectedDate);
    } catch {
      setRoutineError("Regeneration failed");
      setRoutineLoading(false);
    }
  }

  async function deleteProduct(id) {
    if (!window.confirm("Remove this product from inventory?")) return;
    await fetch(`/api/skincare/products/${id}`, { method: "DELETE" });
    setProducts(prev => prev.filter(p => p.id !== id));
  }

  function handleConditionChange(updated) {
    setCondition(updated);
    fetchHistory();
  }

  function handleAnalysisApplied(updatedCondition) {
    setCondition(updatedCondition);
    fetchHistory();
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const routineDone = routine?.sections?.reduce(
    (n, s) => n + s.steps.filter(st => st.completed).length, 0
  ) ?? 0;
  const routineTotal = routine?.sections?.reduce(
    (n, s) => n + s.steps.length, 0
  ) ?? 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem", flex:1 }}>
          <button className="back-btn" onClick={onBack}>← Hub</button>
          <div className="brand">
            <span className="brand-icon">💆</span>
            <div>
              <div className="brand-name">Skin Care</div>
              <div className="brand-sub">
                {routineTotal > 0 ? `${routineDone}/${routineTotal} steps done` : "AI Routine"}
              </div>
            </div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <StatusDot color="var(--text-dim)" />
          <StreakBadge streak={streak} />
        </div>
      </header>

      <main style={{ maxWidth:680, margin:"0 auto", padding:"1.25rem 1.5rem" }}>
        <ErrorBoundary>
          {loading ? (
            <div className="brief-loading"><span className="spinner" /> Loading…</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>

              {/* ── History strip ── */}
              {history.length > 0 && (
                <div className="card" style={{ padding:"1rem 1.25rem" }}>
                  <HistoryStrip history={history} />
                </div>
              )}

              {/* ── Date + routine card ── */}
              <div className="card">
                <DateNavigator
                  selectedDate={selectedDate}
                  today={today}
                  onChange={d => setSelectedDate(d)}
                />

                {/* Tab switcher */}
                <div className="sc-tab-row">
                  <button className={`sc-tab-btn${tab === "routine" ? " sc-tab-active" : ""}`}
                    onClick={() => setTab("routine")}>✨ Today</button>
                  <button className={`sc-tab-btn${tab === "products" ? " sc-tab-active" : ""}`}
                    onClick={() => setTab("products")}>🧴 Products</button>
                </div>

                {/* Disclaimer — permanent, non-dismissible */}
                <div className="sc-disclaimer">
                  Suggestions based on general dermatological patterns. Consult a dermatologist for your specific condition.
                </div>

                {/* TODAY'S ROUTINE */}
                {tab === "routine" && (
                  <>
                  <div className="sc-routine-panel">
                    {routineLoading && <div className="sc-loading">Generating routine…</div>}
                    {routineError   && <div className="sc-error-msg">{routineError}</div>}
                    {!routineLoading && !routine && !routineError && (
                      <div className="sc-empty-routine">
                        <div className="sc-empty-icon">🧴</div>
                        <div>No products in inventory yet.</div>
                        <div className="sc-empty-hint">Add products in the Products tab to generate a routine.</div>
                      </div>
                    )}
                    {routine && (
                      <>
                        {routineExplanation && (
                          <div className="sc-explanation">{routineExplanation}</div>
                        )}
                        {routine.sections?.map(section => (
                          <div key={section.key} className="sc-routine-section">
                            <div className="sc-routine-section-header">
                              <span className="sc-routine-section-title">
                                {section.icon} {section.label}
                              </span>
                              {section.workout_context && (
                                <span className="sc-workout-badge">{section.workout_context}</span>
                              )}
                            </div>
                            {section.steps.map(step => (
                              <div
                                key={step.step_key}
                                className={`sc-routine-step${step.completed ? " sc-routine-step-done" : ""}`}
                                onClick={() => toggleRoutineStep(step.step_key)}
                              >
                                <div className={`sc-routine-check${step.completed ? " sc-routine-check-done" : ""}`}>
                                  {step.completed ? "✓" : ""}
                                </div>
                                <div className="sc-routine-step-body">
                                  <div className="sc-routine-step-action">{step.action}</div>
                                  {step.product_name && (
                                    <div className="sc-routine-step-product">
                                      {step.brand ? `${step.brand} · ` : ""}{step.product_name}
                                    </div>
                                  )}
                                  {step.reason && (
                                    <div className="sc-routine-step-reason">{step.reason}</div>
                                  )}
                                </div>
                                {step.product_id && (
                                  <img
                                    className="sc-routine-product-thumb"
                                    src={`/api/skincare/products/${step.product_id}/photo`}
                                    alt={step.product_name}
                                    onError={(e) => { e.target.style.display = "none"; }}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        ))}
                        {routine.alerts?.length > 0 && (
                          <div className="sc-alerts">
                            {routine.alerts.map((alert, i) => (
                              <div key={i} className="sc-alert-item">ℹ️ {alert}</div>
                            ))}
                          </div>
                        )}
                        <button className="sc-regenerate-btn" onClick={regenerateRoutine}>
                          ↻ Regenerate for Today
                        </button>
                      </>
                    )}
                  </div>
                  {/* ── Workout Chat Panel ── */}
                  <div className="wc-section">
                    <div className="wc-label">🏃 Log a workout</div>
                    <div className="wc-input-row">
                      <textarea
                        className="wc-textarea"
                        placeholder="e.g. 45 min HIIT this morning, totally drenched…"
                        value={wInput}
                        onChange={e => { setWInput(e.target.value); setWFallback(false); setWStatus(null); setWError(null); }}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (wInput.trim()) submitWorkout({ message: wInput.trim() }); } }}
                        disabled={wSending}
                        rows={1}
                      />
                      <button
                        className="wc-send-btn"
                        onClick={() => { if (wInput.trim()) submitWorkout({ message: wInput.trim() }); }}
                        disabled={wSending || !wInput.trim()}
                      >
                        {wSending ? "…" : "↑"}
                      </button>
                    </div>
                    {wStatus && (
                      <div className="wc-confirm">✅ {wStatus.reply}</div>
                    )}
                    {wFallback && (
                      <div className="wc-fallback">
                        <div className="wc-fallback-label">⚠️ {wError || "How intense was it?"}</div>
                        <div className="wc-fallback-btns">
                          {["low", "medium", "high"].map(lvl => (
                            <button
                              key={lvl}
                              className="wc-fallback-btn"
                              disabled={wSending}
                              onClick={() => {
                                setWFallback(false);
                                submitWorkout({ sweat_level: lvl, exercise_type: "cardio" });
                              }}
                            >
                              {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {wError && !wFallback && (
                      <div className="wc-error">{wError}</div>
                    )}
                  </div>
                  </>
                )}

                {/* PRODUCTS */}
                {tab === "products" && (
                  <div className="sc-products-panel">
                    {showScanner && (
                      <SkinProductScanner
                        onSaved={(product) => {
                          setProducts(prev => [product, ...prev]);
                          setShowScanner(false);
                        }}
                        onClose={() => setShowScanner(false)}
                      />
                    )}
                    <button className="sc-add-product-btn" onClick={() => setShowScanner(true)}>
                      📷 Add Product
                    </button>
                    {productsLoading && <div className="sc-loading">Loading products…</div>}
                    {!productsLoading && products.length === 0 && (
                      <div className="sc-empty-products">
                        No products yet. Tap Add Product to scan your first product.
                      </div>
                    )}
                    <div className="sc-product-grid">
                      {products.map(p => (
                        <div key={p.id} className={`sc-product-card${p.face_safe ? "" : " sc-product-excluded"}`}>
                          {p.has_photo ? (
                            <img
                              className="sc-product-photo"
                              src={`/api/skincare/products/${p.id}/photo`}
                              alt={p.product_name}
                            />
                          ) : (
                            <div className="sc-product-photo sc-product-photo-placeholder">🧴</div>
                          )}
                          <div className="sc-product-info">
                            {p.brand && <div className="sc-product-brand">{p.brand}</div>}
                            <div className="sc-product-name">{p.product_name}</div>
                            <div className="sc-product-type">{p.product_type.replace(/_/g, " ")}</div>
                            {p.active_ingredients && (
                              <div className="sc-product-ingredients">{p.active_ingredients}</div>
                            )}
                            <div className={`sc-product-status${p.face_safe ? " sc-product-safe" : " sc-product-banned"}`}>
                              {p.face_safe ? "✓ Face safe" : "🚫 Face excluded"}
                            </div>
                          </div>
                          <button className="sc-product-del" onClick={() => deleteProduct(p.id)} title="Remove">✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Skin condition widget */}
                <ConditionWidget
                  date={selectedDate}
                  condition={condition}
                  onChange={handleConditionChange}
                />
              </div>

              {/* ── Skin analysis ── */}
              <SkinAnalysisPanel
                selectedDate={selectedDate}
                onApplied={handleAnalysisApplied}
              />

              {/* ── AI Insights ── */}
              <AIInsightsCard date={selectedDate} hasData={products.length > 0 || condition != null} />

            </div>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
