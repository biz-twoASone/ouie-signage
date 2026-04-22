import { test, expect } from "./fixtures";

// These redirects are added in Phase 2 (Task 2.1). Before Phase 2, these tests
// will fail because the source paths are still serving content, not redirecting.
// Skip them for now; un-skip in Phase 2.
const EXPECTED_REDIRECTS = [
  { from: "/app/devices", to: "/app/screens" },
  { from: "/app/devices/pair", to: "/app/screens/add" },
  { from: "/app/stores", to: "/app/locations" },
  { from: "/app/device-groups", to: "/app/screen-groups" },
];

test.describe("route rename redirects", () => {
  for (const { from, to } of EXPECTED_REDIRECTS) {
    test(`${from} → ${to}`, async ({ authedPage }) => {
      const resp = await authedPage.goto(from);
      expect(resp?.status()).toBe(200); // followed the 308 to destination
      expect(authedPage.url()).toContain(to);
    });
  }
});
