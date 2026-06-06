---
name: feedback-test-patterns
description: "Selector conventions and test authoring patterns observed in debug-agent.spec.js"
metadata:
  type: feedback
---

**Use class-based selectors tied to component BEM names.** The suite relies heavily on CSS class selectors like `.hyd-date-nav`, `.bm-field-input`, `.ex-ai-summary`, `.mef-modal`. These are component-scoped and relatively stable as long as className strings in JSX aren't changed.

**Why:** The project does not use data-testid attributes. Class selectors are the agreed convention for this codebase. When components are renamed or refactored, their CSS classes change and tests break — watch for this.

**How to apply:** When adding tests, use the component's own CSS class names. If a test breaks after a refactor, the first thing to check is whether the component's className was changed.

---

**The goModule() helper navigates by hash route (`/#moduleId`)** and waits for `.hub-wrapper` to disappear. If a new module doesn't remove `.hub-wrapper` from the DOM on mount, the helper falls back (catch) and continues — this is intentional and safe.

**How to apply:** New module tests should use goModule(page, "your-module-id") where the id matches the hash routing key registered in App.jsx.

---

**console error collection is per-test**, set up via collectErrors(page) at the top of each test. The array is printed to stdout (visible in CLI output as "X errors: []") and then asserted empty (minus favicon). This is the primary signal for silent runtime failures.

**How to apply:** Every new test must call collectErrors(page) and assert the filtered array has length 0.

---

**Body Measurements save/delete test is the only write-path test** that mutates real DB data. It uses TODAY (derived from new Date() at module load time, not runtime) to set the date input, saves, then deletes. The dialog confirm is handled with page.once("dialog"). This pattern is safe for local dev but would corrupt cloud data if run against the live URL.

**Why:** Suite is designed for local dev only. playwright.config.js baseURL should always point to localhost:9999.
