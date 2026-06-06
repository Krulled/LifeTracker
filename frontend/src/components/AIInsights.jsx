import React, { useState, useEffect, useCallback } from "react";

const TTL_MS = 60 * 60 * 1000;
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const CACHE_KEY = `insights_cache_${todayKey()}`;

export default function AIInsights() {
  const [insights,    setInsights]    = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [isStale,     setIsStale]     = useState(false);

  const checkStale = useCallback((ts) => {
    setIsStale(!!ts && (Date.now() - new Date(ts).getTime()) >= TTL_MS);
  }, []);

  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached?.text) {
        setInsights(cached.text);
        setGeneratedAt(cached.generatedAt);
        checkStale(cached.generatedAt);
        return;
      }
    } catch {}
    loadInsights();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!generatedAt) return;
    const id = setInterval(() => checkStale(generatedAt), 60_000);
    return () => clearInterval(id);
  }, [generatedAt, checkStale]);

  async function loadInsights() {
    setLoading(true); setError(null);
    try {
      const d0 = new Date();
      const localDate = `${d0.getFullYear()}-${String(d0.getMonth()+1).padStart(2,"0")}-${String(d0.getDate()).padStart(2,"0")}`;
      const res  = await fetch(`/api/insights/weekly?date=${localDate}`);
      const json = await res.json();
      if (json.insights) {
        const ts = json.generated_at || new Date().toISOString();
        setInsights(json.insights);
        setGeneratedAt(ts);
        setIsStale(false);
        localStorage.setItem(CACHE_KEY, JSON.stringify({ text: json.insights, generatedAt: ts }));
      } else {
        setError(json.error || "No insights returned.");
      }
    } catch {
      setError("Connection error — is the backend running?");
    }
    setLoading(false);
  }

  function renderMarkdown(text) {
    if (!text) return null;
    const lines = text.split("\n");
    const output = [];
    let listItems = [];

    const flushList = () => {
      if (listItems.length) {
        output.push(<ul key={`ul-${output.length}`} style={{ margin: "0.5em 0", paddingLeft: "1.4em" }}>{listItems}</ul>);
        listItems = [];
      }
    };

    const applyInline = (str, key) => {
      const parts = str.split(/(\*\*[^*]+\*\*)/g);
      return (
        <React.Fragment key={key}>
          {parts.map((part, i) =>
            /^\*\*[^*]+\*\*$/.test(part)
              ? <strong key={i}>{part.slice(2, -2)}</strong>
              : part
          )}
        </React.Fragment>
      );
    };

    lines.forEach((line, i) => {
      const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
      const bulletMatch  = line.match(/^[-•]\s+(.*)/);

      if (headingMatch) {
        flushList();
        output.push(
          <p key={i} style={{ fontWeight: "bold", marginTop: "0.75em", marginBottom: "0.2em" }}>
            {applyInline(headingMatch[2], `h-${i}`)}
          </p>
        );
      } else if (bulletMatch) {
        listItems.push(<li key={i}>{applyInline(bulletMatch[1], `li-${i}`)}</li>);
      } else if (line.trim() === "") {
        flushList();
      } else {
        flushList();
        output.push(<p key={i} style={{ margin: "0.3em 0" }}>{applyInline(line, `p-${i}`)}</p>);
      }
    });

    flushList();
    return output;
  }

  function formatAge(ts) {
    if (!ts) return "";
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000);
    if (mins < 1)  return "just now";
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  }

  return (
    <div className="insights-card">
      <div className="insights-header">
        <span className="insights-title">✦ AI WEEKLY INSIGHTS</span>
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          {generatedAt && (
            <span className={`insights-age${isStale ? " stale" : ""}`}>
              {isStale && "⚠ "}{formatAge(generatedAt)}
            </span>
          )}
          <button
            className="btn btn-ghost insights-refresh"
            onClick={loadInsights}
            disabled={loading}
            title="Refresh insights"
          >
            {loading
              ? <span className="spinner" style={{ width:12, height:12, borderWidth:2 }} />
              : "↻ Refresh"}
          </button>
        </div>
      </div>

      {loading && !insights && (
        <div className="insights-loading">
          <span className="spinner" /> Analyzing your week…
        </div>
      )}

      {error && !insights && (
        <div className="insights-error">{error}</div>
      )}

      {insights && (
        <div className={`insights-text${loading ? " insights-refreshing" : ""}`}>
          {renderMarkdown(insights)}
        </div>
      )}
    </div>
  );
}
