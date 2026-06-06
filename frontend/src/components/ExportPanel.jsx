import React, { useEffect, useState, useRef } from "react";

const AI_PROMPT = `SLEEP DATA ANALYSIS PROMPT
==========================

You are a data analyst and sleep science expert. Below is my personal sleep tracking JSON data.
Please perform a thorough analysis across the following dimensions and output actionable recommendations.

---

DATASET OVERVIEW
----------------
- Analyze ALL entries in the "entries" array.
- Note the date range, total nights tracked, and any gaps in tracking.
- Identify the most common tags and flag any data quality issues.

---

ANALYSIS TASKS
--------------

1. CAFFEINE CUTOFF vs MORNING INERTIA
   - For each entry that has a caffeine_cutoff_time, compare it to the next morning's
     inertia_score (the entry with the following date).
   - Bucket cutoff times into groups: before 13:00, 13:00–15:00, 15:00–17:00, after 17:00.
   - Calculate average inertia score for each bucket.
   - Report: Does earlier caffeine cutoff correlate with higher inertia (easier wake)?

2. DAILY MILES WALKED vs NEXT-DAY ENERGY SCORE
   - For each entry, compare miles_walked to the NEXT entry's energy_score.
   - Create mile-range buckets: 0–2, 2–4, 4–6, 6+ miles.
   - Report: Is there a sweet spot for daily walking that maximizes next-day energy?

3. SLEEP CYCLES vs WAKE QUALITY (INERTIA)
   - Group entries by sleep_cycles rounded to nearest 0.5.
   - Report: Which cycle count produces the best morning wake quality for this person?
   - Specifically compare 4.5 vs 5.0 vs 5.5 cycles.

4. TAG CORRELATIONS
   - For each unique tag, calculate average inertia_score, energy_score, sleep_duration_minutes.
   - Report: Which tags correlate with better sleep? Which with worse?

5. OPTIMAL SLEEP DURATION FOR THIS PERSON
   - Find the duration range that maximizes (inertia_score + energy_score) / 2.
   - Report the optimal sleep window.

6. STRESS vs SLEEP QUALITY
   - Correlate stress_score with sleep_duration_minutes, inertia_score, sleep_latency_minutes.
   - Identify the stress threshold above which sleep quality meaningfully degrades.

---

OUTPUT FORMAT
-------------
## Executive Summary
[3–5 bullet points of the most impactful findings]

## Detailed Findings
[One section per analysis task]

## Personalized Recommendations
[Numbered list ranked by expected impact]

## Watch List
[Trends that are concerning or warrant further tracking]

---

[PASTE YOUR JSON DATA BELOW THIS LINE]
`;

// ---------------------------------------------------------------------------
// Monthly Analysis Result Display
// ---------------------------------------------------------------------------

function MonthlyAnalysisResult({ data }) {
  const trend_color = {
    improving: "var(--success)",
    declining: "var(--danger)",
    stable:    "var(--warning)",
  }[data.weekly_trend] || "var(--text-muted)";

  return (
    <div style={{ marginTop: "1.25rem" }}>
      {/* Trend + Optimal params */}
      <div className="grid-3" style={{ marginBottom: "1rem" }}>
        {[
          { label: "Weekly Trend",    value: data.weekly_trend,             color: trend_color },
          { label: "Optimal Duration", value: data.optimal_sleep_duration_minutes ? `${Math.floor(data.optimal_sleep_duration_minutes/60)}h ${data.optimal_sleep_duration_minutes%60}m` : "—" },
          { label: "Best Cycle Count", value: data.optimal_cycle_count ?? "—" },
          { label: "Optimal Caffeine", value: data.optimal_caffeine_cutoff ?? "—", color: "var(--accent)" },
          { label: "Best Tags",        value: data.best_performing_tags?.join(", ") || "—", color: "var(--success)" },
          { label: "Worst Tags",       value: data.worst_performing_tags?.join(", ") || "—", color: "var(--danger)" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.65rem 0.85rem" }}>
            <div style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: "0.2rem" }}>{label}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.95rem", fontWeight: 700, color: color || "var(--text-primary)" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Executive summary */}
      {data.executive_summary?.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <div className="brief-section-title" style={{ marginBottom: "0.5rem" }}>📊 Executive Summary</div>
          <ul style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {data.executive_summary.map((item, i) => (
              <li key={i} style={{ fontSize: "0.875rem", color: "var(--text-primary)", lineHeight: 1.5 }}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Correlations */}
      {(data.caffeine_inertia_correlation || data.miles_energy_correlation || data.best_cycle_count_for_wakeup) && (
        <div style={{ marginBottom: "1rem" }}>
          <div className="brief-section-title" style={{ marginBottom: "0.5rem" }}>🔗 Key Correlations</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {[
              { label: "Caffeine → Inertia",   text: data.caffeine_inertia_correlation },
              { label: "Miles → Next-day Energy", text: data.miles_energy_correlation },
              { label: "Best Cycle Count",      text: data.best_cycle_count_for_wakeup },
            ].filter(c => c.text).map(({ label, text }) => (
              <div key={label} style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.6rem 0.85rem" }}>
                <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", marginRight: "0.5rem" }}>{label}:</span>
                <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top recommendations */}
      {data.top_recommendations?.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <div className="brief-section-title" style={{ marginBottom: "0.5rem" }}>🎯 Top Recommendations</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {data.top_recommendations.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.6rem 0.85rem" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", fontWeight: 700, color: "var(--accent)", background: "var(--accent-glow)", border: "1px solid var(--accent)", borderRadius: "3px", padding: "0.1rem 0.4rem", whiteSpace: "nowrap", marginTop: "0.1rem" }}>{r.category}</span>
                <div>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-primary)", marginBottom: "0.15rem" }}>{r.action}</div>
                  <div style={{ fontSize: "0.775rem", color: "var(--text-muted)" }}>{r.expected_impact}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Watch list */}
      {data.watch_list?.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <div className="brief-section-title" style={{ marginBottom: "0.5rem" }}>🚩 Watch List</div>
          {data.watch_list.map((item, i) => (
            <div key={i} className="brief-flag" style={{ marginBottom: "0.35rem" }}>{item}</div>
          ))}
        </div>
      )}

      {data.data_quality_notes && (
        <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", fontStyle: "italic", marginTop: "0.5rem" }}>
          Note: {data.data_quality_notes}
        </div>
      )}

      {data.cached && (
        <div style={{ fontSize: "0.68rem", color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginTop: "0.75rem", textAlign: "right" }}>
          Cached · Generated {new Date(data.generated_at).toLocaleString()}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ExportPanel
// ---------------------------------------------------------------------------

export default function ExportPanel({ refreshKey }) {
  const [stats,      setStats]      = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError,   setStatsError]   = useState(null);
  const [exporting,  setExporting]  = useState(false);
  const [copied,     setCopied]     = useState(false);
  const [analyzing,  setAnalyzing]  = useState(false);
  const [analysis,   setAnalysis]   = useState(null);
  const [analysisErr, setAnalysisErr] = useState(null);
  const promptRef = useRef(null);

  useEffect(() => {
    setStatsLoading(true);
    fetch("/api/stats")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setStats(data); setStatsLoading(false); })
      .catch(err => { setStatsError(err.message); setStatsLoading(false); });
  }, [refreshKey]);

  async function handleExport() {
    setExporting(true);
    try {
      const res  = await fetch("/api/export/json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const _d = new Date(); const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,"0")}-${String(_d.getDate()).padStart(2,"0")}`;
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `sleep_data_${today}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(AI_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      if (promptRef.current) {
        const range = document.createRange();
        range.selectNodeContents(promptRef.current);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }

  async function handleRunAnalysis() {
    setAnalyzing(true);
    setAnalysis(null);
    setAnalysisErr(null);
    try {
      const res  = await fetch("/api/ai/analyze-month", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setAnalysis(json);
    } catch (err) {
      setAnalysisErr(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div>
      {/* 01 — Dataset Summary */}
      <div className="card section">
        <div className="card-header">
          <span className="card-title-accent">01 /</span>&nbsp;
          <span className="card-title">Dataset Summary</span>
        </div>
        {statsLoading ? (
          <div style={{ padding: "1rem 0" }}><span className="spinner" /></div>
        ) : statsError ? (
          <div className="alert alert-error">Could not load stats: {statsError}</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem" }}>
            {[
              { label: "Total Days Tracked", value: stats?.total_entries ?? 0 },
              { label: "Date Range Start",   value: stats?.date_range_start ?? "—" },
              { label: "Date Range End",     value: stats?.date_range_end   ?? "—" },
              { label: "Avg Sleep",          value: stats?.avg_sleep_duration_hours ? `${stats.avg_sleep_duration_hours}h` : "—" },
              { label: "Avg Cycles",         value: stats?.avg_sleep_cycles ?? "—" },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.75rem 1rem" }}>
                <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: "0.25rem" }}>{label}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.1rem", fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 02 — Export JSON */}
      <div className="card section">
        <div className="card-header">
          <span className="card-title-accent">02 /</span>&nbsp;
          <span className="card-title">Export Data for AI Analysis</span>
        </div>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1rem", lineHeight: 1.6 }}>
          Download all entries as structured JSON. Paste into Claude or ChatGPT with the prompt below.
        </p>
        <button
          className="btn btn-primary btn-lg"
          onClick={handleExport}
          disabled={exporting || stats?.total_entries === 0}
          style={{ minWidth: 220 }}
        >
          {exporting
            ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Exporting…</>
            : "Export JSON for AI"}
        </button>
        {stats?.total_entries === 0 && (
          <div className="alert alert-warning" style={{ marginTop: "0.75rem" }}>
            No entries to export yet.
          </div>
        )}
      </div>

      {/* 03 — AI Monthly Analysis */}
      <div className="card section">
        <div className="card-header">
          <span className="card-title-accent">03 /</span>&nbsp;
          <span className="card-title">AI Monthly Analysis</span>
          {analysis && (
            <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
              {analysis.cached ? `cached · ${new Date(analysis.generated_at).toLocaleDateString()}` : "fresh"}
            </span>
          )}
        </div>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1rem", lineHeight: 1.6 }}>
          Runs your full dataset through Groq AI and returns correlations, optimal parameters,
          and ranked recommendations. Results are cached — re-run anytime after adding new entries.
        </p>
        <button
          className="btn btn-primary btn-lg"
          onClick={handleRunAnalysis}
          disabled={analyzing || stats?.total_entries === 0}
          style={{ minWidth: 240 }}
        >
          {analyzing
            ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Analyzing…</>
            : analysis ? "Re-run Analysis" : "Run AI Month Analysis"}
        </button>

        {analysisErr && (
          <div className="alert alert-error" style={{ marginTop: "0.75rem" }}>✗ {analysisErr}</div>
        )}

        {analysis && !analyzing && <MonthlyAnalysisResult data={analysis} />}
      </div>

      {/* 04 — Manual Prompt Template */}
      <div className="card section">
        <div className="card-header" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className="card-title-accent">04 /</span>&nbsp;
            <span className="card-title">Manual Analysis Prompt</span>
          </div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: "0.8rem", padding: "0.35rem 0.9rem", ...(copied ? { borderColor: "var(--success)", color: "var(--success)" } : {}) }}
            onClick={handleCopyPrompt}
          >
            {copied ? "✓ Copied!" : "Copy Prompt"}
          </button>
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.75rem", lineHeight: 1.6 }}>
          Copy this prompt, paste into Claude or ChatGPT, then paste your exported JSON below it.
        </p>
        <div className="prompt-block" ref={promptRef}>{AI_PROMPT}</div>
      </div>
    </div>
  );
}
