import { test, expect } from "./fixtures";

test.describe.skip("theme toggle (un-skip in Phase 6)", () => {
  test("user can toggle dark/light via user menu", async ({ authedPage }) => {
    await authedPage.goto("/app");
    await authedPage.getByTestId("user-menu-trigger").click();
    await authedPage.getByRole("menuitem", { name: /dark/i }).click();
    await expect(authedPage.locator("html")).toHaveClass(/dark/);
    await authedPage.getByTestId("user-menu-trigger").click();
    await authedPage.getByRole("menuitem", { name: /light/i }).click();
    await expect(authedPage.locator("html")).not.toHaveClass(/dark/);
  });
});
