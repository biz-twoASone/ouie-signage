import { test, expect } from "./fixtures";

test("pair page renders form (code is entered, not requested here)", async ({ authedPage }) => {
  await authedPage.goto("/app/devices/pair");
  // If no stores exist yet, the page shows a "create a store first" CTA
  // instead of the form. Smoke-pass if EITHER renders.
  const form = authedPage.getByRole("textbox", { name: /pairing code/i });
  const createStoreCta = authedPage.getByRole("link", { name: /create a store/i });
  await expect(form.or(createStoreCta)).toBeVisible();
});

test("screens list page renders", async ({ authedPage }) => {
  await authedPage.goto("/app/devices");
  // Either a list of devices OR an empty-state is acceptable post-auth.
  await expect(authedPage.locator("main, body")).toBeVisible();
  // Page loaded without an auth redirect.
  await expect(authedPage).toHaveURL(/\/app\/devices$/);
});

// Sync Now requires a seeded paired device with an FCM token. Skipped until
// the fixture is extended to pair a device via the pairing-request Edge
// Function as a test-setup step. Current smoke-only tenant is empty.
test.skip("Sync Now button triggers FCM push and returns 202", async ({ authedPage }) => {
  await authedPage.goto("/app/devices");
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
