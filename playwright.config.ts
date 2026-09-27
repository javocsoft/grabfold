import { defineConfig, devices } from "@playwright/test";

// The examples are the fixtures: the tests turn real pages in the real demos,
// served from the repository after a build.
//
// WebKit needs system libraries a desktop may not have; CI installs them with
// `npx playwright install --with-deps`, so it runs there, and locally only
// when GRABFOLD_WEBKIT is set.
const webkit = Boolean(process.env.CI || process.env.GRABFOLD_WEBKIT);

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  // Screenshots are compared against those in the repository; a new one is
  // written the first time a test runs, and never overwritten silently.
  updateSnapshots: "missing",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "allow" } },
  use: {
    baseURL: "http://localhost:5199",
    viewport: { width: 1000, height: 800 },
    reducedMotion: "no-preference",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1000, height: 800 } } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1000, height: 800 } } },
    ...(webkit
      ? [{ name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1000, height: 800 } } }]
      : []),
  ],
  webServer: {
    command: "npm run build && npm run examples && node scripts/serve.mjs 5199",
    url: "http://localhost:5199/examples/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
