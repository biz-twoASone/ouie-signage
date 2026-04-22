import { test, expect } from "./fixtures";

// Smoke: create a playlist, verify it lands in the list.
// NOTE: assigning a playlist to a screen requires a seeded paired device.
// Deferred to an integration test that pairs via the pairing-request Edge
// Function as a fixture step; smoke-guard today covers the dashboard-only path.
test("create a playlist", async ({ authedPage }) => {
  const plName = `E2E Playlist ${Date.now()}`;
  await authedPage.goto("/app/playlists");

  await authedPage.getByPlaceholder(/new playlist name/i).fill(plName);
  await authedPage.getByRole("button", { name: /^create$/i }).click();

  // createPlaylist server action redirects to /app/playlists/{id}.
  await expect(authedPage).toHaveURL(/\/app\/playlists\/[a-f0-9-]{36}/);

  // Go back to list to confirm it landed.
  await authedPage.goto("/app/playlists");
  await expect(authedPage.getByRole("link", { name: plName })).toBeVisible();
});
