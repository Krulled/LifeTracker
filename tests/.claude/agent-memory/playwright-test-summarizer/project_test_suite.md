---
name: project-test-suite
description: "debug-agent.spec.js — single test file, 19 tests, covers all Life Tracker modules plus API health"
metadata:
  type: project
---

The entire Playwright suite lives in a single file: `tests/debug-agent.spec.js`. It runs 19 tests with 1 worker against Chromium only (local dev, no PIN). Backend expected at localhost:3030, frontend at localhost:9999 (served by Vite).

**Test inventory:**
1. Hub — tile visibility (.hub-extra-btn, .chores-hub-btn)
2. Sleep — back button, .tab-btn visible
3. Calories — no-blank-screen only
4. Exercise — .ex-ai-summary visible, "+ Log" button visible
5. Exercise (multi-form) — opens .mef-modal, input.mef-col-name visible, cancel closes
6. Nutrition — .nf-panel visible
7. Hydration — .hyd-date-nav, .hydration-btn-add visible
8. Hydration date nav — go to yesterday and back, increment glass count
9. Hydration history click — click second row, check .hydration-hist-row--active
10. Weight — no-blank-screen only
11. Body Measurements (form) — .module-title, 7x .bm-field-input, .bm-date-input
12. Body Measurements (save/delete) — fills waist field, saves, deletes, confirms dialog
13. Habits — no-blank-screen only
14. Mood — sliders (input[type='range']) count > 0
15. Chores — no-blank-screen only
16. Weekly Review — no-blank-screen only
17. Screen Time — sliders count > 0
18. Profile — input[type='number'] or text count > 0
19. API health — 14 endpoints, all must return < 400; all already use ?date=TODAY client-side

**Error detection pattern:** Each test calls collectErrors(page) which captures console errors, page errors, and HTTP 4xx/5xx. Errors are printed to stdout as "X errors: []" then asserted to be empty (favicon errors filtered).

**Known coverage gaps:** No tests for TaskModule.jsx (tasks), FoodPhotoAnalyzer.jsx (food photos), AIInsights.jsx, HealthChatbot.jsx, PinLock.jsx (auth). No write-path tests for Sleep, Calories, Nutrition, Habits, Mood, Chores, Screen Time — only Body Measurements has a save/delete test.

**Why:** Single-file suite makes it easy to run as a smoke test after deploys or refactors.
**How to apply:** When adding new modules, add a corresponding test block. When adding API endpoints, add to the health check array.
