# Life Tracker — Feature Roadmap

> Last updated: 2026-05-13

---

## Priority 1 — Strength Training (Sets/Reps) ✅ DONE
- [x] Add sets × reps × weight fields per exercise entry
- [x] Support two exercise formats: **cardio** (duration + intensity) and **strength** (sets × reps × weight)
- [x] Progressive overload: routine panel shows last session's numbers per exercise
- [x] Existing cardio entries unaffected (sets/reps nullable, duration still required for non-strength)

---

## Priority 2 — Goals System + TDEE + Body Measurements
- [ ] TDEE/BMR calculator (height, age, activity level → maintenance calories → auto-sets calorie goal)
- [ ] Body measurements module: waist, hips, chest, arms, thighs with trend charts
- [ ] Per-module targets: weight goal + timeline, sleep duration target, habit compliance %, macro goals
- [ ] Dashboard progress bars toward each goal

---

## Priority 3 — Cross-Module AI Correlation Engine
- [ ] Structured pattern detection across all modules (not just chatbot)
- [ ] Example: "Mood averages 5.2 after <7h sleep vs 7.8 after 7h+"
- [ ] Cards on dashboard or weekly review with specific auto-updated findings
- [ ] Covers: sleep ↔ mood, exercise ↔ calories, habits ↔ energy, supplements ↔ mood/energy

---

## Priority 4 — Mood Trigger Tags
- [ ] Add optional cause tags to mood entries (bad sleep, stressful work, good workout, social, etc.)
- [ ] Keep 3-slider UI unchanged — tags are additive
- [ ] Tags feed into correlation engine for richer pattern detection

---

## Priority 5 — Weekly Planning Tab
- [ ] Add "Plan" tab to WeeklyReviewModule
- [ ] Set specific targets for the coming week (avg sleep, # workouts, calorie goal days, etc.)
- [ ] Next week's review auto-scores actual performance against set targets

---

## Priority 6 — Supplements Checklist
- [ ] Daily checklist module (like HabitModule — not a detailed dose log)
- [ ] Check off creatine, vitamin D, fish oil, etc. each day
- [ ] Supplement taken/not feeds correlation engine (energy/mood on days taken vs not)

---

## Priority 7 — Screen Time / Productivity Tracking
- [ ] Single daily value (like hydration — one number per day)
- [ ] Log focused work hours or screen time manually
- [ ] Feeds correlation engine

---

## Completed
- **Priority 1 — Strength Training (Sets/Reps)** — 2026-05-13
