// Turns a puzzle id into an answer without storing any state.
//
//   d:YYYY-MM-DD  the daily puzzle for that (player-local) date
//   r:<hex>       an unlimited-play puzzle; the token is random
//
// Both are mixed with PUZZLE_SECRET so the answer can't be worked out from
// the id or the public word list.

import { dailyNumber } from '../shared/daily';

export { dailyNumber };

const DAY_MS = 86_400_000;

export type PuzzleRef =
  | { kind: 'daily'; date: string; number: number }
  | { kind: 'random'; token: string };

export function parsePuzzleId(id: unknown, now = Date.now()): PuzzleRef | null {
  if (typeof id !== 'string') return null;
  let match = /^d:(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (match) {
    const date = match[1];
    const number = dailyNumber(date);
    if (number === null || number < 1) return null;
    // Players are up to 14h ahead of UTC; don't serve puzzles beyond that.
    if (Date.parse(date + 'T00:00:00Z') > now + DAY_MS) return null;
    return { kind: 'daily', date, number };
  }
  match = /^r:([0-9a-f]{16})$/.exec(id);
  if (match) return { kind: 'random', token: match[1] };
  return null;
}

export function newRandomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hash32(input: string): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return new DataView(digest).getUint32(0);
}

// mulberry32: tiny deterministic PRNG for the daily shuffle.
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const orderCache = new Map<string, number[]>();

async function dailyOrder(lang: string, count: number, secret: string): Promise<number[]> {
  const key = `${lang}:${count}`;
  const hit = orderCache.get(key);
  if (hit) return hit;
  const rand = prng(await hash32(`${secret}:daily:${lang}`));
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  orderCache.set(key, order);
  return order;
}

export async function answerFor(
  ref: PuzzleRef,
  lang: string,
  answers: readonly string[],
  secret: string,
): Promise<string> {
  if (ref.kind === 'daily') {
    const order = await dailyOrder(lang, answers.length, secret);
    return answers[order[(ref.number - 1) % order.length]];
  }
  return answers[(await hash32(`${secret}:random:${lang}:${ref.token}`)) % answers.length];
}
