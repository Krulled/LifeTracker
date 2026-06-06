import React, { useState, useEffect, useRef } from "react";

const STARTERS = [
  { icon: "📊", text: "Review my week and find patterns" },
  { icon: "⚡", text: "What should I focus on today?" },
  { icon: "😴", text: "How can I improve my sleep?" },
  { icon: "🥗", text: "Am I hitting my nutrition goals?" },
  { icon: "🔋", text: "Why might my energy be low?" },
  { icon: "💪", text: "Build me a weekly improvement plan" },
  { icon: "😊", text: "What's affecting my mood?" },
  { icon: "🔥", text: "Which habits should I prioritize?" },
];

export default function HealthChatbot() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hi! I'm your Health AI Coach. I have access to all your tracked data — sleep, nutrition, exercise, hydration, mood, habits, and tasks.\n\nAsk me anything about your patterns or what you can do to feel and perform better.",
    },
  ]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [cleared, setCleared] = useState(false);

  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const messagesRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [input]);

  async function sendMessage(text) {
    const trimmed = (text || input).trim();
    if (!trimmed || loading) return;

    const userMsg = { role: "user", content: trimmed };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    setLoading(true);
    setError(null);

    // Build history for API: skip opening greeting, keep last 12 turns
    const historyForApi = newMsgs
      .slice(1)
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content }));

    const calGoal = parseInt(localStorage.getItem("cal_goal") || "2000", 10);

    try {
      const res = await fetch("/api/health/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          message:  trimmed,
          history:  historyForApi.slice(0, -1), // everything before current user msg
          cal_goal: calGoal,
          date:     (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })(),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Request failed");
      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearChat() {
    if (!window.confirm("Clear the conversation?")) return;
    setMessages([{
      role: "assistant",
      content:
        "Conversation cleared. What would you like to explore?",
    }]);
    setError(null);
    setCleared(true);
    setTimeout(() => setCleared(false), 1500);
  }

  const showStarters = messages.length <= 1 && !loading;

  // Render message text — preserve newlines as separate paragraphs
  function renderText(text) {
    return text.split("\n").filter(l => l.trim() !== "").map((line, i) => (
      <p key={i} className="hc-msg-line">{line}</p>
    ));
  }

  return (
    <div className="hc-card card">
      {/* ── Header ── */}
      <div className="hc-header">
        <div className="hc-header-left">
          <div className="hc-avatar-wrap">
            <span className="hc-avatar-emoji">🧠</span>
          </div>
          <div>
            <div className="hc-title">Health AI Coach</div>
            <div className="hc-subtitle">Personalized insights from your live health data</div>
          </div>
        </div>
        <div className="hc-header-right">
          <div className="hc-live-dot">
            <span className="hc-live-pulse" />
            <span className="hc-live-label">Live data</span>
          </div>
          <button
            className={`hc-clear-btn${cleared ? " cleared" : ""}`}
            onClick={clearChat}
            title="Clear conversation"
          >
            {cleared ? "✓" : "↺"}
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="hc-messages" ref={messagesRef}>
        {messages.map((m, i) => (
          <div key={i} className={`hc-msg hc-msg-${m.role}`}>
            {m.role === "assistant" && (
              <div className="hc-bubble-avatar">🧠</div>
            )}
            <div className="hc-bubble">
              {renderText(m.content)}
            </div>
            {m.role === "user" && (
              <div className="hc-bubble-avatar hc-bubble-avatar-user">
                <span>You</span>
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="hc-msg hc-msg-assistant">
            <div className="hc-bubble-avatar">🧠</div>
            <div className="hc-bubble hc-typing">
              <span /><span /><span />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="hc-msg hc-msg-assistant">
            <div className="hc-bubble-avatar">⚠️</div>
            <div className="hc-bubble hc-bubble-error">
              <p>Something went wrong — {error}. Try again.</p>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Starter question chips ── */}
      {showStarters && (
        <div className="hc-starters">
          <div className="hc-starters-label">Try asking</div>
          <div className="hc-starters-grid">
            {STARTERS.map(q => (
              <button
                key={q.text}
                className="hc-starter-chip"
                onClick={() => sendMessage(q.text)}
              >
                <span className="hc-starter-icon">{q.icon}</span>
                <span className="hc-starter-text">{q.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Input row ── */}
      <div className="hc-input-row">
        <textarea
          ref={inputRef}
          className="hc-input"
          placeholder="Ask about your sleep, energy, nutrition, habits… (Enter to send)"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={loading}
          rows={1}
        />
        <button
          className="hc-send-btn"
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          aria-label="Send"
        >
          {loading
            ? <span className="spinner" style={{ width:15, height:15 }} />
            : <span className="hc-send-arrow">↑</span>}
        </button>
      </div>
    </div>
  );
}
