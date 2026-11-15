import type { Mark } from '../shared/game';
import type { SavedGame } from './storage';

const APP_NAME = 'Letterle';

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

const DIGIT: Record<Mark, string> = { absent: '0', present: '1', correct: '2' };

/**
 * A link to this result: /s/en/d123/01200-22222. It opens the game, and chat
 * apps show a preview image of the score and colours (worker/og.ts). No letters.
 */
export function resultUrl(game: SavedGame, origin: string): string {
  const which = game.mode === 'daily' && game.number !== undefined ? `d${game.number}` : 'u';
  const grid = game.rows.map((r) => r.marks.map((m) => DIGIT[m]).join('')).join('-');
  return `${origin}/s/${game.lang}/${which}${game.hard ? 'h' : ''}/${grid}`;
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
  return (await htmlCard(game, highContrast, labels, streak)) ?? drawnCard(game, highContrast, labels, streak);
}

const W = 1080;
const H = 1350;

/** The tile size and gap of the card's grid: the same sum for both versions. */
function gridTile(cols: number, rows: number, gap: number, height: number) {
  return Math.min(96, (W - 300 - gap * (cols - 1)) / cols, (height - gap * (rows - 1)) / rows);
}

type HtmlCanvasContext = CanvasRenderingContext2D & {
  drawElementImage(el: Element, x: number, y: number): void;
};

/**
 * The card as HTML, drawn into the canvas by the browser (HTML-in-canvas):
 * the app's own fonts, any script, translated text that wraps by itself, and
 * the same tile shape as the board. Null where that isn't supported or it
 * doesn't draw in time; the hand-drawn version is used then.
 */
async function htmlCard(game: SavedGame, highContrast: boolean, labels: CardLabels, streak: number): Promise<Blob | null> {
  if (typeof CanvasRenderingContext2D === 'undefined' || !('drawElementImage' in CanvasRenderingContext2D.prototype)) {
    return null;
  }
  const el = (tag: string, cls: string, text = '') => {
    const e = document.createElement(tag);
    e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const won = game.status === 'won';
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.className = 'share-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  // The attribute was renamed during the trial; set both.
  canvas.setAttribute('layoutsubtree', '');
  canvas.setAttribute('content', 'drawable');

  const card = el('div', 'share-card' + (highContrast ? ' contrast' : ''));
  card.setAttribute('drawable', '');
  const which = game.mode === 'daily' ? `No. ${game.number ?? '?'}` : 'Unlimited';
  const extras = [game.lang !== 'en' ? game.lang.toUpperCase() : '', game.hard ? 'Hard' : ''].filter(Boolean);
  const grid = el('div', 'share-grid');
  const gap = 14;
  grid.style.setProperty('--cols', String(game.wordLength));
  grid.style.setProperty('--tile', `${gridTile(game.wordLength, game.maxGuesses, gap, H - 250 - 480)}px`);
  for (let r = 0; r < game.maxGuesses; r++) {
    for (let c = 0; c < game.wordLength; c++) {
      grid.append(el('i', game.rows[r]?.marks[c] ?? ''));
    }
  }
  card.append(
    el('div', 'share-name', APP_NAME),
    el('div', 'share-which', [which, ...extras].join('  ·  ')),
    el('div', 'share-score' + (won ? ' won' : ''), `${won ? game.rows.length : 'X'}/${game.maxGuesses}`),
    el('div', 'share-said', won ? labels.won : labels.lost),
    grid,
    el('div', 'share-streak', streakLine(game, streak)),
    el('div', 'share-play', labels.play),
  );
  canvas.append(card);
  document.body.append(canvas);

  try {
    const ctx = canvas.getContext('2d') as HtmlCanvasContext | null;
    if (!ctx) return null;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no paint')), 1000);
      // The first paint can come before the card's first snapshot: then wait for the next.
      canvas.addEventListener('paint', () => {
        try {
          ctx.clearRect(0, 0, W, H);
          ctx.drawElementImage(card, 0, 0);
          clearTimeout(timer);
          resolve();
        } catch {
          (canvas as HTMLCanvasElement & { requestPaint?: () => void }).requestPaint?.();
        }
      });
      (canvas as HTMLCanvasElement & { requestPaint?: () => void }).requestPaint?.();
    });
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  } finally {
    canvas.remove();
  }
}

/** The card drawn by hand on a plain canvas: everywhere else. */
async function drawnCard(game: SavedGame, highContrast: boolean, labels: CardLabels, streak: number): Promise<Blob | null> {
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
  const tile = gridTile(cols, rows, gap, bottom - top);
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
