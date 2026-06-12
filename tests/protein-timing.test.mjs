import assert from "node:assert/strict";
import {
  mealProteinStatus, mealTargetGrams, cutoffLabel, pacificParts,
} from "../frontend/src/components/proteinTiming.mjs";

const T = 157;                 // body weight 157 lb -> 157 g target
const TODAY = "2026-06-06";
const pac = (iso, hour) => ({ iso, hour });
const st = (mealKey, grams, pacific, selectedDate = TODAY) =>
  mealProteinStatus({ mealKey, grams, dayTarget: T, selectedDate, pacific }).status;

let n = 0;
const check = (label, got, want) => { assert.equal(got, want, `${label}: got ${got}, want ${want}`); n++; };

// Per-meal targets (30/35/35 of 157)
check("bfast target", mealTargetGrams("breakfast", T), 47);
check("lunch target", mealTargetGrams("lunch", T), 55);
check("dinner target", mealTargetGrams("dinner", T), 55);

// --- TODAY: breakfast skip flips at noon PST ---
check("bfast 9am today",     st("breakfast", 0, pac(TODAY, 9)),    "upcoming");
check("bfast 11:59 today",   st("breakfast", 0, pac(TODAY, 11.98)),"upcoming");
check("bfast 12:00 today",   st("breakfast", 0, pac(TODAY, 12)),   "skipped");   // the requirement
check("bfast 14:00 today",   st("breakfast", 0, pac(TODAY, 14)),   "skipped");

// --- TODAY: lunch (cutoff 16) and dinner (cutoff 21) ---
check("lunch 12pm today",    st("lunch", 0, pac(TODAY, 12)),  "upcoming");
check("lunch 16:00 today",   st("lunch", 0, pac(TODAY, 16)),  "skipped");
check("dinner 20:00 today",  st("dinner", 0, pac(TODAY, 20)), "upcoming");
check("dinner 21:00 today",  st("dinner", 0, pac(TODAY, 21)), "skipped");

// --- logged amounts override timing ---
check("bfast met 9am",       st("breakfast", 50, pac(TODAY, 9)),  "good");   // 50 >= 47
check("bfast low 9am",       st("breakfast", 20, pac(TODAY, 9)),  "low");    // 0<20<47
check("bfast met after noon",st("breakfast", 47, pac(TODAY, 13)), "good");

// --- PAST day: always skipped regardless of hour ---
check("bfast past day 5am",  st("breakfast", 0, pac(TODAY, 5), "2026-05-09"), "skipped");
check("dinner past day",     st("dinner", 0, pac(TODAY, 5), "2026-05-09"),    "skipped");

// --- FUTURE day: never skipped ---
check("bfast future day",    st("breakfast", 0, pac(TODAY, 23), "2026-06-07"), "upcoming");

// --- snacks are bonus, never skipped ---
check("snack today noon",    st("snack", 0, pac(TODAY, 12)), "snack");

// cutoff labels
check("bfast label", cutoffLabel("breakfast"), "12pm");
check("lunch label", cutoffLabel("lunch"), "4pm");
check("dinner label", cutoffLabel("dinner"), "9pm");

// pacificParts returns a sane shape against real clock
const p = pacificParts();
assert.match(p.iso, /^\d{4}-\d{2}-\d{2}$/, "iso shape");
assert.ok(p.hour >= 0 && p.hour < 24, "hour range");
n += 2;

console.log(`ALL ${n} PROTEIN-TIMING ASSERTIONS PASSED`);
