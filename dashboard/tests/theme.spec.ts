import { test, expect } from "./fixtures";

test.describe("theme toggle", () => {
  test("user can toggle dark/light via theme button in topbar", async ({ authedPage }) => {
    await authedPage.goto("/app");
    await authedPage.getByTestId("theme-toggle").click();
    await authedPage.getByRole("menuitem", { name: /dark/i }).click();
    await expect(authedPage.locator("html")).toHaveClass(/dark/);

    // Wait for the dropdown to fully close before re-opening, otherwise the
    // second click can race with the Radix dismiss-on-blur handler.
    await expect(authedPage.getByRole("menuitem", { name: /dark/i })).toHaveCount(0);

    await authedPage.getByTestId("theme-toggle").click();
    await authedPage.getByRole("menuitem", { name: /light/i }).click();
    await expect(authedPage.locator("html")).not.toHaveClass(/dark/);
  });
});
