import { test, expect } from "./fixtures";

test("create, rename, and delete a location (currently /app/stores)", async ({ authedPage }) => {
  const original = `E2E Location ${Date.now()}`;
  const renamed = `${original} renamed`;

  await authedPage.goto("/app/stores");
  await authedPage.getByRole("link", { name: /new store/i }).click();

  // StoreForm has 4 required fields; Name empty, others pre-filled with defaults.
  await authedPage.getByLabel(/^name$/i).fill(original);
  await authedPage.getByRole("button", { name: /create store/i }).click();
  await expect(authedPage.getByText(original)).toBeVisible();

  // Rename round-trip
  await authedPage.getByText(original).click();
  await expect(authedPage).toHaveURL(/\/app\/stores\/[0-9a-f-]+$/);
  await authedPage.getByLabel(/^name$/i).fill(renamed);
  await authedPage.getByRole("button", { name: /save store/i }).click();
  await expect(authedPage).toHaveURL(/\/app\/stores$/);
  await expect(authedPage.getByText(renamed)).toBeVisible();
  await expect(authedPage.getByText(original, { exact: true })).toHaveCount(0);

  // Delete
  await authedPage.getByText(renamed).click();
  await authedPage.getByRole("button", { name: /delete store/i }).click();
  await expect(authedPage).toHaveURL(/\/app\/stores$/);
  await expect(authedPage.getByText(renamed)).not.toBeVisible();
});
