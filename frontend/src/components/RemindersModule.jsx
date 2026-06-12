import React, { useState, useEffect, useCallback } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";

function hhmm({ hour, minute }) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
function prettyTime({ hour, minute }) {
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12  = ((hour + 11) % 12) + 1;
  return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

export default function RemindersModule({ onBack }) {
  const [cfg,        setCfg]        = useState(null);
  const [phone,      setPhone]      = useState("");
  const [carrier,    setCarrier]    = useState("");
  const [settings,   setSettings]   = useState({});
  const [enabled,    setEnabled]    = useState(true);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [savedAt,    setSavedAt]    = useState(false);
  const [testing,    setTesting]    = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = useCallback(() => {
    fetch("/api/reminders")
      .then(r => r.json())
      .then(d => {
        setCfg(d);
        setPhone(d.phone || "");
        setCarrier(d.carrier || "");
        setSettings(d.settings || {});
        setEnabled(d.enabled !== false);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function updateCat(key, patch) {
    setSettings(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    setSavedAt(false);
  }

  async function save() {
    setSaving(true); setSavedAt(false);
    const res = await fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, carrier, enabled, settings }),
    });
    setSaving(false);
    if (res.ok) { const d = await res.json(); setCfg(d); setSavedAt(true); }
  }

  async function sendTest(category) {
    setTesting(true); setTestResult(null);
    // Persist current phone/carrier/settings first so the test reflects the latest state.
    await fetch("/api/reminders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, carrier, enabled, settings }),
    }).catch(() => {});
    const res = await fetch("/api/reminders/test", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, carrier, category }),
    });
    const d = await res.json().catch(() => ({}));
    setTesting(false);
    setTestResult(res.ok
      ? { ok: true, preview: d.preview, to: d.to, sid: d.sid }
      : { ok: false, error: d.error || "Send failed" });
  }

  const categories = cfg?.categories || [];

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button className="back-btn" onClick={onBack}>← Hub</button>
          <div className="brand">
            <span className="brand-icon">🔔</span>
            <div>
              <div className="brand-name">Reminders</div>
              <div className="brand-sub">SMS NUDGES · Pacific time</div>
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "1.25rem 1.5rem" }}>
        <ErrorBoundary>
          {loading ? (
            <div className="brief-loading"><span className="spinner" /> Loading…</div>
          ) : (
            <>
              {/* Provider status */}
              {cfg && cfg.delivery === "gmail" && (
                <div className="alert rem-banner rem-banner-ok">
                  ✓ Free delivery active — texts are sent through your carrier's email-to-SMS
                  gateway via Gmail. No per-message cost.
                </div>
              )}
              {cfg && !cfg.sms_configured && (
                <div className="alert alert-warning rem-banner">
                  ⚠ Not connected yet. Reminders save fine, but texts won't send until the
                  server has Gmail email-to-SMS (free) or Twilio credentials.
                </div>
              )}

              {/* Phone + carrier + master switch */}
              <div className="card rem-card">
                <div className="rem-row">
                  <label className="form-label">📱 Your phone number</label>
                  <input
                    className="form-input rem-phone"
                    type="tel"
                    placeholder="+15551234567"
                    value={phone}
                    onChange={e => { setPhone(e.target.value); setSavedAt(false); }}
                  />
                </div>
                <div className="rem-row" style={{ marginTop: "0.75rem" }}>
                  <label className="form-label">📶 Carrier <span style={{ color:"var(--text-dim)", fontWeight:400 }}>— for free email-to-SMS</span></label>
                  <select
                    className="form-input rem-phone"
                    value={carrier}
                    onChange={e => { setCarrier(e.target.value); setSavedAt(false); }}
                  >
                    <option value="">Select carrier…</option>
                    {(cfg?.carriers || []).map(c => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <label className="rem-toggle-row">
                  <span>Reminders {enabled ? "on" : "off"}</span>
                  <input
                    type="checkbox"
                    className="rem-switch"
                    checked={enabled}
                    onChange={e => { setEnabled(e.target.checked); setSavedAt(false); }}
                  />
                </label>
                {cfg?.now_pst && (
                  <div className="rem-now">Server time: {cfg.now_pst}</div>
                )}
              </div>

              {/* Category schedule */}
              <div className="card rem-card">
                <div className="rem-section-title">What to remind me about</div>
                {categories.map(c => {
                  const s = settings[c.key] || { enabled: true, hour: 9, minute: 0 };
                  return (
                    <div key={c.key} className={`rem-cat${s.enabled ? "" : " off"}`}>
                      <span className="rem-cat-icon">{c.icon}</span>
                      <div className="rem-cat-main">
                        <span className="rem-cat-label">{c.label}</span>
                        <span className="rem-cat-time">
                          {s.enabled ? `Daily at ${prettyTime(s)} PT` : "Off"}
                        </span>
                      </div>
                      <input
                        type="time"
                        className="form-input rem-time-input"
                        value={hhmm(s)}
                        disabled={!s.enabled}
                        onChange={e => {
                          const [h, m] = e.target.value.split(":").map(Number);
                          updateCat(c.key, { hour: h || 0, minute: m || 0 });
                        }}
                      />
                      <input
                        type="checkbox"
                        className="rem-switch"
                        checked={!!s.enabled}
                        onChange={e => updateCat(c.key, { enabled: e.target.checked })}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="rem-actions">
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : savedAt ? "✓ Saved" : "Save"}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => sendTest()}
                  disabled={testing || !phone}
                  title={!phone ? "Add a phone number first" : "Send a test text now"}
                >
                  {testing ? "Sending…" : "📨 Send Test SMS"}
                </button>
              </div>

              {testResult && (
                <div className={`card rem-result ${testResult.ok ? "ok" : "err"}`}>
                  {testResult.ok ? (
                    <>
                      <div className="rem-result-head">✅ Sent to {testResult.to}</div>
                      <pre className="rem-preview">{testResult.preview}</pre>
                      <div className="rem-sid">Twilio SID: {testResult.sid}</div>
                    </>
                  ) : (
                    <div className="rem-result-head err">✗ {testResult.error}</div>
                  )}
                </div>
              )}
            </>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
