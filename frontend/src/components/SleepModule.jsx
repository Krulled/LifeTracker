import React, { useState, useEffect, useCallback } from "react";
import EntryForm      from "./EntryForm.jsx";
import Dashboard      from "./Dashboard.jsx";
import HistoryTable   from "./HistoryTable.jsx";
import ExportPanel    from "./ExportPanel.jsx";
import CalendarView   from "./CalendarView.jsx";
import DayBriefPanel  from "./DayBriefPanel.jsx";
import SleepDebtPanel from "./SleepDebtPanel.jsx";
import ErrorBoundary  from "./ErrorBoundary.jsx";

const TABS = [
  { id: "calendar", label: "📅 Calendar"  },
  { id: "new",      label: "＋ New Entry" },
  { id: "history",  label: "History"      },
  { id: "debt",     label: "💤 Sleep Debt" },
  { id: "export",   label: "Export"       },
];

const POLL_INTERVAL = 10000;

export default function SleepModule({ onBack }) {
  const [activeTab,     setActiveTab]     = useState("calendar");
  const [refreshKey,    setRefreshKey]    = useState(0);
  const [entries,       setEntries]       = useState([]);
  const [networkError,  setNetworkError]  = useState(false);
  const [selectedDate,  setSelectedDate]  = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [prefillDate,   setPrefillDate]   = useState(null);
  const [formDirty,     setFormDirty]     = useState(false);

  const fetchEntries = useCallback(() => {
    fetch("/api/entries?limit=365")
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => {
        setNetworkError(false);
        setEntries(data.entries ?? data);
      })
      .catch(() => setNetworkError(true));
  }, []);

  useEffect(() => { fetchEntries(); }, [refreshKey, fetchEntries]);
  useEffect(() => {
    const id = setInterval(fetchEntries, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchEntries]);

  function handleEntryCreated() { setRefreshKey(k => k + 1); }

  function handleDaySelect(dateStr, entry) {
    setSelectedDate(dateStr);
    setSelectedEntry(entry);
  }

  function handleLogDay(dateStr) {
    setPrefillDate(dateStr);
    setActiveTab("new");
  }

  function handleTabClick(tabId) {
    if (activeTab === "new" && tabId !== "new" && formDirty) {
      if (!window.confirm("Discard unsaved sleep entry?")) return;
    }
    if (tabId === "new") { setPrefillDate(null); setFormDirty(false); }
    setActiveTab(tabId);
  }

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button className="back-btn" onClick={onBack} title="Back to Life Tracker">← Hub</button>
          <div className="brand">
            <span className="brand-icon">🌙</span>
            <div>
              <div className="brand-name">Sleep Tracker</div>
              <div className="brand-sub">BIOMETRIC LOG v1.1 · Groq AI</div>
            </div>
          </div>
        </div>

        <nav className="tab-nav" role="tablist">
          {TABS.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`tab-btn${activeTab === tab.id ? " active" : ""}`}
              onClick={() => handleTabClick(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {networkError && (
        <div className="alert alert-error" style={{ margin: "0.75rem 1.5rem 0" }}>
          ✗ Backend unreachable — please refresh or try again.
        </div>
      )}

      <main>
        {activeTab === "calendar" && (
          <div className="calendar-layout">
            <div>
              <ErrorBoundary>
                <CalendarView entries={entries} onDaySelect={handleDaySelect} selectedDate={selectedDate} />
              </ErrorBoundary>
            </div>
            <div>
              <ErrorBoundary>
                <DayBriefPanel date={selectedDate} entry={selectedEntry} onLogDay={handleLogDay} />
              </ErrorBoundary>
            </div>
          </div>
        )}

        {activeTab === "new" && (
          <ErrorBoundary>
            <EntryForm
              key={prefillDate || "today"}
              prefillDate={prefillDate}
              onSuccess={() => { handleEntryCreated(); setFormDirty(false); setActiveTab("calendar"); }}
              onNavigateHistory={() => setActiveTab("history")}
              onDirty={() => setFormDirty(true)}
            />
          </ErrorBoundary>
        )}

        {activeTab === "history" && (
          <ErrorBoundary>
            <Dashboard refreshKey={refreshKey} />
            <div style={{ marginTop: "1.25rem" }}>
              <HistoryTable refreshKey={refreshKey} onMutated={handleEntryCreated} />
            </div>
          </ErrorBoundary>
        )}

        {activeTab === "debt" && (
          <ErrorBoundary>
            <SleepDebtPanel refreshKey={refreshKey} />
          </ErrorBoundary>
        )}

        {activeTab === "export" && (
          <ErrorBoundary>
            <ExportPanel refreshKey={refreshKey} />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
