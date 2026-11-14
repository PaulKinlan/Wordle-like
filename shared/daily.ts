// Daily puzzle numbering, shared so the client can work out today's puzzle
// from the player's local date without a round trip.

export const DAILY_EPOCH = '2026-11-14'; // Puzzle #1

const DAY_MS = 86_400_000;

/** 1-based puzzle number for a YYYY-MM-DD date, or null if it isn't a real date. */
export function dailyNumber(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = Date.parse(date + 'T00:00:00Z');
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date) return null;
  return Math.round((t - Date.parse(DAILY_EPOCH + 'T00:00:00Z')) / DAY_MS) + 1;
}

/** The player's local date as YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
