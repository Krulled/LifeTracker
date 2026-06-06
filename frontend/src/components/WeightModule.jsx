import React, { useState, useEffect, useCallback, useMemo } from "react";

function localDateISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// ── SVG Weight Chart ──────────────────────────────────────────────────────

function WeightChart({ entries }) {
  const W = 600, H = 180;
  const PAD = { top: 12, right: 20, bottom: 36, left: 48 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top  - PAD.bottom;

  if (entries.length < 2) return (
    <div className="weight-chart-empty">Log at least 2 entries to see your trend</div>
  );

  const weights = entries.map(e => e.weight_lbs);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const pad  = Math.max((maxW - minW) * 0.15, 1.5);
  const lo   = minW - pad;
  const hi   = maxW + pad;

  const dates   = entries.map(e => new Date(e.entry_date + "T12:00:00").getTime());
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  const dateRange = maxDate - minDate || 1;

  const sx = d  => PAD.left + ((d - minDate) / dateRange) * iW;
  const sy = w  => PAD.top  + (1 - (w - lo) / (hi - lo)) * iH;

  // Catmull-Rom smooth curve
  const pts = entries.map((e, i) => ({ x: sx(dates[i]), y: sy(e.weight_lbs) }));
  function smooth(ps) {
    return ps.map((p, i) => {
      if (i === 0) return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      const p0 = ps[Math.max(0, i - 1)];
      const p1 = ps[i];
      const p2 = ps[Math.min(ps.length - 1, i + 1)];
      const cp1x = p0.x + (p1.x - ps[Math.max(0, i - 2)].x) / 6;
      const cp1y = p0.y + (p1.y - ps[Math.max(0, i - 2)].y) / 6;
      const cp2x = p1.x - (p2.x - p0.x) / 6;
      const cp2y = p1.y - (p2.y - p0.y) / 6;
      return `C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
    }).join(" ");
  }

  const linePath = smooth(pts);
  const areaPath = `${linePath} L ${pts[pts.length-1].x.toFixed(1)} ${(PAD.top+iH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(PAD.top+iH).toFixed(1)} Z`;

  // Linear trend
  const n  = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) /
                pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const intercept = my - slope * mx;
  const tx0 = pts[0].x, ty0 = slope * tx0 + intercept;
  const tx1 = pts[n-1].x, ty1 = slope * tx1 + intercept;

  // Y-axis labels
  const range  = hi - lo;
  const step   = range > 10 ? 5 : range > 4 ? 2 : 1;
  const yStart = Math.ceil(lo / step) * step;
  const yLabels = [];
  for (let w = yStart; w <= hi; w += step) yLabels.push(w);

  // X-axis labels (first, mid, last)
  const xDates = [entries[0], entries[Math.floor(entries.length / 2)], entries[entries.length - 1]]
    .filter((e, i, arr) => arr.findIndex(a => a.entry_date === e.entry_date) === i);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" className="weight-chart-svg">
      <defs>
        <linearGradient id="wgGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#00d4aa" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#00d4aa" stopOpacity="0.02" />
        </linearGradient>
        <clipPath id="wgClip">
          <rect x={PAD.left} y={PAD.top} width={iW} height={iH} />
        </clipPath>
      </defs>

      {/* Grid lines */}
      {yLabels.map(w => (
        <g key={w}>
          <line x1={PAD.left} x2={PAD.left + iW} y1={sy(w)} y2={sy(w)}
            stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <text x={PAD.left - 6} y={sy(w)} textAnchor="end" dominantBaseline="middle"
            fontSize="10" fill="#6e7681">{w}</text>
        </g>
      ))}

      {/* Area fill */}
      <path d={areaPath} fill="url(#wgGrad)" clipPath="url(#wgClip)" />

      {/* Trend line */}
      <line x1={tx0} y1={ty0} x2={tx1} y2={ty1}
        stroke="#00d4aa" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.4"
        clipPath="url(#wgClip)" />

      {/* Main line */}
      <path d={linePath} fill="none" stroke="#00d4aa" strokeWidth="2.5"
        strokeLinecap="round" clipPath="url(#wgClip)" />

      {/* Dots */}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.5"
          fill="#00d4aa" stroke="#0d1117" strokeWidth="1.5">
          <title>{entries[i].entry_date}: {entries[i].weight_lbs} lbs</title>
        </circle>
      ))}

      {/* X-axis labels */}
      {xDates.map(e => {
        const idx = entries.findIndex(en => en.entry_date === e.entry_date);
        const x   = pts[idx]?.x;
        if (x == null) return null;
        const d = new Date(e.entry_date + "T12:00:00");
        const label = `${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`;
        return (
          <text key={e.entry_date} x={x} y={H - 6}
            textAnchor="middle" fontSize="10" fill="#6e7681">{label}</text>
        );
      })}
    </svg>
  );
}

// ── Main Module ────────────────────────────────────────────────────────────

export default function WeightModule({ onBack }) {
  const today = localDateISO();

  const [entries,   setEntries]   = useState([]);
  const [stats,     setStats]     = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [range,     setRange]     = useState(90);

  // Form state
  const [date,      setDate]      = useState(today);
  const [weight,    setWeight]    = useState("");
  const [bodyFat,   setBodyFat]   = useState("");
  const [notes,     setNotes]     = useState("");
  const [saving,    setSaving]    = useState(false);
  const [formMsg,   setFormMsg]   = useState(null);

  const fetchAll = useCallback(async () => {
    const d0 = new Date();
    const localDate = `${d0.getFullYear()}-${String(d0.getMonth()+1).padStart(2,"0")}-${String(d0.getDate()).padStart(2,"0")}`;
    const [eRes, sRes] = await Promise.all([
      fetch("/api/weight?limit=730"),
      fetch(`/api/weight/stats?date=${localDate}`),
    ]);
    const [eData, sData] = await Promise.all([eRes.json(), sRes.json()]);
    setEntries(Array.isArray(eData) ? eData : []);
    setStats(sData);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Pre-fill form if today already has an entry
  const todayEntry = entries.find(e => e.entry_date === today) ?? null;
  const isUpdating = todayEntry != null;

  useEffect(() => {
    if (todayEntry) {
      setWeight(String(todayEntry.weight_lbs));
      setBodyFat(todayEntry.body_fat_pct != null ? String(todayEntry.body_fat_pct) : "");
      setNotes(todayEntry.notes || "");
    }
  }, [entries, today]);

  const displayEntries = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - range);
    cutoff.setHours(0, 0, 0, 0);
    return entries.filter(e => new Date(e.entry_date + "T12:00:00") >= cutoff);
  }, [entries, range]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!weight) return;
    setSaving(true); setFormMsg(null);
    const res = await fetch("/api/weight", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        entry_date:   date,
        weight_lbs:   parseFloat(weight),
        body_fat_pct: bodyFat ? parseFloat(bodyFat) : null,
        notes:        notes || null,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setFormMsg({ ok: false, text: json.error || "Save failed" }); return; }
    setFormMsg({ ok: true, text: "Saved!" });
    setTimeout(() => setFormMsg(null), 2000);
    await fetchAll();
  }

  async function handleDelete(id) {
    await fetch(`/api/weight/${id}`, { method: "DELETE" });
    fetchAll();
  }

  const changeColor = c => c == null ? "var(--text-dim)" : c > 0 ? "#f87171" : c < 0 ? "#4ade80" : "var(--accent)";
  const changeSign  = c => c == null ? "" : c > 0 ? "+" : "";

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <button className="back-btn" onClick={onBack}>← Hub</button>
          <div className="brand">
            <span className="brand-icon">⚖️</span>
            <div>
              <div className="brand-name">Body Weight</div>
              <div className="brand-sub">
                WEIGHT TRACKER ·{" "}
                {stats?.has_data
                  ? `${stats.current.weight_lbs} lbs`
                  : "no data yet"}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "1.25rem 1.5rem" }}>
        {loading ? (
          <div className="brief-loading"><span className="spinner" /> Loading…</div>
        ) : (
          <div className="weight-layout">

            {/* ── Left: Log + Stats ── */}
            <div className="weight-left">

              {/* Log Entry Card */}
              <div className="card" style={{ padding: "1.1rem" }}>
                <div className="habit-panel-header" style={{ marginBottom: "0.9rem" }}>
                  <span className="habit-panel-title">Log Weight</span>
                </div>
                <form onSubmit={handleSubmit}>
                  <div className="form-group">
                    <label className="form-label">Date</label>
                    <input className="form-input" type="date" value={date}
                      onChange={e => setDate(e.target.value)} max={today} />
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem" }}>
                    <div className="form-group">
                      <label className="form-label">Weight (lbs) *</label>
                      <input className="form-input" type="number" step="0.1" min="50" max="700"
                        placeholder="e.g. 185.5" value={weight}
                        onChange={e => setWeight(e.target.value)} required autoFocus />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Body Fat % (opt)</label>
                      <input className="form-input" type="number" step="0.1" min="1" max="70"
                        placeholder="e.g. 18.5" value={bodyFat}
                        onChange={e => setBodyFat(e.target.value)} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Notes (opt)</label>
                    <input className="form-input" placeholder="e.g. morning, post-workout…"
                      value={notes} onChange={e => setNotes(e.target.value)} />
                  </div>
                  {formMsg && (
                    <div className={`alert ${formMsg.ok ? "alert-success" : "alert-error"}`}
                      style={{ marginBottom: "0.5rem" }}>
                      {formMsg.ok ? "✓" : "✗"} {formMsg.text}
                    </div>
                  )}
                  <button type="submit" className="btn btn-primary" disabled={saving}
                    style={{ width: "100%" }}>
                    {saving ? "Saving…" : isUpdating ? "Update Entry" : "Save Entry"}
                  </button>
                </form>
              </div>

              {/* Stats Card */}
              {stats?.has_data && (
                <div className="card weight-stats-card">
                  <div className="weight-stat-row">
                    <span className="weight-stat-label">Current</span>
                    <span className="weight-stat-val">{stats.current.weight_lbs} lbs</span>
                  </div>
                  <div className="weight-stat-row">
                    <span className="weight-stat-label">7-day change</span>
                    <span className="weight-stat-val" style={{ color: changeColor(stats.week_change) }}>
                      {stats.week_change != null
                        ? `${changeSign(stats.week_change)}${stats.week_change} lbs`
                        : "—"}
                    </span>
                  </div>
                  <div className="weight-stat-row">
                    <span className="weight-stat-label">30-day change</span>
                    <span className="weight-stat-val" style={{ color: changeColor(stats.month_change) }}>
                      {stats.month_change != null
                        ? `${changeSign(stats.month_change)}${stats.month_change} lbs`
                        : "—"}
                    </span>
                  </div>
                  <div className="weight-stat-row">
                    <span className="weight-stat-label">Total change</span>
                    <span className="weight-stat-val" style={{ color: changeColor(stats.total_change) }}>
                      {changeSign(stats.total_change)}{stats.total_change} lbs
                      <span style={{ fontSize:"0.68rem", color:"var(--text-dim)", marginLeft:"0.3rem" }}>
                        since {stats.first.entry_date}
                      </span>
                    </span>
                  </div>
                  <div className="weight-stat-row">
                    <span className="weight-stat-label">Entries logged</span>
                    <span className="weight-stat-val">{stats.count}</span>
                  </div>
                  {stats.current.body_fat_pct && (
                    <div className="weight-stat-row">
                      <span className="weight-stat-label">Body fat %</span>
                      <span className="weight-stat-val">{stats.current.body_fat_pct}%</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Right: Chart + History ── */}
            <div className="weight-right">

              {/* Chart */}
              <div className="card" style={{ padding: "1rem 1rem 0.75rem" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"0.5rem" }}>
                  <span className="habit-panel-title">Trend</span>
                  <div className="weight-range-tabs">
                    {[30, 60, 90].map(d => (
                      <button key={d}
                        className={`weight-range-tab${range === d ? " active" : ""}`}
                        onClick={() => setRange(d)}>
                        {d}d
                      </button>
                    ))}
                  </div>
                </div>
                <WeightChart entries={displayEntries} />
              </div>

              {/* Recent entries */}
              <div className="card" style={{ padding: "1rem" }}>
                <div className="habit-panel-header" style={{ marginBottom:"0.5rem" }}>
                  <span className="habit-panel-title">History</span>
                  <span style={{ fontSize:"0.7rem", color:"var(--text-dim)" }}>
                    {displayEntries.length} entries
                  </span>
                </div>
                {displayEntries.length === 0 ? (
                  <div className="habit-empty">No entries in this range yet.</div>
                ) : (
                  <div className="weight-history-list">
                    {[...displayEntries].reverse().map(e => (
                      <div key={e.id} className="weight-history-row">
                        <span className="weight-hist-date">{e.entry_date}</span>
                        <span className="weight-hist-val">{e.weight_lbs} lbs</span>
                        {e.body_fat_pct != null && (
                          <span className="weight-hist-bf">{e.body_fat_pct}% bf</span>
                        )}
                        {e.notes && (
                          <span className="weight-hist-note" title={e.notes}>📝</span>
                        )}
                        <button className="habit-del-btn" style={{ opacity:1 }}
                          onClick={() => handleDelete(e.id)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
