// supabase/functions/tests/schedule.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isInWindow } from "../_shared/schedule.ts";

Deno.test("isInWindow: simple daytime window matches", () => {
  // Monday 2026-04-27 10:30 UTC = 17:30 Asia/Jakarta.
  const at = new Date("2026-04-27T10:30:00Z");
  const match = isInWindow(at, "Asia/Jakarta", [1, 2, 3, 4, 5], "09:00", "18:00");
  assertEquals(match, true);
});

Deno.test("isInWindow: outside window returns false", () => {
  // Monday 17:30 Asia/Jakarta. Window 09:00-12:00 → outside.
  const at = new Date("2026-04-27T10:30:00Z");
  const match = isInWindow(at, "Asia/Jakarta", [1, 2, 3, 4, 5], "09:00", "12:00");
  assertEquals(match, false);
});

Deno.test("isInWindow: wrong day of week returns false", () => {
  // 2026-04-27 is Monday (1). Window is Sat+Sun only.
  const at = new Date("2026-04-27T10:30:00Z");
  const match = isInWindow(at, "Asia/Jakarta", [6, 7], "00:00", "23:59");
  assertEquals(match, false);
});

Deno.test("isInWindow: overnight window (22:00-02:00) matches after midnight", () => {
  // Tuesday 2026-04-28 18:30 UTC = 01:30 Wednesday Asia/Jakarta.
  // Rule: on Wednesday (3), window 22:00..02:00. 01:30 is in the 22:00..02:00 span
  // attributed to Tuesday (day 2). So we check: (day=2 AND time>=22:00) OR (day=3 AND time<=02:00).
  const at = new Date("2026-04-28T18:30:00Z");
  // Day in Jakarta is Wed (3). Rule says days=[2] (Tuesday) means "Tuesday nights".
  const match = isInWindow(at, "Asia/Jakarta", [2], "22:00", "02:00");
  assertEquals(match, true, "01:30 Wed in Jakarta is inside Tue-night window that spans into Wed");
});

Deno.test("isInWindow: overnight window — early evening same day matches", () => {
  // Tuesday 2026-04-28 15:00 UTC = 22:00 Tuesday Asia/Jakarta.
  // Rule: Tuesday (2), 22:00..02:00. 22:00 Tuesday is the start of the window → match.
  const at = new Date("2026-04-28T15:00:00Z");
  const match = isInWindow(at, "Asia/Jakarta", [2], "22:00", "02:00");
  assertEquals(match, true);
});

Deno.test("isInWindow: overnight window rejects afternoon", () => {
  // Tuesday 2026-04-28 09:00 UTC = 16:00 Tuesday Asia/Jakarta.
  // Rule: Tuesday (2), 22:00..02:00. 16:00 is NOT in 22:00..02:00.
  const at = new Date("2026-04-28T09:00:00Z");
  const match = isInWindow(at, "Asia/Jakarta", [2], "22:00", "02:00");
  assertEquals(match, false);
});

Deno.test("isInWindow: boundary — exactly at start_time", () => {
  // Monday 09:00 Jakarta. Window 09:00-18:00, day 1.
  const at = new Date("2026-04-27T02:00:00Z"); // 09:00 Jakarta
  const match = isInWindow(at, "Asia/Jakarta", [1], "09:00", "18:00");
  assertEquals(match, true, "start_time is inclusive");
});

Deno.test("isInWindow: boundary — exactly at end_time is NOT in window", () => {
  // Monday 18:00 Jakarta. Window 09:00-18:00.
  const at = new Date("2026-04-27T11:00:00Z"); // 18:00 Jakarta
  const match = isInWindow(at, "Asia/Jakarta", [1], "09:00", "18:00");
  assertEquals(match, false, "end_time is exclusive (windows are half-open [start, end))");
});
