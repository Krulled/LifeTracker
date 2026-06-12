// Pure, framework-free helpers for protein meal timing in Pacific time.
// Kept in its own module so the realtime "skipped" logic is unit-testable
// without a browser or React.

export const PROTEIN_MEAL_WEIGHTS = { breakfast: 30, lunch: 35, dinner: 35, snack: 0 };

// Hour (Pacific, 0–24) by which each main meal "should" have been eaten.
// At/after this hour with nothing logged, the meal counts as SKIPPED.
// Before it, the meal is still UPCOMING (not yet a miss).
export const MEAL_CUTOFFS_PST = { breakfast: 12, lunch: 16, dinner: 21 };

export const MAIN_MEALS = ["breakfast", "lunch", "dinner"];

// Current Pacific date (YYYY-MM-DD) and fractional hour — DST-correct because
// it goes through the America/Los_Angeles zone, not a fixed UTC offset.
export function pacificParts(now = new Date()) {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const tp = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(now);
  const hh = parseInt(tp.find(p => p.type === "hour").value, 10) % 24; // '24' → 0 at midnight
  const mm = parseInt(tp.find(p => p.type === "minute").value, 10);
  return { iso, hour: hh + mm / 60 };
}

export function mealTargetGrams(mealKey, dayTarget) {
  return Math.round(dayTarget * (PROTEIN_MEAL_WEIGHTS[mealKey] || 0) / 100);
}

// Returns { status, tgt } where status ∈
//   'good'     — logged ≥ this meal's target
//   'low'      — logged some, but under target
//   'skipped'  — main meal, nothing logged, and its Pacific cutoff has passed
//                (or the selected day is already over)
//   'upcoming' — main meal, nothing logged, but cutoff hasn't passed yet today
//   'snack'    — non-target meal (snacks are bonus)
export function mealProteinStatus({ mealKey, grams, dayTarget, selectedDate, pacific }) {
  const tgt = mealTargetGrams(mealKey, dayTarget);
  if ((PROTEIN_MEAL_WEIGHTS[mealKey] || 0) === 0) return { status: "snack", tgt };
  if (tgt > 0 && grams >= tgt)                     return { status: "good", tgt };
  if (grams > 0)                                   return { status: "low", tgt };
  // Nothing logged for a main meal — decide skipped vs upcoming by the Pacific clock.
  if (selectedDate < pacific.iso) return { status: "skipped", tgt };   // a past day, fully over
  if (selectedDate > pacific.iso) return { status: "upcoming", tgt };  // a future day
  const cutoff = MEAL_CUTOFFS_PST[mealKey];                            // the current Pacific day
  return { status: pacific.hour >= cutoff ? "skipped" : "upcoming", tgt };
}

// "12pm", "4pm", "9pm" — the cutoff label for an upcoming meal.
export function cutoffLabel(mealKey) {
  const h = MEAL_CUTOFFS_PST[mealKey];
  if (h == null) return "";
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}${ampm}`;
}
