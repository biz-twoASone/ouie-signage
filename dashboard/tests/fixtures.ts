import { test as base, expect } from "@playwright/test";

type AuthFixture = {
  authedPage: import("@playwright/test").Page;
};

// Authentication happens once in global-setup.ts and is persisted to
// playwright/.auth/user.json. Each test inherits that storageState
// automatically (see playwright.config.ts `use.storageState`), so `authedPage`
// is just the normal page — no per-test sign-in round-trip.
//
// The unauthenticated tests explicitly use the base `page` fixture with
// `test.use({ storageState: { cookies: [], origins: [] } })` to opt out.
export const test = base.extend<AuthFixture>({
  authedPage: async ({ page }, use) => {
    await use(page);
  },
});

export { expect };
