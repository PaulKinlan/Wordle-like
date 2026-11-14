import type { Mark } from '../shared/game';
import type { SavedGame } from './storage';

const APP_NAME = 'Letterly';

const SQUARES: Record<'normal' | 'contrast', Record<Mark, string>> = {
  normal: { correct: '🟩', present: '🟨', absent: '⬛' },
  contrast: { correct: '🟧', present: '🟦', absent: '⬛' },
};

function title(game: SavedGame) {
  const score = game.status === 'won' ? String(game.rows.length) : 'X';
  const which = game.mode === 'daily' ? `#${game.number ?? '?'}` : 'Unlimited';
  const lang = game.lang && game.lang !== 'en' ? ` ${game.lang.toUpperCase()}` : '';
  return `${APP_NAME}${lang} ${which} ${score}/${game.maxGuesses}${game.hard ? ' (hard)' : ''}`;
}

/** "🔥 5 day streak" for daily games with a streak of 2 or more. */
export function streakLine(game: SavedGame, streak: number) {
  if (game.mode !== 'daily' || streak < 2) return '';
  return `🔥 ${streak} day streak`;
}

/**
 * The result as text for sharing: which puzzle, the score, the streak and the
 * colour grid. No letters, so it never spoils the word.
 */
export function shareText(game: SavedGame, highContrast: boolean, url: string, streak = 0): string {
  const squares = SQUARES[highContrast ? 'contrast' : 'normal'];
  const grid = game.rows.map((r) => r.marks.map((m) => squares[m]).join('')).join('\n');
  const fire = streakLine(game, streak);
  return `${title(game)}${fire ? `\n${fire}` : ''}\n\n${grid}\n\n${url}`;
}

const COLOURS = {
  normal: { correct: '#2f9e74', present: '#d9a21b', absent: '#7d828c' },
  contrast: { correct: '#f5793a', present: '#6fb2f2', absent: '#7d828c' },
};

/**
 * A share card image: title, score, streak and the colour grid, drawn on a
 * canvas on the device. Returns null if the browser can't make one.
 */
export async function shareCard(game: SavedGame, highContrast: boolean, host: string, streak = 0): Promise<Blob | null> {
  const W = 1080;
  const H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const font = (weight: number, size: number) =>
    `${weight} ${size}px ui-rounded, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;

  ctx.fillStyle = '#f6f6f3';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#17181b';
  ctx.textAlign = 'center';
  ctx.font = font(800, 76);
  ctx.fillText(APP_NAME, W / 2, 150);

  const score = game.status === 'won' ? `${game.rows.length}/${game.maxGuesses}` : `X/${game.maxGuesses}`;
  const which = game.mode === 'daily' ? `No. ${game.number ?? '?'}` : 'Unlimited';
  const extras = [game.lang !== 'en' ? game.lang.toUpperCase() : '', game.hard ? 'Hard' : ''].filter(Boolean).join(' · ');
  ctx.fillStyle = '#6b6f78';
  ctx.font = font(600, 40);
  ctx.fillText([which, score, extras].filter(Boolean).join('  ·  '), W / 2, 220);

  // The grid, centred in the space left.
  const colours = COLOURS[highContrast ? 'contrast' : 'normal'];
  const cols = game.wordLength;
  const rows = game.maxGuesses;
  const gap = 16;
  const tile = Math.min(110, (W - 240 - gap * (cols - 1)) / cols, (H - 470 - gap * (rows - 1)) / rows);
  const gridW = cols * tile + (cols - 1) * gap;
  const x0 = (W - gridW) / 2;
  const y0 = 280;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const mark = game.rows[r]?.marks[c];
      const x = x0 + c * (tile + gap);
      const y = y0 + r * (tile + gap);
      ctx.beginPath();
      ctx.roundRect(x, y, tile, tile, 18);
      if (mark) {
        ctx.fillStyle = colours[mark];
        ctx.fill();
      } else {
        ctx.strokeStyle = '#dcdde0';
        ctx.lineWidth = 5;
        ctx.stroke();
      }
    }
  }

  const fire = streakLine(game, streak);
  ctx.textAlign = 'center';
  if (fire) {
    ctx.fillStyle = '#17181b';
    ctx.font = font(700, 44);
    ctx.fillText(fire, W / 2, H - 110);
  }
  ctx.fillStyle = '#6b6f78';
  ctx.font = font(500, 32);
  ctx.fillText(host, W / 2, H - 52);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}
