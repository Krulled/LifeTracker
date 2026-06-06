import React, { useState, useEffect, useMemo } from "react";

const FIELDS = [
  { key: "waist_in",       label: "Waist",       color: "#f59e0b" },
  { key: "hips_in",        label: "Hips",         color: "#a78bfa" },
  { key: "chest_in",       label: "Chest",        color: "#60a5fa" },
  { key: "left_arm_in",    label: "Left Arm",     color: "#34d399" },
  { key: "right_arm_in",   label: "Right Arm",    color: "#86efac" },
  { key: "left_thigh_in",  label: "Left Thigh",   color: "#f472b6" },
  { key: "right_thigh_in", label: "Right Thigh",  color: "#fb923c" },
];

const CHART_GROUPS = [
  { label: "Waist",  fields: [{ key: "waist_in",       label: "Waist",       color: "#f59e0b" }] },
  { label: "Hips",   fields: [{ key: "hips_in",        label: "Hips",        color: "#a78bfa" }] },
  { label: "Chest",  fields: [{ key: "chest_in",       label: "Chest",       color: "#60a5fa" }] },
  { label: "Arms",   fields: [
    { key: "left_arm_in",  label: "Left",  color: "#34d399" },
    { key: "right_arm_in", label: "Right", color: "#86efac" },
  ]},
  { label: "Thighs", fields: [
    { key: "left_thigh_in",  label: "Left",  color: "#f472b6" },
    { key: "right_thigh_in", label: "Right", color: "#fb923c" },
  ]},
];

function MeasChart({ group, entries }) {
  const W = 280, H = 110, PAD = { top: 8, right: 8, bottom: 22, left: 32 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const sorted = useMemo(() =>
    [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date)),
  [entries]);

  const relevantRows = sorted.filter(r =>
    group.fields.some(f => r[f.key] != null)
  );
  if (relevantRows.length < 2) {
    return (
      <div className="bm-chart-card">
        <div className="bm-chart-title">{group.label}</div>
        <div className="bm-chart-empty">Not enough data yet</div>
      </div>
    );
  }

  const allVals = relevantRows.flatMap(r => group.fields.map(f => r[f.key]).filter(v => v != null));
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;

  const xScale = (i) => PAD.left + (i / (relevantRows.length - 1)) * chartW;
  const yScale = (v) => PAD.top + chartH - ((v - minV) / range) * chartH;

  const lines = group.fields.map(f => {
    const pts = relevantRows
      .map((r, i) => r[f.key] != null ? `${xScale(i).toFixed(1)},${yScale(r[f.key]).toFixed(1)}` : null)
      .filter(Boolean);
    if (pts.length < 2) return null;
    return (
      <polyline
        key={f.key}
        points={pts.join(" ")}
        fill="none"
        stroke={f.color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    );
  });

  const latestRow = relevantRows[relevantRows.length - 1];
  const dots = group.fields.flatMap(f => {
    if (latestRow[f.key] == null) return [];
    const i = relevantRows.length - 1;
    return [
      <circle
        key={f.key}
        cx={xScale(i)}
        cy={yScale(latestRow[f.key])}
        r="3"
        fill={f.color}
      />
    ];
  });

  const tickCount = 3;
  const yTicks = Array.from({ length: tickCount }, (_, i) =>
    minV + (i / (tickCount - 1)) * range
  );

  const xLabels = relevantRows.length <= 6
    ? relevantRows.map((r, i) => ({ i, label: r.entry_date.slice(5) }))
    : [
        { i: 0, label: relevantRows[0].entry_date.slice(5) },
        { i: relevantRows.length - 1, label: relevantRows[relevantRows.length - 1].entry_date.slice(5) },
      ];

  return (
    <div className="bm-chart-card">
      <div className="bm-chart-title">
        {group.label}
        {group.fields.length > 1 && (
          <span className="bm-chart-legend">
            {group.fields.map(f => (
              <span key={f.key} style={{ color: f.color }}>{f.label}</span>
            ))}
          </span>
        )}
      </div>
      <svg width={W} height={H} className="bm-chart-svg">
        {yTicks.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD.left} x2={W - PAD.right}
              y1={yScale(v)} y2={yScale(v)}
              stroke="rgba(255,255,255,0.07)" strokeWidth="1"
            />
            <text x={PAD.left - 4} y={yScale(v) + 4} textAnchor="end" className="bm-chart-tick">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {xLabels.map(({ i, label }) => (
          <text key={i} x={xScale(i)} y={H - 4} textAnchor="middle" className="bm-chart-tick">
            {label}
          </text>
        ))}
        {lines}
        {dots}
      </svg>
    </div>
  );
}

function fmt(v) {
  if (v == null) return "—";
  return `${v.toFixed(1)}"`;
}

function delta(curr, prev) {
  if (curr == null || prev == null) return null;
  const d = curr - prev;
  if (Math.abs(d) < 0.05) return null;
  return d;
}

export default function BodyMeasurementsModule({ onBack }) {
  const _d = new Date();
  const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,"0")}-${String(_d.getDate()).padStart(2,"0")}`;
  const [date,    setDate]    = useState(today);
  const [entries, setEntries] = useState([]);
  const [saving,  setSaving]  = useState(false);
  const [form,    setForm]    = useState(() =>
    Object.fromEntries(FIELDS.map(f => [f.key, ""]))
  );
  const [notes, setNotes] = useState("");

  function load() {
    fetch("/api/body-measurements?limit=1095")
      .then(r => r.json())
      .then(setEntries)
      .catch(() => {});
  }
  useEffect(load, []);

  const sorted = useMemo(() =>
    [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date)),
  [entries]);

  const rowForDate = useMemo(() =>
    entries.find(e => e.entry_date === date) ?? null,
  [entries, date]);

  const prevRow = useMemo(() => {
    const idx = sorted.findIndex(e => e.entry_date === date);
    if (idx > 0) return sorted[idx - 1];
    if (idx === -1 && sorted.length > 0) return sorted[sorted.length - 1];
    return null;
  }, [sorted, date]);

  useEffect(() => {
    if (rowForDate) {
      setForm(Object.fromEntries(FIELDS.map(f => [f.key, rowForDate[f.key] ?? ""])));
      setNotes(rowForDate.notes ?? "");
    } else {
      setForm(Object.fromEntries(FIELDS.map(f => [f.key, ""])));
      setNotes("");
    }
  }, [rowForDate]);

  async function save() {
    setSaving(true);
    const body = { entry_date: date, notes };
    FIELDS.forEach(f => { body[f.key] = form[f.key] === "" ? null : parseFloat(form[f.key]) || null; });
    await fetch("/api/body-measurements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
    await load();
    setSaving(false);
  }

  async function del() {
    if (!rowForDate) return;
    if (!window.confirm("Delete measurements for this date?")) return;
    await fetch(`/api/body-measurements/${rowForDate.id}`, { method: "DELETE" });
    load();
  }

  function stepDate(dir) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + dir);
    setDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
  }

  return (
    <div className="module-wrapper">
      <div className="module-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h2 className="module-title">Body Measurements</h2>
      </div>

      {/* Date navigator */}
      <div className="bm-date-nav">
        <button className="bm-nav-btn" onClick={() => stepDate(-1)}>‹</button>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="bm-date-input"
        />
        <button className="bm-nav-btn" onClick={() => stepDate(1)} disabled={date >= today}>›</button>
        {date !== today && (
          <button className="bm-nav-btn" onClick={() => setDate(today)} title="Go to today">Today</button>
        )}
      </div>

      {/* Main 2-col layout */}
      <div className="bm-main-grid">
        {/* Form */}
        <div className="nf-panel">
          <div className="nf-panel-header">
            <span>{rowForDate ? "Update Measurements" : "Log Measurements"}</span>
          </div>
          <div className="bm-field-grid">
            {FIELDS.map(f => (
              <label key={f.key} className="bm-field-label">
                <span style={{ color: f.color }}>{f.label}</span>
                <div className="bm-field-row">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="—"
                    value={form[f.key]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="bm-field-input"
                  />
                  <span className="bm-field-unit">in</span>
                </div>
              </label>
            ))}
          </div>
          <textarea
            placeholder="Notes (optional)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="bm-notes"
            rows={2}
          />
          <div className="bm-form-actions">
            <button className="bm-save-btn" onClick={save} disabled={saving}>
              {saving ? "Saving…" : rowForDate ? "Update" : "Save"}
            </button>
            {rowForDate && (
              <button className="bm-delete-btn" onClick={del}>Delete</button>
            )}
          </div>
        </div>

        {/* Summary */}
        <div className="nf-panel">
          <div className="nf-panel-header">
            <span>Latest Values</span>
          </div>
          {sorted.length === 0 ? (
            <p className="bm-summary-empty">No measurements logged yet.</p>
          ) : (() => {
            // Use the entry for the selected date; fall back to most recent
            const displayRow = rowForDate ?? sorted[sorted.length - 1];
            const isFallback = !rowForDate && displayRow != null;
            // prevRow is already computed relative to the selected date
            return (
              <div className="bm-summary-list">
                {FIELDS.map(f => {
                  const d = delta(displayRow[f.key], prevRow?.[f.key]);
                  return (
                    <div key={f.key} className="bm-summary-row">
                      <span className="bm-summary-label" style={{ color: f.color }}>{f.label}</span>
                      <span className="bm-summary-val">{fmt(displayRow[f.key])}</span>
                      {d != null && (
                        <span className={`bm-summary-delta ${d < 0 ? "down" : "up"}`}>
                          {d > 0 ? "+" : ""}{d.toFixed(1)}"
                        </span>
                      )}
                    </div>
                  );
                })}
                <div className="bm-summary-date">
                  {isFallback
                    ? `No entry for ${date} · showing ${displayRow.entry_date}`
                    : `Entry: ${displayRow.entry_date}`}
                  {prevRow && ` · prev: ${prevRow.entry_date}`}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Trend charts */}
      {sorted.length >= 2 && (
        <div className="bm-charts-section">
          <div className="bm-charts-heading">Trends (last {sorted.length} entries)</div>
          <div className="bm-charts-grid">
            {CHART_GROUPS.map(g => (
              <MeasChart key={g.label} group={g} entries={sorted} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
