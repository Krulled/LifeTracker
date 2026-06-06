import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIORITIES = [
  { value: 1, label: "Critical", color: "var(--danger)",   icon: "🔴" },
  { value: 2, label: "High",     color: "#f59e0b",         icon: "🟠" },
  { value: 3, label: "Medium",   color: "var(--accent)",   icon: "🟡" },
  { value: 4, label: "Low",      color: "var(--text-dim)", icon: "⚪" },
];

const LISTS = [
  { id: "work",     label: "Work",     icon: "💼", color: "#60a5fa", glow: "rgba(96,165,250,0.18)" },
  { id: "personal", label: "Personal", icon: "🏠", color: "#c084fc", glow: "rgba(192,132,252,0.18)" },
];

const STORAGE_KEY = "task_last_autoclear";

function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

function dueBadge(due_date) {
  if (!due_date) return null;
  const today    = todayISO();
  const overdue  = due_date < today;
  const dueToday = due_date === today;
  return (
    <span className={`task-due-badge ${overdue ? "overdue" : dueToday ? "due-today" : ""}`}>
      {overdue ? "⚠ overdue" : dueToday ? "due today" : due_date}
    </span>
  );
}

// ---------------------------------------------------------------------------
// TaskForm modal
// ---------------------------------------------------------------------------

function TaskForm({ initial, listName, onSave, onCancel }) {
  const [form, setForm] = useState({
    title:       initial?.title       || "",
    description: initial?.description || "",
    priority:    initial?.priority    || 3,
    due_date:    initial?.due_date    || "",
    tags:        initial?.tags        || "",
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true); setError(null);
    const url    = initial ? `/api/tasks/${initial.id}` : "/api/tasks";
    const method = initial ? "PUT" : "POST";
    const res    = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        due_date:  form.due_date || null,
        list_name: initial?.list_name ?? listName,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setError(json.error || "Save failed"); return; }
    onSave(json);
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal-box">
        <div className="modal-header">
          <span className="modal-title">{initial ? "Edit Task" : "New Task"}</span>
          <button className="modal-close" onClick={onCancel} aria-label="Close">✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Title *</label>
            <input className="form-input" value={form.title}
              onChange={e => setForm(f => ({...f, title: e.target.value}))} required autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="form-textarea" rows={2} value={form.description}
              onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder="Optional details…" />
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select className="form-input" value={form.priority}
                onChange={e => setForm(f => ({...f, priority: parseInt(e.target.value)}))}>
                {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.icon} {p.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Due Date</label>
              <input className="form-input" type="date" value={form.due_date}
                onChange={e => setForm(f => ({...f, due_date: e.target.value}))} style={{ colorScheme:"dark" }} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Tags</label>
            <input className="form-input" value={form.tags}
              onChange={e => setForm(f => ({...f, tags: e.target.value}))} placeholder="#work #personal" />
          </div>
          {error && <div className="alert alert-error">✗ {error}</div>}
          <div style={{ display:"flex", gap:"0.5rem", marginTop:"1rem" }}>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex:1 }}>
              {saving ? "Saving…" : initial ? "Update Task" : "Add Task"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskRow
// ---------------------------------------------------------------------------

function TaskRow({ task, onStatusChange, onEdit, onDelete }) {
  const pri  = PRIORITIES.find(p => p.value === task.priority) || PRIORITIES[2];
  const done = task.status === "done";

  return (
    <div className={`task-row ${done ? "task-row-done" : ""}`} style={{ "--pri-color": pri.color }}>
      <input
        type="checkbox"
        className="task-checkbox"
        checked={done}
        onChange={e => onStatusChange(task.id, e.target.checked ? "done" : "todo")}
        aria-label={`Mark "${task.title}" ${done ? "active" : "done"}`}
      />
      <div className="task-row-body" onClick={() => !done && onEdit(task)} style={{ cursor: done ? "default" : "pointer" }}>
        <span className="task-row-title">{task.title}</span>
        <div className="task-row-meta">
          <span className="task-pri-badge" style={{ color: pri.color }}>{pri.icon} {pri.label}</span>
          {dueBadge(task.due_date)}
          {task.tags && task.tags.split(/[\s,]+/).filter(Boolean).map(t => (
            <span key={t} className="tag-chip" style={{ fontSize:"0.68rem" }}>{t}</span>
          ))}
        </div>
      </div>
      <button className="task-del-btn-inline" onClick={() => onDelete(task.id)} title="Delete">🗑</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatPanel
// ---------------------------------------------------------------------------

function ChatPanel({ listName, tasks, onTaskCreated }) {
  const listDef = LISTS.find(l => l.id === listName) || LISTS[0];
  const [messages, setMessages] = useState([{
    role: "assistant",
    text: `Hey! I'm your ${listDef.label} assistant. Ask me to prioritize, or say "add [task]" to create one automatically.`,
  }]);
  const [input,       setInput]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [pendingEdit, setPendingEdit] = useState(null); // { id, title } of task awaiting follow-up
  const bottomRef = useRef(null);

  useEffect(() => {
    setMessages([{
      role: "assistant",
      text: `Switched to ${listDef.label}. ${tasks.filter(t => t.status !== "done").length} active tasks. Say "add [task]" to create one, or ask me what to focus on.`,
    }]);
    setPendingEdit(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listName]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || loading) return;
    setInput("");
    setMessages(m => [...m, { role: "user", text: msg }]);
    setLoading(true);

    // Capture and immediately clear pending edit — one-shot window only
    const activePendingEdit = pendingEdit;
    setPendingEdit(null);

    const body = { message: msg, list_name: listName };
    if (activePendingEdit) body.pending_edit_id = activePendingEdit.id;

    try {
      const res  = await fetch("/api/tasks/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.created_task) {
        const pri = PRIORITIES.find(p => p.value === data.created_task.priority) || PRIORITIES[2];
        setMessages(m => [...m, {
          role: "assistant",
          text: data.reply || `Added "${data.created_task.title}".`,
          created_task: data.created_task,
          pri_label: `${pri.icon} ${pri.label}`,
        }]);
        onTaskCreated();
        if (data.ask_followup) {
          setPendingEdit({ id: data.created_task.id, title: data.created_task.title });
        }
      } else if (data.updated_task) {
        const pri = PRIORITIES.find(p => p.value === data.updated_task.priority) || PRIORITIES[2];
        setMessages(m => [...m, {
          role: "assistant",
          text: data.reply || `Updated "${data.updated_task.title}".`,
          updated_task: data.updated_task,
          pri_label: `${pri.icon} ${pri.label}`,
        }]);
        onTaskCreated();
      } else {
        setMessages(m => [...m, {
          role:  "assistant",
          text:  data.reply || data.error || "No response.",
          error: !res.ok,
        }]);
      }
    } catch {
      setMessages(m => [...m, { role: "assistant", text: "Connection error.", error: true }]);
    }
    setLoading(false);
  }

  return (
    <div className="task-chat-panel card" style={{ "--list-color": listDef.color, "--list-glow": listDef.glow }}>
      <div className="task-chat-header">
        <span className="task-chat-title">🤖 AI Prioritizer</span>
        <span className="task-chat-sub" style={{ color: listDef.color }}>
          {listDef.icon} {listDef.label} · {tasks.filter(t => t.status !== "done").length} active
        </span>
      </div>

      <div className="task-chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`task-chat-msg ${m.role}${m.error ? " error" : ""}`}>
            {m.role === "assistant" && (
              <span className="task-chat-avatar" style={{ background: listDef.color }}>AI</span>
            )}
            <div className="task-chat-bubble">
              {m.text}
              {m.created_task && (
                <div className="task-added-pill">
                  <span className="task-added-check">✓</span>
                  <span className="task-added-title">{m.created_task.title}</span>
                  <span className="task-added-pri">{m.pri_label}</span>
                  {m.created_task.due_date && (
                    <span className="task-added-date">· {m.created_task.due_date}</span>
                  )}
                </div>
              )}
              {m.updated_task && (
                <div className="task-added-pill" style={{ background: "rgba(96,165,250,0.12)", borderColor: "rgba(96,165,250,0.3)" }}>
                  <span className="task-added-check" style={{ color: "#60a5fa" }}>✎</span>
                  <span className="task-added-title">{m.updated_task.title}</span>
                  <span className="task-added-pri">{m.pri_label}</span>
                  {m.updated_task.due_date && (
                    <span className="task-added-date">· {m.updated_task.due_date}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="task-chat-msg assistant">
            <span className="task-chat-avatar" style={{ background: listDef.color }}>AI</span>
            <div className="task-chat-bubble task-chat-typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {pendingEdit && (
        <div className="task-chat-pending-hint">
          Editing: <strong>{pendingEdit.title}</strong> — reply with date/urgency or "no thanks"
        </div>
      )}

      <form className="task-chat-input-row" onSubmit={handleSend}>
        <input
          className="form-input task-chat-input"
          placeholder={pendingEdit ? `Date & urgency for "${pendingEdit.title}"…` : `Ask about your ${listDef.label.toLowerCase()} tasks…`}
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={loading}
        />
        <button type="submit" className="btn btn-primary task-chat-send"
          disabled={loading || !input.trim()}
          style={{ background: listDef.color, borderColor: listDef.color, color: "#000" }}>
          ↑
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ListTabs — animated pill tabs
// ---------------------------------------------------------------------------

function ListTabs({ active, onChange }) {
  const activeIdx = LISTS.findIndex(l => l.id === active);

  return (
    <div className="list-tab-group" role="tablist">
      <div className="list-tab-indicator" style={{ transform: `translateX(calc(${activeIdx * 100}% + ${activeIdx * 3}px))` }} />
      {LISTS.map((l, i) => (
        <button
          key={l.id}
          role="tab"
          aria-selected={active === l.id}
          className={`list-tab-btn${active === l.id ? " active" : ""}`}
          style={{ "--tab-color": l.color, "--tab-glow": l.glow }}
          onClick={() => onChange(l.id, i > activeIdx ? "right" : "left")}
        >
          <span className="list-tab-icon">{l.icon}</span>
          <span>{l.label}</span>
          {active === l.id && <span className="list-tab-dot" style={{ background: l.color }} />}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskListPanel — slides on tab switch
// ---------------------------------------------------------------------------

function TaskListPanel({ listName, slideDir, tasks, loading, onStatusChange, onEdit, onDelete, onClearDone, onNewTask }) {
  const [animClass, setAnimClass] = useState("");
  const [filter,    setFilter]    = useState("all");
  const prevListRef = useRef(listName);

  useEffect(() => {
    if (listName !== prevListRef.current) {
      setAnimClass(slideDir === "right" ? "slide-in-right" : "slide-in-left");
      prevListRef.current = listName;
      const t = setTimeout(() => setAnimClass(""), 320);
      return () => clearTimeout(t);
    }
  }, [listName, slideDir]);

  const listDef = LISTS.find(l => l.id === listName) || LISTS[0];
  const today   = todayISO();

  const allActive = useMemo(() =>
    tasks.filter(t => t.status !== "done")
      .sort((a, b) => a.priority - b.priority || new Date(a.created_at) - new Date(b.created_at)),
    [tasks]);

  const overdueCount = useMemo(() => allActive.filter(t => t.due_date && t.due_date < today).length, [allActive, today]);
  const dueTodayCount = useMemo(() => allActive.filter(t => t.due_date === today).length, [allActive, today]);

  const activeTasks = useMemo(() => {
    if (filter === "overdue")  return allActive.filter(t => t.due_date && t.due_date < today);
    if (filter === "due-today") return allActive.filter(t => t.due_date === today);
    return allActive;
  }, [allActive, filter, today]);

  const doneTasks = useMemo(() => tasks.filter(t => t.status === "done"), [tasks]);
  const grouped   = useMemo(() => {
    const g = { 1:[], 2:[], 3:[], 4:[] };
    activeTasks.forEach(t => (g[t.priority] || g[3]).push(t));
    return g;
  }, [activeTasks]);

  return (
    <div className={`task-list-content ${animClass}`}>
      {/* Header row */}
      <div className="task-list-section-header" style={{ "--list-color": listDef.color }}>
        <span style={{ color: listDef.color }}>{listDef.icon} {listDef.label} Tasks</span>
        <div style={{ display:"flex", gap:"0.5rem", alignItems:"center" }}>
          <span style={{ color:"var(--text-dim)", fontSize:"0.75rem" }}>{allActive.length} active</span>
          <button className="btn btn-primary" style={{ fontSize:"0.75rem", padding:"3px 12px", background: listDef.color, borderColor: listDef.color, color:"#000" }}
            onClick={onNewTask}>
            + Add
          </button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="task-filter-row">
        <button className={`task-filter-pill${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>
          All
        </button>
        <button className={`task-filter-pill task-filter-overdue${filter === "overdue" ? " active" : ""}`} onClick={() => setFilter("overdue")} disabled={overdueCount === 0}>
          Overdue {overdueCount > 0 && <span className="task-filter-count">{overdueCount}</span>}
        </button>
        <button className={`task-filter-pill${filter === "due-today" ? " active" : ""}`} onClick={() => setFilter("due-today")} disabled={dueTodayCount === 0}>
          Due Today {dueTodayCount > 0 && <span className="task-filter-count">{dueTodayCount}</span>}
        </button>
      </div>

      {loading && <div className="brief-loading" style={{ padding:"1.5rem" }}><span className="spinner" /> Loading…</div>}

      {!loading && activeTasks.length === 0 && (
        <div className="task-empty" style={{ padding:"2rem" }}>
          <div style={{ fontSize:"2rem", marginBottom:"0.5rem" }}>{listDef.icon}</div>
          No {listDef.label.toLowerCase()} tasks yet. Hit "+ Add" to get started.
        </div>
      )}

      {!loading && PRIORITIES.map(pri => {
        const items = grouped[pri.value];
        if (!items.length) return null;
        return (
          <div key={pri.value}>
            <div className="task-group-label" style={{ color: pri.color }}>
              {pri.icon} {pri.label}
            </div>
            {items.map(t => (
              <TaskRow key={t.id} task={t}
                onStatusChange={onStatusChange} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </div>
        );
      })}

      {/* Completed section */}
      {doneTasks.length > 0 && !loading && (
        <div className="task-done-section">
          <div className="task-list-section-header" style={{ "--list-color": "var(--text-dim)" }}>
            <span style={{ color:"var(--text-dim)", fontSize:"0.75rem" }}>✓ Completed ({doneTasks.length})</span>
            <button className="btn btn-ghost" style={{ fontSize:"0.72rem", padding:"2px 10px" }} onClick={onClearDone}>
              Clear all
            </button>
          </div>
          {doneTasks.map(t => (
            <TaskRow key={t.id} task={t}
              onStatusChange={onStatusChange} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskModule
// ---------------------------------------------------------------------------

export default function TaskModule({ onBack }) {
  const [activeList, setActiveList] = useState("work");
  const [slideDir,   setSlideDir]   = useState("right");
  const [tasks,      setTasks]      = useState([]);
  const [showForm,   setShowForm]   = useState(false);
  const [editTask,   setEditTask]   = useState(null);
  const [loading,    setLoading]    = useState(true);

  const fetchTasks = useCallback(() => {
    fetch("/api/tasks")
      .then(r => r.json())
      .then(data => { setTasks(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchTasks();
    const today = todayISO();
    if (localStorage.getItem(STORAGE_KEY) !== today) {
      fetch("/api/tasks/completed", { method: "DELETE" })
        .then(() => { localStorage.setItem(STORAGE_KEY, today); fetchTasks(); })
        .catch(() => {});
    }
  }, [fetchTasks]);

  function switchList(id, dir) {
    setSlideDir(dir);
    setActiveList(id);
  }

  async function handleStatusChange(id, status) {
    await fetch(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    fetchTasks();
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this task?")) return;
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    fetchTasks();
  }

  async function handleClearDone() {
    const count = tasks.filter(t => t.status === "done" && t.list_name === activeList).length;
    if (!count) return;
    if (!window.confirm(`Clear ${count} completed task${count > 1 ? "s" : ""}?`)) return;
    await fetch(`/api/tasks/completed?list=${activeList}`, { method: "DELETE" });
    localStorage.setItem(STORAGE_KEY, todayISO());
    fetchTasks();
  }

  const listTasks = useMemo(() => tasks.filter(t => t.list_name === activeList), [tasks, activeList]);

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <button className="back-btn" onClick={onBack}>← Hub</button>
          <div className="brand">
            <span className="brand-icon">✅</span>
            <div>
              <div className="brand-name">Task Tracker</div>
              <div className="brand-sub">PRIORITY MANAGEMENT</div>
            </div>
          </div>
        </div>
        <ListTabs active={activeList} onChange={switchList} />
      </header>

      <main className="task-split-layout">
        <ErrorBoundary>
          <ChatPanel listName={activeList} tasks={listTasks} onTaskCreated={fetchTasks} />

          <div className="task-list-panel card">
            <TaskListPanel
              listName={activeList}
              slideDir={slideDir}
              tasks={listTasks}
              loading={loading}
              onStatusChange={handleStatusChange}
              onEdit={task => { setEditTask(task); setShowForm(true); }}
              onDelete={handleDelete}
              onClearDone={handleClearDone}
              onNewTask={() => setShowForm(true)}
            />
          </div>
        </ErrorBoundary>
      </main>

      {(showForm || editTask) && (
        <TaskForm
          initial={editTask}
          listName={activeList}
          onSave={() => { setShowForm(false); setEditTask(null); fetchTasks(); }}
          onCancel={() => { setShowForm(false); setEditTask(null); }}
        />
      )}
    </div>
  );
}
