import type { GameStatus, HardModeViolation } from '../shared/game';
import type { LanguageInfo } from '../shared/languages';
import type { Row } from './storage';

export interface PuzzleInfo {
  puzzle: string;
  lang: string;
  wordLength: number;
  maxGuesses: number;
  number?: number;
  date?: string;
}

export interface PlayResult {
  rows: Row[];
  status: GameStatus;
  answer?: string;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public violation?: HardModeViolation,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/v1/' + path, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch {
    throw new ApiError('offline', "You're offline. Reconnect to keep playing.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? 'error', body.message ?? 'Something went wrong', body.violation);
  return body as T;
}

export const api = {
  languages: () => call<{ languages: LanguageInfo[] }>('languages').then((r) => r.languages),
  daily: (lang: string, date: string, hard: boolean) =>
    call<PuzzleInfo>(`${lang}/daily?date=${encodeURIComponent(date)}${hard ? '&hard=1' : ''}`),
  random: (lang: string, hard: boolean) => call<PuzzleInfo>(`${lang}/random${hard ? '?hard=1' : ''}`, { method: 'POST' }),
  words: (lang: string) => call<string[]>(`${lang}/words`),
  play: (lang: string, puzzle: string, guesses: string[]) =>
    call<PlayResult>(`${lang}/play`, { method: 'POST', body: JSON.stringify({ puzzle, guesses }) }),
};
