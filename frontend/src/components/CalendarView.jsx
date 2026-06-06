import React, { useState, useMemo } from "react";

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function toKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayKey() {
  return toKey(new Date());
}

function getQuality(entry) {
  if (!entry) return null;
  const avg = ((entry.inertia_score || 5) + (entry.energy_score || 5)) / 2;
  if (avg >= 7) return "good";
  if (avg >= 4) return "ok";
  return "poor";
}

// ---------------------------------------------------------------------------

export default function CalendarView({ entries = [], onDaySelect, selectedDate }) {
  const now = new Date();
  const [viewYear,  setViewYear]  = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-indexed

  // Build date → entry map
  const entryMap = useMemo(() => {
    const m = {};
    for (const e of entries) m[e.entry_date] = e;
    return m;
  }, [entries]);

  // Build the 42-cell grid (6 rows × 7 cols)
  const cells = useMemo(() => {
    const firstDay   = new Date(viewYear, viewMonth, 1);
    const lastDay    = new Date(viewYear, viewMonth + 1, 0);
    const startDow   = firstDay.getDay(); // 0=Sun
    const daysInMonth = lastDay.getDate();
    const grid = [];

    for (let i = 0; i < startDow; i++) {
      grid.push({ date: new Date(viewYear, viewMonth, 1 - (startDow - i)), current: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      grid.push({ date: new Date(viewYear, viewMonth, d), current: true });
    }
    while (grid.length < 42) {
      grid.push({ date: new Date(viewYear, viewMonth + 1, grid.length - daysInMonth - startDow + 1), current: false });
    }
    return grid;
  }, [viewYear, viewMonth]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  // Jump to today's month
  function goToday() {
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
  }

  const today  = todayKey();
  const future = (key) => key > today;

  // Summary counts for this month
  const monthKeys = cells.filter(c => c.current).map(c => toKey(c.date));
  const logged    = monthKeys.filter(k => entryMap[k]).length;
  const total     = monthKeys.length;

  return (
    <div className="calendar-wrapper card">
      {/* ---- Header ---- */}
      <div className="calendar-header">
        <button className="cal-nav-btn" onClick={prevMonth} title="Previous month">‹</button>
        <div style={{ textAlign: "center" }}>
          <div className="cal-month-label">{MONTH_NAMES[viewMonth]} {viewYear}</div>
          <div className="cal-coverage">
            {logged}/{total} days logged
          </div>
        </div>
        <button className="cal-nav-btn" onClick={nextMonth} title="Next month">›</button>
      </div>

      {/* Today shortcut */}
      {(viewYear !== now.getFullYear() || viewMonth !== now.getMonth()) && (
        <button className="cal-today-btn" onClick={goToday}>↩ Today</button>
      )}

      {/* ---- Day-of-week headers ---- */}
      <div className="calendar-grid">
        {DAY_HEADERS.map(d => (
          <div key={d} className="cal-day-header">{d}</div>
        ))}

        {/* ---- Day cells ---- */}
        {cells.map((cell, i) => {
          const key     = toKey(cell.date);
          const entry   = entryMap[key];
          const quality = getQuality(entry);
          const isToday = key === today;
          const isFuture = future(key);
          const isSelected = key === selectedDate;
          const clickable   = cell.current && !isFuture;

          let cls = "cal-day";
          if (!cell.current)   cls += " other-month";
          if (isToday)         cls += " today";
          if (entry)           cls += ` logged ${quality}`;
          if (isSelected)      cls += " selected";
          if (isFuture)        cls += " future";
          if (!clickable)      cls += " no-click";

          const ariaLabel = entry
            ? `${key}, ${quality} quality sleep, ${entry.sleep_cycles} cycles`
            : clickable ? `${key}, no entry logged` : undefined;

          return (
            <div
              key={i}
              className={cls}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={ariaLabel}
              aria-pressed={isSelected || undefined}
              onClick={() => clickable && onDaySelect(key, entry || null)}
              onKeyDown={(e) => clickable && (e.key === "Enter" || e.key === " ") && onDaySelect(key, entry || null)}
              title={entry ? `${key} · ${entry.sleep_cycles} cycles · inertia ${entry.inertia_score}` : key}
            >
              <span className="cal-day-num">{cell.date.getDate()}</span>
              {entry && <span className="cal-dot" aria-hidden="true" />}
            </div>
          );
        })}
      </div>

      {/* ---- Legend ---- */}
      <div className="cal-legend">
        <span><span className="cal-legend-dot good" /> Good (≥7)</span>
        <span><span className="cal-legend-dot ok"   /> OK (4–6)</span>
        <span><span className="cal-legend-dot poor" /> Poor (&lt;4)</span>
        <span><span className="cal-legend-today" />   Today</span>
      </div>
    </div>
  );
}
