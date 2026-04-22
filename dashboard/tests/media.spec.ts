import { test, expect } from "./fixtures";
import path from "node:path";

// Smokes the R2 two-phase upload: request signed URL → PUT to R2 → finalize row.
// Uses a 1x1 PNG (67 bytes) instead of a video — accepted per Edge Function's
// kindFromMime (image/png is allowed). Covers the same code paths as an mp4
// upload without needing ffmpeg installed on the test runner.
test("upload media file and delete it", async ({ authedPage }) => {
  await authedPage.goto("/app/media");

  // MediaUploader has a file input (hidden behind a Button). Wait for it.
  const fileInput = authedPage.locator("input[type='file']");
  await fileInput.setInputFiles(path.join(__dirname, "fixtures/tiny.png"));

  // After selecting a file, the uploader runs the two-phase flow automatically
  // (no additional confirm button — see media-uploader.tsx).
  // Wait for the filename to appear in the list.
  await expect(authedPage.getByText("tiny.png")).toBeVisible({ timeout: 30_000 });
  // upload_state should transition to "uploaded".
  await expect(authedPage.getByText(/uploaded/i).first()).toBeVisible({ timeout: 30_000 });

  // Delete the row.
  const row = authedPage.locator("li", { hasText: "tiny.png" });
  await row.getByRole("button", { name: /delete/i }).click();

  await expect(authedPage.getByText("tiny.png")).not.toBeVisible();
});
