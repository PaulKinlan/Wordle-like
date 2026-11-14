// Multiplayer race: the rules, shared by the room (worker/room.ts) and the
// client. Pure functions and plain data, so they're easy to test.
//
// Everyone in a room plays the same word. When a player finishes a row,
// everyone who hasn't finished that row yet gets ROW_SECONDS to finish
// theirs, or the row is lost (it counts as a blank row). The first player to
// find the word wins. If nobody does, the best single row wins on points:
// 2 for each green letter and 1 for each yellow.
import type { Mark } from './game';

export const ROW_SECONDS = 5;
export const MAX_PLAYERS = 4;
export const POINTS = { correct: 2, present: 1 } as const;

export type RaceStatus = 'lobby' | 'playing' | 'finished';

export interface RaceRow {
  /** null for a row lost to the clock. */
  guess: string | null;
  marks: Mark[];
  /** Server time the row was finished or lost. */
  at: number;
}

export interface Standing {
  id: string;
  name: string;
  solved: boolean;
  /** Points of the best row (2 per green, 1 per yellow). */
  points: number;
  greens: number;
  yellows: number;
  /** 1-based row that scored best, or 0 if every row was lost. */
  bestRow: number;
  rows: number;
}

/** Points for one row: 2 per green letter, 1 per yellow. */
export function rowPoints(marks: Mark[]) {
  let greens = 0;
  let yellows = 0;
  for (const m of marks) {
    if (m === 'correct') greens++;
    else if (m === 'present') yellows++;
  }
  return { points: greens * POINTS.correct + yellows * POINTS.present, greens, yellows };
}

/**
 * Final order. A player who found the word beats everyone who didn't, and
 * the first to find it wins. Everyone else is ranked by their best row's
 * points; on a tie, whoever reached that score first is ahead.
 */
export function rank(players: { id: string; name: string; rows: RaceRow[]; solvedAt?: number }[]): Standing[] {
  const scored = players.map((p) => {
    let best = { points: 0, greens: 0, yellows: 0, bestRow: 0, at: Infinity };
    p.rows.forEach((r, i) => {
      if (r.guess === null) return;
      const s = rowPoints(r.marks);
      if (s.points > best.points || best.bestRow === 0) best = { ...s, bestRow: i + 1, at: r.at };
    });
    return { p, best };
  });
  scored.sort((a, b) => {
    const sa = a.p.solvedAt ?? Infinity;
    const sb = b.p.solvedAt ?? Infinity;
    if (sa !== sb) return sa - sb;
    if (a.best.points !== b.best.points) return b.best.points - a.best.points;
    return a.best.at - b.best.at;
  });
  return scored.map(({ p, best }) => ({
    id: p.id,
    name: p.name,
    solved: p.solvedAt !== undefined,
    points: best.points,
    greens: best.greens,
    yellows: best.yellows,
    bestRow: best.bestRow,
    rows: p.rows.length,
  }));
}

// ---------------------------------------------------------------- messages

/** What a player sees about another player: colours only, never letters. */
export interface PublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  /** Playing this round (false for someone who joined mid-round). */
  inRound: boolean;
  rows: { marks: Mark[]; lost: boolean }[];
  solved: boolean;
  /** Server time this player's current row runs out, if a clock is running. */
  deadline?: number;
}

export interface RaceState {
  code: string;
  lang: string;
  hard: boolean;
  wordLength: number;
  maxGuesses: number;
  status: RaceStatus;
  round: number;
  hostId: string;
  players: PublicPlayer[];
  /** Your own rows, with letters. */
  mine: { guess: string | null; marks: Mark[] }[];
  result?: { answer: string; winnerId?: string; standings: Standing[] };
  /** Server clock, so the client can show deadlines correctly. */
  now: number;
}

export type ClientMessage =
  | { t: 'join'; name: string; token?: string }
  | { t: 'start' }
  | { t: 'guess'; word: string }
  /** Push me when someone joins (a PushSubscription's JSON, and the interface language for the text). */
  | { t: 'notify'; sub: { endpoint: string; keys: { p256dh: string; auth: string } }; ui: string }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'welcome'; you: string; token: string }
  | { t: 'state'; state: RaceState }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' };

/** Room codes: no 0/O or 1/I/L, so they're easy to read out. */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export function cleanName(name: unknown): string {
  const s = typeof name === 'string' ? name.normalize('NFC').replace(/[\p{C}<>]/gu, '').trim() : '';
  return [...s].slice(0, 20).join('') || 'Player';
}
