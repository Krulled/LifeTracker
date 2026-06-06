import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL:     "http://localhost:3030",
    headless:    false,          // visible browser so you can watch it debug
    slowMo:      250,            // 250ms between actions — easy to follow
    screenshot:  "only-on-failure",
    video:       "retain-on-failure",
    trace:       "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
