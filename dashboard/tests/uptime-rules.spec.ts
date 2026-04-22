import { test, expect } from "./fixtures";

test("add and remove an uptime rule on a screen", async ({ authedPage }) => {
  // Smoke assumes at least one paired screen exists. If the test tenant is empty,
  // this test is a no-op — treat as conditional skip.
  await authedPage.goto("/app/screens");
  const firstRow = authedPage.locator('[data-testid^="screens-row-"]').first();
  const hasRow = await firstRow.count();
  test.skip(hasRow === 0, "no paired screen in test tenant");

  await firstRow.click();
  await expect(authedPage.getByTestId("uptime-rules-section")).toBeVisible();

  // Default form values are Mon-Fri 09:00-18:00; just submit.
  await authedPage.getByTestId("uptime-rule-add").click();
  // Rule rows render as <li> — scoping to li excludes the always-present add button.
  await expect(authedPage.locator('li[data-testid^="uptime-rule-"]').first()).toBeVisible({ timeout: 5000 });

  // Remove the rule just created.
  const rule = authedPage.locator('[data-testid^="uptime-rule-"][data-testid$="-delete"]').first();
  await rule.click();
});
