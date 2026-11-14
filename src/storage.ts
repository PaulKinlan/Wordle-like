// Everything the game remembers lives in localStorage on this device.
import type { GameStatus, Mark } from '../shared/game';

export type Mode = 'daily' | 'unlimited';

export interface Settings {
  hard: boolean;
  highContrast: boolean;
  lang: string | null; // null = pick automatically
  mode: Mode;
}

export interface Row {
  guess: string;
  marks: Mark[];
}

export interface SavedGame {
  puzzle: string;
  lang: string;
  mode: Mode;
  number?: number;
  date?: string;
  wordLength: number;
  maxGuesses: number;
  hard: boolean;
  rows: Row[];
  status: GameStatus;
  answer?: string;
}

export interface Stats {
  played: number;
  wins: number;
  streak: number;
  maxStreak: number;
  /** Wins by number of guesses: dist[0] = won in 1. */
  dist: number[];
  /** Daily puzzle number of the last finished game, for streaks. */
  lastNumber?: number;
}

const PREFIX = 'letterly:v1:';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the game still works, it just won't remember.
  }
}

export const loadSettings = () =>
  read<Settings>('settings', { hard: false, highContrast: false, lang: null, mode: 'daily' });
export const saveSettings = (s: Settings) => write('settings', s);

// Hard mode is its own puzzle (a rarer word), so it keeps its own game and stats.
const variant = (mode: Mode, hard: boolean) => (hard ? `${mode}-hard` : mode);

export const loadGame = (lang: string, mode: Mode, hard: boolean) =>
  read<SavedGame | null>(`game:${lang}:${variant(mode, hard)}`, null);
export const saveGame = (g: SavedGame) => write(`game:${g.lang}:${variant(g.mode, g.hard)}`, g);

const emptyStats = (n: number): Stats => ({ played: 0, wins: 0, streak: 0, maxStreak: 0, dist: Array(n).fill(0) });

export const loadStats = (lang: string, mode: Mode, hard: boolean, maxGuesses: number) =>
  read<Stats>(`stats:${lang}:${variant(mode, hard)}`, emptyStats(maxGuesses));

/** Records a finished game once and returns the updated stats. */
export function recordResult(game: SavedGame): Stats {
  const s = loadStats(game.lang, game.mode, game.hard, game.maxGuesses);
  const won = game.status === 'won';
  s.played++;
  if (won) {
    s.wins++;
    s.dist[game.rows.length - 1] = (s.dist[game.rows.length - 1] ?? 0) + 1;
    // Daily streaks need consecutive days; unlimited streaks are consecutive wins.
    const continues = game.mode === 'unlimited' || (game.number !== undefined && s.lastNumber === game.number - 1);
    s.streak = continues ? s.streak + 1 : 1;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
  } else {
    s.streak = 0;
  }
  if (game.number !== undefined) s.lastNumber = game.number;
  write(`stats:${game.lang}:${variant(game.mode, game.hard)}`, s);
  return s;
}

/** A daily streak is broken if yesterday's puzzle was never finished. */
export function currentStreak(s: Stats, mode: Mode, todayNumber?: number): number {
  if (mode === 'daily' && todayNumber !== undefined && s.lastNumber !== undefined) {
    if (s.lastNumber < todayNumber - 1) return 0;
  }
  return s.streak;
}
