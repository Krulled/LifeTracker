import React, { useState, useEffect, useCallback } from "react";

const PIN_LENGTH = 6;

export default function PinLock({ onUnlock }) {
  const [digits, setDigits]   = useState([]);
  const [shake,  setShake]    = useState(false);
  const [error,  setError]    = useState("");
  const [busy,   setBusy]     = useState(false);

  const submit = useCallback(async (pin) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/verify", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "same-origin",
        body:        JSON.stringify({ pin }),
      });
      if (r.ok) {
        onUnlock();
      } else {
        setShake(true);
        setError("Incorrect PIN");
        setDigits([]);
        setTimeout(() => setShake(false), 600);
      }
    } catch {
      setError("Network error");
      setDigits([]);
    } finally {
      setBusy(false);
    }
  }, [onUnlock]);

  const press = useCallback((val) => {
    if (busy) return;
    if (val === "del") {
      setDigits(d => d.slice(0, -1));
      setError("");
      return;
    }
    setDigits(prev => {
      const next = [...prev, val];
      if (next.length === PIN_LENGTH) {
        setTimeout(() => submit(next.join("")), 60);
      }
      return next;
    });
  }, [busy, submit]);

  useEffect(() => {
    function onKey(e) {
      if (e.key >= "0" && e.key <= "9") press(e.key);
      if (e.key === "Backspace") press("del");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  const keys = ["1","2","3","4","5","6","7","8","9","","0","del"];

  return (
    <div className="pin-overlay">
      <div className={`pin-card${shake ? " pin-shake" : ""}`}>
        <div className="pin-lock-icon">◈</div>
        <div className="pin-title">LIFE TRACKER</div>
        <div className="pin-subtitle">Enter PIN to continue</div>

        <div className="pin-dots">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div key={i} className={`pin-dot${i < digits.length ? " pin-dot-filled" : ""}`} />
          ))}
        </div>

        {error && <div className="pin-error">{error}</div>}

        <div className="pin-keypad">
          {keys.map((k, i) => {
            if (k === "") return <div key={i} className="pin-key-empty" />;
            return (
              <button
                key={i}
                className={`pin-key${k === "del" ? " pin-key-del" : ""}`}
                onClick={() => press(k)}
                disabled={busy || (k !== "del" && digits.length >= PIN_LENGTH)}
              >
                {k === "del" ? "⌫" : k}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
