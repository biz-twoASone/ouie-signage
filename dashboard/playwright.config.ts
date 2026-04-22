import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";

// Load .env.local into process.env for the test process. Next's own dev server
// auto-loads dashboard/.env.local; additionally, next.config.ts pulls in the
// repo-root .env.local (R2 creds + edge secrets). Playwright's test process
// doesn't auto-load either, so we replicate both loads here.
// `override: false` (default) — first file wins, matches Next's precedence.
dotenv.config({ path: "./.env.local" });   // dashboard/.env.local — Supabase URL + keys
dotenv.config({ path: "../.env.local" });  // repo-root .env.local — R2 + other secrets

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // tenant-scoped data; avoid cross-test interference
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // single-tenant seeded DB; no parallelism
  reporter: [["list"], ["html", { open: "never" }]],
  // Sign in once, reuse cookies across all tests — avoids Supabase's
  // max_frequency="5s" throttle on magic-link requests per user.
  globalSetup: require.resolve("./tests/global-setup.ts"),
  use: {
    baseURL: "http://localhost:3000",
    storageState: "./playwright/.auth/user.json",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
