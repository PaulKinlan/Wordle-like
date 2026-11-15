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
    // The row being typed stands out; the empty rows below it step back.
    this.rowEls.forEach((row, r) => {
      row.classList.toggle('active', r === rows.length && active);
      row.classList.toggle('upcoming', r > rows.length || (r === rows.length && !active));
    });
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
    this.celebrate();
  }

  /** Confetti over the board on a win, where CSS random() can scatter it. */
  private celebrate() {
    const wrap = this.el.parentElement;
    if (!wrap || !CSS.supports('width', 'random(1px, 2px)')) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    wrap.querySelector('.confetti')?.remove();
    const box = document.createElement('div');
    box.className = 'confetti';
    box.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 28; i++) box.append(document.createElement('i'));
    wrap.append(box);
    setTimeout(() => box.remove(), 2400);
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
        // Where interest invokers work, each letter is a button: a long press
        // (hover on desktop) says what's known about it. Otherwise plain text.
        const s = document.createElement(letterTip ? 'button' : 'span');
        s.textContent = toUpper(ch);
        if (s instanceof HTMLButtonElement) {
          s.type = 'button';
          s.tabIndex = -1;
          s.setAttribute('interestfor', 'letter-tip');
        }
        return s;
      }),
    );
  }
  [...el.children].forEach((s, i) => {
    const mark = best.get(alphabet[i]);
    s.className = mark ?? '';
    if (letterTip) {
      const letter = toUpper(alphabet[i]);
      s.setAttribute('aria-label', tr(`tracker.${mark ?? 'untried'}`, { letter }));
    }
  });
}

/** The popover the tracker's letters explain themselves in, if supported. */
const letterTip =
  typeof HTMLButtonElement !== 'undefined' && 'interestForElement' in HTMLButtonElement.prototype
    ? document.getElementById('letter-tip')
    : null;

// The tip shows the label of whichever letter asked for it.
let tipAnchor: HTMLElement | undefined;
letterTip?.addEventListener('interest', (e) => {
  const source = (e as Event & { source?: Element }).source;
  letterTip.textContent = source?.getAttribute('aria-label') ?? '';
  // Sits above that letter (CSS anchor positioning).
  tipAnchor?.style.removeProperty('anchor-name');
  if (source instanceof HTMLElement) {
    tipAnchor = source;
    source.style.setProperty('anchor-name', '--letter-tip');
  }
});

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
