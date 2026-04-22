import { test, expect } from "./fixtures";

test("add-screen page renders form (code is entered, not requested here)", async ({ authedPage }) => {
  await authedPage.goto("/app/screens/add");
  // If no locations exist yet, the page shows a "create a location first" CTA
  // instead of the form. Smoke-pass if EITHER renders.
  const form = authedPage.getByRole("textbox", { name: /pairing code/i });
  const addLocationCta = authedPage.getByRole("link", { name: /add location/i });
  await expect(form.or(addLocationCta)).toBeVisible();
});

test("screens list page renders", async ({ authedPage }) => {
  await authedPage.goto("/app/screens");
  await expect(authedPage.locator("body")).toBeVisible();
  await expect(authedPage).toHaveURL(/\/app\/screens$/);
});

// Sync Now requires a seeded paired device with an FCM token. Skipped until
// the fixture is extended to pair a device via the pairing-request Edge
// Function as a test-setup step. Current smoke-only tenant is empty.
test.skip("Sync Now button triggers FCM push and returns 202", async ({ authedPage }) => {
  await authedPage.goto("/app/screens");
  const firstScreenLink = authedPage.getByRole("link").first();
  await firstScreenLink.click();

  const [resp] = await Promise.all([
    authedPage.waitForResponse(
      (r) => r.url().includes("sync-now") && r.request().method() === "POST",
    ),
    authedPage.getByRole("button", { name: /sync now/i }).click(),
  ]);

  expect(resp.status()).toBe(202);
});
