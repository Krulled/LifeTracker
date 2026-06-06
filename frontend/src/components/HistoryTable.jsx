import React, { useEffect, useState, useCallback, useRef } from "react";
import EntryForm from "./EntryForm.jsx";

const POLL_INTERVAL = 10000; // 10 seconds

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDuration(mins) {
  if (mins === null || mins === undefined) return "—";
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function scoreBadge(val) {
  if (val === null || val === undefined) return <span className="text-dim">—</span>;
  const cls = val >= 7 ? "high" : val >= 4 ? "mid" : "low";
  return <span className={`score-badge ${cls}`}>{val}</span>;
}

function TagList({ tags }) {
  if (!tags) return <span className="text-dim td-muted">—</span>;
  const chips = tags.split(/[,\s]+/).filter(Boolean);
  return (
    <span>
      {chips.slice(0, 2).map((t) => (
        <span key={t} className="tag-chip">{t}</span>
      ))}
      {chips.length > 2 && (
        <span className="tag-chip">+{chips.length - 2}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Edit Modal
// ---------------------------------------------------------------------------

function EditModal({ entry, onClose, onSaved, onDeleted }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/entries/${entry.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      onDeleted(entry.id);
    } catch (err) {
      setDeleteError(err.message);
      setDeleting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <span className="modal-title">Edit Entry — {entry.entry_date}</span>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <EntryForm
            initialData={entry}
            entryId={entry.id}
            onSuccess={(updated) => {
              onSaved(updated);
              onClose();
            }}
            onCancel={onClose}
          />

          <hr className="divider" />

          {/* Delete zone */}
          {!confirmDelete ? (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirmDelete(true)}
            >
              Delete Entry
            </button>
          ) : (
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.875rem", color: "var(--danger)" }}>
                Permanently delete entry for {entry.entry_date}?
              </span>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Yes, Delete"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Cancel
              </button>
            </div>
          )}
          {deleteError && (
            <div className="alert alert-error" style={{ marginTop: "0.75rem" }}>
              {deleteError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HistoryTable
// ---------------------------------------------------------------------------

export default function HistoryTable({ refreshKey, onMutated }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  // Don't flicker the table on background polls — only show spinner on first load
  const hasFetched = useRef(false);

  const fetchEntries = useCallback((showSpinner = false) => {
    if (showSpinner) setLoading(true);
    setError(null);
    fetch("/api/entries?limit=30")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const rows = data.entries ?? data;
        setEntries(rows.slice(0, 30));
        setLoading(false);
        setLastUpdated(new Date());
        hasFetched.current = true;
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Initial load + manual refresh trigger
  useEffect(() => {
    fetchEntries(!hasFetched.current);
  }, [refreshKey, fetchEntries]);

  // Real-time polling — silent, no spinner
  useEffect(() => {
    const id = setInterval(() => fetchEntries(false), POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchEntries]);

  function handleSaved(updated) {
    setEntries((prev) =>
      prev.map((e) => (e.id === updated.id ? updated : e))
    );
    if (onMutated) onMutated();
  }

  function handleDeleted(id) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setSelectedEntry(null);
    if (onMutated) onMutated();
  }

  if (error) {
    return (
      <div className="alert alert-error">
        Failed to load entries: {error}. Is the backend running?
      </div>
    );
  }

  return (
    <>
      {/* Section heading */}
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
          Recent Entries
          <span
            style={{
              marginLeft: "0.5rem",
              color: "var(--text-dim)",
              fontWeight: 400,
            }}
          >
            (last 30)
          </span>
        </h2>
        <div style={{ display: "flex", gap: "1rem", alignItems: "baseline" }}>
          {lastUpdated && (
            <span style={{ fontSize: "0.68rem", fontFamily: "var(--font-mono)", color: "var(--text-dim)", opacity: 0.6 }}>
              ↻ {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <span style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>
            Click a row to edit
          </span>
        </div>
      </div>

      <div className="table-wrapper">
        {loading ? (
          <div style={{ padding: "2rem", textAlign: "center" }}>
            <span className="spinner" />
          </div>
        ) : entries.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: "2rem" }}>🌙</div>
            <p>No entries yet. Log your first sleep entry.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Bed→Wake</th>
                <th>Duration</th>
                <th>Cycles</th>
                <th>Inertia</th>
                <th>Energy</th>
                <th>Stress</th>
                <th>Miles</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} onClick={() => setSelectedEntry(e)}>
                  <td className="td-date">{e.entry_date}</td>
                  <td>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem" }}>
                      {e.bed_time}
                      <span style={{ color: "var(--text-dim)" }}> → </span>
                      {e.wake_time}
                    </span>
                  </td>
                  <td>{fmtDuration(e.sleep_duration_minutes)}</td>
                  <td>
                    {e.sleep_cycles !== null && e.sleep_cycles !== undefined
                      ? e.sleep_cycles
                      : "—"}
                  </td>
                  <td>{scoreBadge(e.inertia_score)}</td>
                  <td>{scoreBadge(e.energy_score)}</td>
                  <td>{scoreBadge(e.stress_score)}</td>
                  <td>
                    {e.miles_walked !== null && e.miles_walked !== undefined
                      ? e.miles_walked
                      : "—"}
                  </td>
                  <td><TagList tags={e.tags} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit Modal */}
      {selectedEntry && (
        <EditModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </>
  );
}
