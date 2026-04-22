// supabase/functions/_shared/schedule.ts
// Half-open [start_time, end_time) semantics. Overnight windows allowed:
// if end_time <= start_time, the window is interpreted as "starts on day D at
// start_time, ends on day D+1 at end_time".

type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: 1=Mon..7=Sun

function dayFromWeekday(weekday: string): DayOfWeek {
  const map: Record<string, DayOfWeek> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return map[weekday];
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Return the day-of-week (ISO) and minutes-since-midnight for `at` in `timeZone`.
 */
function localDateParts(at: Date, timeZone: string): { day: DayOfWeek; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const day = dayFromWeekday(p.weekday);
  // `2-digit` hour in en-US with hour12:false can return "24" at midnight; normalize.
  const hh = Number(p.hour) % 24;
  const mm = Number(p.minute);
  return { day, minutes: hh * 60 + mm };
}

function prevDay(d: DayOfWeek): DayOfWeek {
  return (d === 1 ? 7 : d - 1) as DayOfWeek;
}

/**
 * Does `at` fall within any rule matching (days_of_week, start_time, end_time) in `timeZone`?
 * Rule encoding:
 *   - `start_time < end_time`: simple same-day window. Match iff day∈days AND start ≤ t < end.
 *   - `start_time >= end_time`: overnight window. The rule's "day" is the day the window STARTS.
 *     Match iff (day∈days AND t ≥ start) OR (day-1 ∈ days AND t < end).
 */
export function isInWindow(
  at: Date,
  timeZone: string,
  daysOfWeek: number[],
  startTime: string,
  endTime: string,
): boolean {
  const { day, minutes } = localDateParts(at, timeZone);
  const start = hmToMinutes(startTime);
  const end = hmToMinutes(endTime);
  const days = new Set(daysOfWeek);

  if (start < end) {
    return days.has(day) && minutes >= start && minutes < end;
  }
  // Overnight: starts today at `start`, ends tomorrow at `end`.
  const earlyMorningOfTomorrow = days.has(prevDay(day)) && minutes < end;
  const lateNightOfToday = days.has(day) && minutes >= start;
  return earlyMorningOfTomorrow || lateNightOfToday;
}
