// Puzzle ids. The server keeps no game state; the id says which answer.
//
//   d:YYYY-MM-DD   the daily puzzle for that (player-local) date
//   r:<16 hex>     an unlimited-play puzzle; the token is random, and which
//                  answer it means is worked out with a key only the server
//                  has (see randomIndex), so a token can't be chosen to read
//                  a coming daily word
//   dh:… / rh:…    the same in hard mode: a rarely used word, and every
//                  revealed hint must be reused
import { dailyNumber } from '../shared/daily';

export { dailyNumber };

/**
 * How far ahead of UTC a player's local date can be: the furthest time zone
 * is UTC+14. A little slack for clocks that run fast.
 */
const AHEAD_MS = 14 * 3_600_000 + 5 * 60_000;

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
    // Don't serve a day that hasn't started anywhere yet.
    if (Date.parse(date + 'T00:00:00Z') > now + AHEAD_MS) return null;
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

/** Position of a daily puzzle's answer in the private order of `count` answers. */
export function dailyIndex(number: number, count: number): number {
  return (number - 1) % count;
}

const keys = new Map<string, Promise<CryptoKey>>();

/**
 * Position of an unlimited puzzle's answer: HMAC(key, set + token) mod count.
 * The daily puzzles walk the same private order one row a day, so the row a
 * token lands on must not be something a player can work out or pick; with the
 * key it's fixed for a token, without it it's as good as random.
 */
export async function randomIndex(key: string, set: string, token: string, count: number): Promise<number> {
  let k = keys.get(key);
  if (!k) {
    k = crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keys.set(key, k);
  }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await k, new TextEncoder().encode(`${set}|${token}`)));
  // 48 bits: plenty for an even spread, and exact in a JavaScript number.
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + mac[i];
  return n % count;
}

/** Position of a puzzle's answer in the private order of `count` answers. */
export function answerIndex(ref: PuzzleRef, count: number, key: string, set: string): Promise<number> | number {
  if (ref.kind === 'daily') return dailyIndex(ref.number, count);
  return randomIndex(key, set, ref.token, count);
}
