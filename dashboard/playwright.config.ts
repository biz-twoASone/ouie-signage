import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";

// Load root-level .env.local into process.env for the test process.
// The webServer (next dev) loads it separately via next.config.ts.
dotenv.config({ path: "../.env.local" });

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // tenant-scoped data; avoid cross-test interference
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // single-tenant seeded DB; no parallelism
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
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
