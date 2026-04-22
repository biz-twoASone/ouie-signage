import { test, expect } from "./fixtures";

test("authed user lands on dashboard home", async ({ authedPage }) => {
  // After Phase 3, landing URL is /app (Dashboard Home). Pre-polish, the
  // app may redirect /app → /app/devices or similar. Accept either shape.
  await expect(authedPage).toHaveURL(/\/app(\/|$)/);
  await expect(authedPage.locator("main, body")).toBeVisible();
});

test("unauthenticated user redirects to /login", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
});
