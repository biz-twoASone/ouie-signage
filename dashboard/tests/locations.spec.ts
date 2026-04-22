import { test, expect } from "./fixtures";

test("create, rename, delete a location (currently /app/stores)", async ({ authedPage }) => {
  const name = `E2E Location ${Date.now()}`;
  await authedPage.goto("/app/stores");
  await authedPage.getByRole("link", { name: /new store/i }).click();

  // StoreForm has 4 required fields; Name empty, others pre-filled with defaults.
  await authedPage.getByLabel(/^name$/i).fill(name);
  await authedPage.getByRole("button", { name: /create store/i }).click();

  // Back on list; name appears.
  await expect(authedPage.getByText(name)).toBeVisible();

  // Rename
  await authedPage.getByText(name).click();
  await expect(authedPage).toHaveURL(/\/app\/stores\/[a-f0-9-]{36}/);
  const nameInput = authedPage.getByLabel(/^name$/i);
  await nameInput.fill(`${name} Renamed`);
  await authedPage.getByRole("button", { name: /^save$/i }).click();
  // Stays on detail page after save; navigate back to list to verify.
  await authedPage.goto("/app/stores");
  await expect(authedPage.getByText(`${name} Renamed`)).toBeVisible();

  // Delete
  await authedPage.getByText(`${name} Renamed`).click();
  await authedPage.getByRole("button", { name: /delete store/i }).click();
  // Delete action redirects to /app/stores.
  await expect(authedPage).toHaveURL(/\/app\/stores$/);
  await expect(authedPage.getByText(`${name} Renamed`)).not.toBeVisible();
});
