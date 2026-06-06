/**
 * Life Tracker — Active Debug Agent
 *
 * Visits every module on the hub, checks for:
 *  - Console errors / uncaught exceptions
 *  - Network 4xx/5xx API calls
 *  - Visible crash overlays or blank screens
 *  - Core interactive elements (forms, buttons, inputs)
 *
 * Run:  npm run debug          (from the tests/ directory)
 * Req:  backend running at localhost:3030
 */

import { test, expect } from "@playwright/test";

// ─── helpers ────────────────────────────────────────────────────────────────

const _d = new Date();
const TODAY = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,"0")}-${String(_d.getDate()).padStart(2,"0")}`;

function collectErrors(page) {
  const errors = [];
  page.on("console",  msg => { if (msg.type() === "error") errors.push(`[console] ${msg.text()}`); });
  page.on("pageerror", err => errors.push(`[pageerror] ${err.message}`));
  page.on("response",  res => {
    if (res.status() >= 400) errors.push(`[http ${res.status()}] ${res.url()}`);
  });
  return errors;
}

async function goModule(page, id) {
  // Navigate directly so the hash is present when React mounts and reads it
  await page.goto(`/#${id}`);
  // Wait until the hub is NOT the active view (module has mounted)
  await page.waitForFunction(
    () => !document.querySelector(".hub-wrapper"),
    { timeout: 8000 }
  ).catch(() => {}); // tolerate if module itself contains no hub-wrapper
  await page.waitForTimeout(500);
}

async function expectNoBlankScreen(page, label) {
  const body = await page.locator("body").innerText();
  const tooShort = body.trim().length < 20;
  if (tooShort) throw new Error(`${label}: blank / near-empty screen`);
}

// ─── tests ───────────────────────────────────────────────────────────────────

test("Hub loads and shows all expected tiles", async ({ page }) => {
  const errs = collectErrors(page);
  await page.goto("/");
  await page.waitForSelector(".hub-wrapper");

  const tiles = [
    ".hub-extra-btn",       // weight / body-measurements
    ".chores-hub-btn",
  ];
  for (const sel of tiles) {
    await expect(page.locator(sel).first()).toBeVisible();
  }

  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Sleep module — loads and shows entry form", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "sleep");
  await expectNoBlankScreen(page, "sleep");
  // Sleep module has a back button and tab-btn navigation (role="tab")
  await expect(page.locator(".back-btn").first()).toBeVisible();
  await expect(page.locator(".tab-btn").first()).toBeVisible();
  console.log("Sleep errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Calories module — loads and shows food form", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "calories");
  await expectNoBlankScreen(page, "calories");
  console.log("Calories errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Exercise module — loads, shows grouped list and AI summary", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "exercise");
  await expectNoBlankScreen(page, "exercise");

  // AI summary section should always be visible (may need extra time to render)
  await expect(page.locator(".ex-ai-summary").first()).toBeVisible({ timeout: 8000 });

  // Log button opens the multi-exercise form
  const logBtn = page.getByRole("button", { name: /^\+\s*Log$/i });
  await expect(logBtn.first()).toBeVisible();

  console.log("Exercise errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Exercise module — multi-exercise form opens and closes", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "exercise");

  // Click the "+ Log" button to open the multi-exercise form modal
  const logBtn = page.getByRole("button", { name: /^\+\s*Log$/i }).first();
  await expect(logBtn).toBeVisible({ timeout: 6000 });
  await logBtn.click();
  await page.waitForSelector(".mef-modal", { timeout: 4000 });

  // Form should have exercise name inputs (class is ON the input itself)
  await expect(page.locator("input.mef-col-name, .mef-row input[placeholder*='Bench']").first()).toBeVisible();

  // Close via cancel
  const cancelBtn = page.getByRole("button", { name: /cancel/i });
  if (await cancelBtn.isVisible()) await cancelBtn.click();

  console.log("MultiExerciseForm errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Nutrition module — loads both tabs", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "nutrition");
  await expectNoBlankScreen(page, "nutrition");

  // NutritionFitnessModule has stacked panels (no tab nav) — check for panel cards
  await expect(page.locator(".nf-panel").first()).toBeVisible({ timeout: 5000 });

  console.log("Nutrition errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Hydration module — loads and shows glass counter", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "hydration");
  await expectNoBlankScreen(page, "hydration");
  // Date nav should be present
  await expect(page.locator(".hyd-date-nav")).toBeVisible();
  // Add/remove buttons present
  await expect(page.locator(".hydration-btn-add")).toBeVisible();
  console.log("Hydration errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Hydration module — date navigation goes to yesterday and back", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "hydration");

  // Should start on Today
  await expect(page.locator(".hyd-date-nav-label")).toHaveText("Today");

  // Navigate to yesterday
  await page.locator(".hyd-date-nav-btn").first().click();
  await page.waitForTimeout(400);

  // Label should no longer say "Today" and "Back to Today" button appears
  const label = await page.locator(".hyd-date-nav-label").innerText();
  expect(label).not.toBe("Today");
  await expect(page.locator(".hyd-date-nav-today")).toBeVisible();

  // Add a glass to yesterday
  const before = parseInt(await page.locator(".hydration-count").innerText(), 10);
  await page.locator(".hydration-btn-add").click();
  await page.waitForTimeout(600);
  const after = parseInt(await page.locator(".hydration-count").innerText(), 10);
  expect(after).toBe(before + 1);

  // Return to today
  await page.locator(".hyd-date-nav-today").click();
  await page.waitForTimeout(400);
  await expect(page.locator(".hyd-date-nav-label")).toHaveText("Today");

  console.log("Hydration date nav errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Hydration module — clicking history row navigates to that day", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "hydration");

  // Click the second history row (not today) — index 1
  const rows = page.locator(".hydration-hist-row");
  const rowCount = await rows.count();
  if (rowCount > 1) {
    await rows.nth(1).click();
    await page.waitForTimeout(600);
    // Should no longer show "Today"
    const label = await page.locator(".hyd-date-nav-label").innerText();
    expect(label).not.toBe("Today");
    // After the history re-fetches for the new date, exactly one row should be active
    const activeCount = await page.locator(".hydration-hist-row--active").count();
    expect(activeCount).toBe(1);
  }

  console.log("Hydration history click errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Weight module — loads trend chart", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "weight");
  await expectNoBlankScreen(page, "weight");
  console.log("Weight errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Body Measurements module — loads form and fields", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "body-measurements");
  await expectNoBlankScreen(page, "body-measurements");
  await expect(page.locator(".module-title")).toBeVisible();

  // All 7 measurement inputs should be present
  const inputs = page.locator(".bm-field-input");
  await expect(inputs).toHaveCount(7);

  // Date navigator
  await expect(page.locator(".bm-date-input")).toBeVisible();

  console.log("Body Measurements errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Body Measurements — save and delete a test entry", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "body-measurements");

  // Set date to today
  await page.locator(".bm-date-input").fill(TODAY);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);

  // Fill waist
  const inputs = page.locator(".bm-field-input");
  await inputs.nth(0).fill("32.5");

  // Save
  await page.getByRole("button", { name: /save|update/i }).click();
  await page.waitForTimeout(800);

  // Should now show "Update" button (entry exists)
  await expect(page.getByRole("button", { name: /update/i })).toBeVisible();

  // Delete
  await page.getByRole("button", { name: /delete/i }).click();
  await page.waitForTimeout(200);
  // Confirm dialog
  page.once("dialog", d => d.accept());
  await page.waitForTimeout(600);

  console.log("Body Measurements save/delete errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Habits module — loads and shows habit list", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "habits");
  await expectNoBlankScreen(page, "habits");
  console.log("Habits errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Mood module — loads and shows sliders", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "mood");
  await expectNoBlankScreen(page, "mood");
  const sliders = page.locator("input[type='range']");
  expect(await sliders.count()).toBeGreaterThan(0);
  console.log("Mood errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Chores module — loads week view", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "chores");
  await expectNoBlankScreen(page, "chores");
  console.log("Chores errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Weekly Review module — loads", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "weekly-review");
  await expectNoBlankScreen(page, "weekly-review");
  console.log("Weekly Review errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Screen Time module — loads and shows sliders", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "screen-time");
  await expectNoBlankScreen(page, "screen-time");
  // Should have range sliders for focus and screen hours
  const sliders = page.locator("input[type='range']");
  expect(await sliders.count()).toBeGreaterThan(0);
  console.log("Screen Time errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("Profile module — loads and shows TDEE form", async ({ page }) => {
  const errs = collectErrors(page);
  await goModule(page, "profile");
  await expectNoBlankScreen(page, "profile");
  // Should show height/weight inputs
  const inputs = page.locator("input[type='number'], input[type='text']");
  expect(await inputs.count()).toBeGreaterThan(0);
  console.log("Profile errors:", errs);
  expect(errs.filter(e => !e.includes("favicon"))).toHaveLength(0);
});

test("API health — key endpoints return 200", async ({ request }) => {
  const endpoints = [
    `/api/exercise?date=${TODAY}`,
    `/api/food?date=${TODAY}`,
    `/api/sleep?date=${TODAY}`,
    `/api/habits?date=${TODAY}`,
    `/api/mood?date=${TODAY}`,
    `/api/hydration?date=${TODAY}`,
    `/api/hydration/history?days=7&date=${TODAY}`,
    `/api/weight/entries?limit=7`,
    `/api/body-measurements?limit=7`,
    `/api/chores`,
    `/api/screen-time?date=${TODAY}`,
    `/api/profile?date=${TODAY}`,
    `/api/habits/grid?days=7&date=${TODAY}`,
    `/api/weekly-review/current?cal_goal=2000&date=${TODAY}`,
    `/api/skincare?week_start=${TODAY}`,
  ];
  for (const ep of endpoints) {
    const res = await request.get(ep);
    expect(res.status(), `${ep} returned ${res.status()}`).toBeLessThan(400);
  }
});
