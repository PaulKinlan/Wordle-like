import type { Mark } from '../shared/game';
import type { SavedGame } from './storage';

const APP_NAME = 'Letterly';

const SQUARES: Record<'normal' | 'contrast', Record<Mark, string>> = {
  normal: { correct: '🟩', present: '🟨', absent: '⬛' },
  contrast: { correct: '🟧', present: '🟦', absent: '⬛' },
};

/**
 * The result as text for sharing: which puzzle, the score, and the colour
 * grid. No letters, so it never spoils the word.
 */
export function shareText(game: SavedGame, highContrast: boolean, url: string): string {
  const squares = SQUARES[highContrast ? 'contrast' : 'normal'];
  const score = game.status === 'won' ? String(game.rows.length) : 'X';
  const which = game.mode === 'daily' ? `#${game.number ?? '?'}` : 'Unlimited';
  const lang = game.lang && game.lang !== 'en' ? ` ${game.lang.toUpperCase()}` : '';
  const title = `${APP_NAME}${lang} ${which} ${score}/${game.maxGuesses}${game.hard ? ' (hard)' : ''}`;
  const grid = game.rows.map((r) => r.marks.map((m) => squares[m]).join('')).join('\n');
  return `${title}\n\n${grid}\n\n${url}`;
}
