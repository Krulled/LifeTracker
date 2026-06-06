import React, { useState, useEffect, useCallback } from "react";

const CACHE_KEY = "correlations_cache";
const TTL_MS    = 6 * 60 * 60 * 1000; // 6 hours

const CARD_ACCENT = {
  sleep_mood:       "#818cf8",
  exercise_mood:    "#34d399",
  calories_weight:  "#f59e0b",
  habits_all:       "#f472b6",
};

export default function CorrelationInsights() {
  const [cards,       setCards]       = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [isStale,     setIsStale]     = useState(false);
  const [expanded,    setExpanded]    = useState({});

  const checkStale = useCallback((ts) => {
    setIsStale(!!ts && (Date.now() - new Date(ts).getTime()) >= TTL_MS);
  }, []);

  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached?.cards?.length) {
        setCards(cached.cards);
        setGeneratedAt(cached.generatedAt);
        checkStale(cached.generatedAt);
        return;
      }
    } catch {}
    // Don't auto-load — user triggers via button
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!generatedAt) return;
    const id = setInterval(() => checkStale(generatedAt), 60_000);
    return () => clearInterval(id);
  }, [generatedAt, checkStale]);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      const d0 = new Date();
      const localDate = `${d0.getFullYear()}-${String(d0.getMonth()+1).padStart(2,"0")}-${String(d0.getDate()).padStart(2,"0")}`;
      const res  = await fetch(`/api/ai/correlations?date=${localDate}${force ? "&force=true" : ""}`);
      const json = await res.json();
      if (json.cards?.length) {
        const ts = json.generated_at || new Date().toISOString();
        setCards(json.cards);
        setGeneratedAt(ts);
        setIsStale(false);
        localStorage.setItem(CACHE_KEY, JSON.stringify({ cards: json.cards, generatedAt: ts }));
      } else {
        setError(json.error || "No correlations returned yet — keep logging across modules.");
      }
    } catch {
      setError("Connection error — is the backend running?");
    }
    setLoading(false);
  }

  function formatAge(ts) {
    if (!ts) return "";
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000);
    if (mins < 1)  return "just now";
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  }

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="corr-card">
      <div className="corr-header">
        <span className="corr-title">🔗 AI CORRELATION INSIGHTS</span>
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          {generatedAt && (
            <span className={`insights-age${isStale ? " stale" : ""}`}>
              {isStale && "⚠ "}{formatAge(generatedAt)}
            </span>
          )}
          <button
            className="btn btn-ghost insights-refresh"
            onClick={() => load(true)}
            disabled={loading}
            title="Refresh correlations"
          >
            {loading
              ? <span className="spinner" style={{ width:12, height:12, borderWidth:2 }} />
              : "↻ Refresh"}
          </button>
        </div>
      </div>

      <p className="corr-subtitle">
        Patterns detected across your last 30 days of tracking data.
      </p>

      {!cards && !loading && !error && (
        <div className="corr-empty">
          <p>Run analysis to detect patterns across sleep, exercise, calories, and habits.</p>
          <button className="corr-run-btn" onClick={() => load(false)}>
            ⚡ Analyze My Data
          </button>
        </div>
      )}

      {loading && !cards && (
        <div className="insights-loading">
          <span className="spinner" /> Analyzing 30 days of patterns…
        </div>
      )}

      {error && !cards && (
        <div className="insights-error">{error}</div>
      )}

      {cards?.length > 0 && (
        <div className="corr-grid">
          {cards.map(card => {
            const accent  = CARD_ACCENT[card.id] || "#94a3b8";
            const isOpen  = expanded[card.id];
            return (
              <div
                key={card.id}
                className={`corr-insight-card${!card.enough_data ? " corr-low-data" : ""}`}
                style={{ "--accent": accent }}
              >
                <div className="corr-card-header">
                  <span className="corr-card-icon">{card.icon}</span>
                  <span className="corr-card-title">{card.title}</span>
                  {!card.enough_data && (
                    <span className="corr-card-badge">low data</span>
                  )}
                </div>
                <p className="corr-card-headline">{card.headline}</p>
                {isOpen && (
                  <p className="corr-card-detail">{card.detail}</p>
                )}
                <button
                  className="corr-card-toggle"
                  onClick={() => toggleExpand(card.id)}
                >
                  {isOpen ? "Less ↑" : "More ↓"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {error && cards && (
        <div className="insights-error" style={{ marginTop:"0.5rem" }}>{error}</div>
      )}
    </div>
  );
}
