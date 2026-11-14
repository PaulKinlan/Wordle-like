// Puzzle ids. The server keeps no game state; the id says which answer.
//
//   d:YYYY-MM-DD   the daily puzzle for that (player-local) date
//   r:<16 hex>     an unlimited-play puzzle; the token is random
//   dh:… / rh:…    the same in hard mode: a rarely used word, and every
//                  revealed hint must be reused
import { dailyNumber } from '../shared/daily';

export { dailyNumber };

const DAY_MS = 86_400_000;

export type PuzzleRef = (
  | { kind: 'daily'; date: string; number: number }
  | { kind: 'random'; token: string }
) & { hard: boolean };

export function parsePuzzleId(id: unknown, now = Date.now()): PuzzleRef | null {
  if (typeof id !== 'string') return null;
  let match = /^d(h?):(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (match) {
    const hard = match[1] === 'h';
    const date = match[2];
    const number = dailyNumber(date);
    if (number === null || number < 1) return null;
    // Players are up to 14h ahead of UTC; don't serve puzzles beyond that.
    if (Date.parse(date + 'T00:00:00Z') > now + DAY_MS) return null;
    return { kind: 'daily', date, number, hard };
  }
  match = /^r(h?):([0-9a-f]{16})$/.exec(id);
  if (match) return { kind: 'random', token: match[2], hard: match[1] === 'h' };
  return null;
}

export function newRandomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Position of a puzzle's answer in the private order of `count` answers. */
export function answerIndex(ref: PuzzleRef, count: number): number {
  if (ref.kind === 'daily') return (ref.number - 1) % count;
  return Number(BigInt('0x' + ref.token) % BigInt(count));
}
