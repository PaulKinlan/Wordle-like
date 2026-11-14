import { displayLetter, type Mark } from '../shared/game';
import { t as tr } from './i18n';
import type { Row } from './storage';
import { haptics } from './pwa';
import { letterHints } from './hints';

/** Draws the grid of tiles. Rebuilt only when the puzzle shape changes. */
export class Board {
  private tiles: HTMLDivElement[][] = [];
  private rowEls: HTMLDivElement[] = [];

  constructor(private el: HTMLElement) {}

  build(rows: number, cols: number) {
    this.el.replaceChildren();
    this.el.style.setProperty('--cols', String(cols));
    this.el.style.setProperty('--rows', String(rows));
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
    tiles.forEach((t, i) => {
      t.style.setProperty('--i', String(i));
      t.classList.remove('reveal');
      void t.offsetWidth;
      t.classList.add('reveal');
    });
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
