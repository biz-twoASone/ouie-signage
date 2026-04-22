import { chromium, type FullConfig, expect } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";

const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "e2e+tester@ouie.app";
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const AUTH_FILE = path.join(__dirname, "..", "playwright", ".auth", "user.json");

type MailpitMessage = {
  ID: string;
  To: Array<{ Address: string }>;
  Created: string;
};

async function fetchLatestMagicLink(
  email: string,
  timeoutMs = 30_000,
): Promise<{ id: string; magicLink: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | undefined;
  while (Date.now() < deadline) {
    try {
      const listRes = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=50`);
      if (listRes.ok) {
        const { messages } = (await listRes.json()) as { messages: MailpitMessage[] };
        const match = (messages ?? [])
          .filter((m) => m.To.some((to) => to.Address.toLowerCase() === email.toLowerCase()))
          .sort((a, b) => b.Created.localeCompare(a.Created))[0];
        if (match) {
          const detailRes = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
          if (detailRes.ok) {
            const msg = (await detailRes.json()) as { Text?: string; HTML?: string };
            const blob = `${msg.HTML ?? ""} ${msg.Text ?? ""}`;
            const linkMatch = blob.match(/https?:\/\/[^\s"<>()]+?\/auth\/v1\/verify[^\s"<>()]+/);
            if (linkMatch) {
              const magicLink = linkMatch[0]
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"');
              return { id: match.ID, magicLink };
            }
            lastError = "email body contained no /auth/v1/verify URL";
          }
        }
      } else {
        lastError = `mailpit list: ${listRes.status}`;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Timed out waiting for magic-link email for ${email} in Mailpit at ${MAILPIT_URL}. Last: ${lastError ?? "no matching email ever arrived"}`,
  );
}

export default async function globalSetup(_config: FullConfig) { // eslint-disable-line @typescript-eslint/no-unused-vars
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: "http://localhost:3000" });
  const page = await context.newPage();

  // Clear any stale emails first so we pick up only our freshly-sent one.
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" }).catch(() => {});

  await page.goto("/login");
  await page.getByLabel(/email/i).fill(TEST_EMAIL);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 15_000 });

  const { magicLink } = await fetchLatestMagicLink(TEST_EMAIL);
  await page.goto(magicLink);
  await page.waitForURL("**/app**", { timeout: 20_000 });

  // Persist cookies + localStorage for reuse by every test.
  await context.storageState({ path: AUTH_FILE });

  await browser.close();
}
