import React, { useEffect, useState, useCallback } from "react";

const POLL_INTERVAL = 10000; // 10 seconds

function StatCard({ label, value, unit, loading }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {loading ? (
          <span className="spinner" style={{ width: 24, height: 24 }} />
        ) : value !== null && value !== undefined ? (
          value
        ) : (
          <span style={{ color: "var(--text-dim)", fontSize: "1rem" }}>—</span>
        )}
      </div>
      {unit && <div className="stat-unit">{unit}</div>}
    </div>
  );
}

export default function Dashboard({ refreshKey }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchStats = useCallback(() => {
    fetch("/api/stats")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setStats(data);
        setLoading(false);
        setError(null);
        setLastUpdated(new Date());
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Initial load + refresh when parent triggers
  useEffect(() => {
    setLoading(true);
    fetchStats();
  }, [refreshKey, fetchStats]);

  // Real-time polling
  useEffect(() => {
    const id = setInterval(fetchStats, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchStats]);

  function fmtHours(mins) {
    if (mins === null || mins === undefined) return null;
    return (mins / 60).toFixed(1);
  }

  function fmtScore(val) {
    if (val === null || val === undefined) return null;
    return val.toFixed(1);
  }

  if (error) {
    return (
      <div className="alert alert-error">
        Failed to load stats: {error}. Is the backend running?
      </div>
    );
  }

  const cards = [
    {
      label: "Total Entries",
      value: loading ? null : stats?.total_entries ?? 0,
      unit: "days tracked",
    },
    {
      label: "Avg Sleep Duration",
      value: loading ? null : fmtHours(stats?.avg_sleep_duration_minutes),
      unit: "hours / night",
    },
    {
      label: "Avg Sleep Cycles",
      value: loading ? null : fmtScore(stats?.avg_sleep_cycles),
      unit: "90-min cycles",
    },
    {
      label: "Avg Inertia Score",
      value: loading ? null : fmtScore(stats?.avg_inertia_score),
      unit: "out of 10",
    },
    {
      label: "Avg Energy Score",
      value: loading ? null : fmtScore(stats?.avg_energy_score),
      unit: "out of 10",
    },
    {
      label: "Avg Miles Walked",
      value: loading ? null : fmtScore(stats?.avg_miles_walked),
      unit: "miles / day",
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
        }}
      >
        <h2
          style={{
            fontSize: "0.8rem",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--text-muted)",
            fontWeight: 600,
          }}
        >
          Overview
        </h2>
        <div style={{ display: "flex", gap: "1rem", alignItems: "baseline" }}>
          {stats?.date_range_start && (
            <span style={{ fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
              {stats.date_range_start} → {stats.date_range_end}
            </span>
          )}
          {lastUpdated && (
            <span style={{ fontSize: "0.68rem", fontFamily: "var(--font-mono)", color: "var(--text-dim)", opacity: 0.6 }}>
              ↻ {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="stat-grid">
        {cards.map((c) => (
          <StatCard key={c.label} {...c} loading={loading} />
        ))}
      </div>
    </div>
  );
}
