import { displayLetter, type Mark } from '../shared/game';
import { t as tr } from './i18n';
import type { Row } from './storage';
import { haptics } from './pwa';
import { letterHints } from './hints';

// Must match .board in styles.css: the gap between tiles and the largest tile.
const GAP = 6;
const MAX_TILE = 64;

/** Draws the grid of tiles. Rebuilt only when the puzzle shape changes. */
export class Board {
  private tiles: HTMLDivElement[][] = [];
  private rowEls: HTMLDivElement[] = [];

  private rows = 0;
  private cols = 0;
  /** The space the board may fill (its wrapper's size), once measured. */
  private space?: { width: number; height: number };

  constructor(
    private el: HTMLElement,
    /** The Enter button: sits just after the row being typed, shown once it's full. */
    private enter?: HTMLElement,
  ) {
    // The tile size in plain pixels. The stylesheet can work it out by itself
    // from container units, but then every tile depends on the wrapper's size
    // and changing one letter lays out the whole board again (about 15 times
    // slower on a phone). Measured here instead, whenever the space changes:
    // the keyboard opening, a rotation, a different number of rows.
    const wrap = el.parentElement;
    if (wrap && 'ResizeObserver' in window) {
      new ResizeObserver((entries) => {
        const { width, height } = entries[entries.length - 1].contentRect;
        // Hidden (the race lobby is showing): keep the last size.
        if (!width || !height) return;
        this.space = { width, height };
        this.fit();
      }).observe(wrap);
    }
  }

  /** Sets --tile-px: the same sum as --tile in styles.css. */
  private fit() {
    if (!this.space || !this.rows || !this.cols) return;
    const size = Math.min(
      MAX_TILE,
      (this.space.width - (this.cols - 1) * GAP) / this.cols,
      (this.space.height - (this.rows - 1) * GAP) / this.rows,
    );
    this.el.style.setProperty('--tile-px', `${Math.max(0, Math.floor(size * 100) / 100)}px`);
    // The Enter button goes in the space beside the row. When the tiles fill
    // the width (keyboard down, narrow phone) there's none, so it sits on the
    // last tile's corner instead.
    const side = (this.space.width - (this.cols * size + (this.cols - 1) * GAP)) / 2;
    this.el.classList.toggle('enter-tight', side < Math.min(size * 0.8, 48) + GAP);
  }

  build(rows: number, cols: number) {
    if (this.enter) this.el.after(this.enter);
    this.el.replaceChildren();
    this.el.style.setProperty('--cols', String(cols));
    this.el.style.setProperty('--rows', String(rows));
    this.rows = rows;
    this.cols = cols;
    this.fit();
    this.tiles = [];
    this.rowEls = [];
    for (let r = 0; r < rows; r++) {
      const row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('role', 'row');
      const tiles: HTMLDivElement[] = [];
      for (let c = 0; c < cols; c++) {
        const t = document.createElement('div');
        t.className = 'tile';
        t.setAttribute('role', 'gridcell');
        row.append(t);
        tiles.push(t);
      }
      this.el.append(row);
      this.rowEls.push(row);
      this.tiles.push(tiles);
    }
  }

  /** Paints finished rows, the row being typed, and empty rows below. */
  render(rows: Row[], current: string, active: boolean) {
    const letters = [...current];
    const typing = active ? this.rowEls[rows.length] : undefined;
    if (this.enter) {
      if (typing && this.enter.parentElement !== typing) typing.append(this.enter);
      this.enter.classList.toggle('ready', !!typing && letters.length >= this.cols);
    }
    const known = letterHints(showHints ? rows : []);
    this.tiles.forEach((tiles, r) => {
      const done = rows[r];
      tiles.forEach((t, c) => {
        if (done) {
          setTile(t, [...done.guess][c], done.marks[c]);
        } else if (r === rows.length && active) {
          setTile(t, letters[c] ?? '', letters[c] ? 'filled' : '', known.at(letters[c], c));
          t.classList.toggle('cursor', c === letters.length);
        } else {
          setTile(t, '', '');
        }
      });
    });
  }

  /** Flips the tiles of a just-scored row, one after another. */
  async reveal(r: number) {
    const tiles = this.tiles[r];
    if (!tiles) return;
    haptics.reveal(tiles.length);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    // Reset every tile, let the browser notice once, then start them all:
    // one layout for the row instead of one per tile.
    tiles.forEach((t, i) => {
      t.style.setProperty('--i', String(i));
      t.classList.remove('reveal');
    });
    void this.el.offsetWidth;
    tiles.forEach((t) => t.classList.add('reveal'));
    await new Promise((res) => setTimeout(res, 260 * tiles.length + 240));
    tiles.forEach((t) => t.classList.remove('reveal'));
  }

  shake(r: number) {
    const row = this.rowEls[r];
    if (!row) return;
    haptics.reject();
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
  }

  bounce(r: number) {
    haptics.win();
    this.tiles[r]?.forEach((t, i) => {
      t.style.setProperty('--i', String(i));
      t.classList.add('bounce');
    });
  }
}

function setTile(t: HTMLDivElement, letter: string, state: Mark | 'filled' | '', hint?: Mark) {
  const upper = toUpper(letter);
  if (t.textContent !== upper) t.textContent = upper;
  t.className = 'tile' + (state ? ' ' + state : '') + (hint ? ' hint-' + hint : '');
  let label = state === 'filled' || state === '' ? letter : `${letter}, ${tr(`tile.${state}`)}`;
  if (hint) label += `, ${tr(`tile.hint.${hint}`)}`;
  t.setAttribute('aria-label', label.trim() || tr('tile.empty'));
}

/** Shows which letters have been tried, without being a keyboard. */
export function renderTracker(el: HTMLElement, alphabet: string[], rows: Row[]) {
  const { best } = letterHints(rows);
  trackerListener?.(tileLocale, best);
  el.classList.toggle('dense', alphabet.length > 40);
  if (el.childElementCount !== alphabet.length) {
    el.replaceChildren(
      ...alphabet.map((ch) => {
        const s = document.createElement('span');
        s.textContent = toUpper(ch);
        return s;
      }),
    );
  }
  [...el.children].forEach((s, i) => {
    s.className = best.get(alphabet[i]) ?? '';
  });
}

let trackerListener: ((lang: string, best: Map<string, Mark>) => void) | undefined;

/** Called whenever the used letters are redrawn: the on-screen keyboard colours its keys from it. */
export function onTrackerUpdate(fn: typeof trackerListener) {
  trackerListener = fn;
}

let showHints = true;

/** Turns the already-tried hints on the typing row on or off (Settings). */
export function setTypingHints(on: boolean) {
  showHints = on;
}

let tileLocale = 'en';

/** The word language, for capitals: Turkish i is İ (and ı is I). */
export function setTileLocale(lang: string) {
  tileLocale = lang;
}

/** Uppercase for one tile. German ß has a capital (ẞ) that fits in one tile. */
export function toUpper(letter: string) {
  return letter === 'ß' ? 'ẞ' : displayLetter(letter).toLocaleUpperCase(tileLocale);
}
