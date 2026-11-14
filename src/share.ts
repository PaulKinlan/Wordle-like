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

export interface CardLabels {
  /** Under the score when the word was found, like "Got it!". */
  won: string;
  /** Under the score when it wasn't. */
  lost: string;
  /** The invitation at the bottom, with the site's host in it. */
  play: string;
}

/**
 * A share card image (1080×1350, portrait so it fills a phone screen): the
 * score in big type, the colour grid with no letters, the streak, and an
 * invitation to play with the site's address. Drawn on the device. Returns
 * null if the browser can't make one.
 */
export async function shareCard(
  game: SavedGame,
  highContrast: boolean,
  labels: CardLabels,
  streak = 0,
): Promise<Blob | null> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const font = (weight: number, size: number) =>
    `${weight} ${size}px ui-rounded, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  const colours = COLOURS[highContrast ? 'contrast' : 'normal'];
  const won = game.status === 'won';

  ctx.fillStyle = '#f6f6f3';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Name and which puzzle.
  ctx.fillStyle = '#17181b';
  ctx.font = font(800, 64);
  ctx.fillText(APP_NAME, W / 2, 120);
  const which = game.mode === 'daily' ? `No. ${game.number ?? '?'}` : 'Unlimited';
  const extras = [game.lang !== 'en' ? game.lang.toUpperCase() : '', game.hard ? 'Hard' : ''].filter(Boolean);
  ctx.fillStyle = '#6b6f78';
  ctx.font = font(600, 36);
  ctx.fillText([which, ...extras].join('  ·  '), W / 2, 178);

  // The score, big: how many goes it took.
  ctx.fillStyle = won ? colours.correct : '#17181b';
  ctx.font = font(800, 170);
  ctx.fillText(`${won ? game.rows.length : 'X'}/${game.maxGuesses}`, W / 2, 360);
  ctx.fillStyle = '#17181b';
  ctx.font = font(700, 44);
  ctx.fillText(won ? labels.won : labels.lost, W / 2, 430);

  // The grid.
  const cols = game.wordLength;
  const rows = game.maxGuesses;
  const gap = 14;
  const top = 480;
  const bottom = H - 250;
  const tile = Math.min(96, (W - 300 - gap * (cols - 1)) / cols, (bottom - top - gap * (rows - 1)) / rows);
  const gridW = cols * tile + (cols - 1) * gap;
  const gridH = rows * tile + (rows - 1) * gap;
  const x0 = (W - gridW) / 2;
  const y0 = top + (bottom - top - gridH) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const mark = game.rows[r]?.marks[c];
      const x = x0 + c * (tile + gap);
      const y = y0 + r * (tile + gap);
      ctx.beginPath();
      ctx.roundRect(x, y, tile, tile, 16);
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
  if (fire) {
    ctx.fillStyle = '#17181b';
    ctx.font = font(700, 40);
    ctx.fillText(fire, W / 2, H - 190);
  }

  // The invitation, on a pill, so it reads as something to do.
  ctx.font = font(700, labels.play.length > 40 ? 32 : 38);
  const pillW = Math.min(W - 120, ctx.measureText(labels.play).width + 96);
  const pillH = 88;
  const pillY = H - 140;
  ctx.beginPath();
  ctx.roundRect((W - pillW) / 2, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = '#17181b';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(labels.play, W / 2, pillY + pillH / 2, pillW - 64);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}
