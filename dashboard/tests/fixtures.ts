import { test as base, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

type AuthFixture = {
  authedPage: import("@playwright/test").Page;
};

const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "e2e+tester@ouie.app";

export const test = base.extend<AuthFixture>({
  authedPage: async ({ page }, use) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      throw new Error(
        "E2E fixture needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
      );
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Generate a magic-link; admin.generateLink returns an `action_link` URL
    // that points at the Supabase GoTrue service with a one-shot code. Visiting
    // it redirects through our /auth/callback route (which exchanges the code
    // for a session via `exchangeCodeForSession`) and lands us at /app.
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: TEST_EMAIL,
    });
    if (error) throw error;

    await page.goto(data.properties.action_link);
    await page.waitForURL("**/app**");

    await use(page);
  },
});

export { expect };
