import { test, expect } from "./fixtures";

test("authed user can reach /app without being kicked back to /login", async ({ authedPage }) => {
  await authedPage.goto("/app");
  // After Phase 3, /app renders Dashboard Home. Pre-polish, it may render
  // the current stub or the devices list. Any URL starting with /app is
  // acceptable; what matters is no bounce to /login.
  await expect(authedPage).toHaveURL(/\/app(\/|$)/);
  await expect(authedPage.locator("body")).toBeVisible();
});

test.describe("unauthenticated", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("unauthenticated user redirects to /login", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });
});
