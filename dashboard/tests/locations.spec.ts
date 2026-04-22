import { test, expect } from "./fixtures";

test("create and delete a location (currently /app/stores)", async ({ authedPage }) => {
  const name = `E2E Location ${Date.now()}`;
  await authedPage.goto("/app/stores");
  await authedPage.getByRole("link", { name: /new store/i }).click();

  // StoreForm has 4 required fields; Name empty, others pre-filled with defaults.
  await authedPage.getByLabel(/^name$/i).fill(name);
  await authedPage.getByRole("button", { name: /create store/i }).click();

  // Back on list; name appears.
  await expect(authedPage.getByText(name)).toBeVisible();

  // Delete (rename is intentionally NOT smoke-tested — the rename round-trip
  // depends on revalidatePath behavior in updateStore that's flaky to assert
  // synchronously. Cover rename in a per-surface test once Phase 4 polishes
  // location detail.)
  await authedPage.getByText(name).click();
  await authedPage.getByRole("button", { name: /delete store/i }).click();
  await expect(authedPage).toHaveURL(/\/app\/stores$/);
  await expect(authedPage.getByText(name)).not.toBeVisible();
});
