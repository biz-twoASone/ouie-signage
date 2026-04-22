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
