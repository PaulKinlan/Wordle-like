// The game's own on-screen keyboard: optional (Settings), off by default.
// The phone's keyboard stays the main way to play; this is for people who
// prefer keys that show what each letter has scored, like other word games.
import type { Mark } from '../shared/game';
import { t as tr } from './i18n';
import { cycleKana, layoutFor, MARK_KEY, type Layout } from './layouts';
import type { NativeEntry } from './keyboard';
import { toUpper } from './board';

export class OnScreenKeyboard {
  private lang = '';
  private layout: Layout = { rows: [] };
  private keys = new Map<string, HTMLButtonElement>();

  constructor(
    private el: HTMLElement,
    private entry: NativeEntry,
  ) {
    // pointerdown, not click: keys respond at once, and the board keeps focus.
    el.addEventListener('pointerdown', (e) => {
      const key = (e.target as Element).closest<HTMLButtonElement>('button[data-key]');
      if (!key) return;
      e.preventDefault();
      this.press(key.dataset.key!);
    });
    // Keyboard and switch users activate with Enter/Space, which fires click with detail 0.
    el.addEventListener('click', (e) => {
      const key = (e.target as Element).closest<HTMLButtonElement>('button[data-key]');
      if (key && e.detail === 0) this.press(key.dataset.key!);
    });
  }

  private press(key: string) {
    if (key === 'enter') this.entry.submit();
    else if (key === 'back') this.entry.backspace();
    else if (key === MARK_KEY) this.entry.replaceLast((ch) => cycleKana(ch, this.layout.cycles ?? []));
    else this.entry.type(key);
  }

  /** Builds the keys for a word language (only when it changes). */
  setLanguage(lang: string) {
    if (lang === this.lang && this.keys.size) return;
    this.lang = lang;
    this.layout = layoutFor(lang);
    this.keys.clear();
    const rows = this.layout.rows.map((letters, r) => {
      const row = document.createElement('div');
      row.className = 'osk-row';
      const last = r === this.layout.rows.length - 1;
      if (last) row.append(this.action('enter'));
      for (const ch of letters) row.append(ch ? this.letter(ch) : spacer());
      if (last) row.append(this.action('back'));
      return row;
    });
    this.el.replaceChildren(...rows);
  }

  /** Colours each key by the best mark its letter has had. */
  paint(best: Map<string, Mark>) {
    for (const [ch, key] of this.keys) {
      const mark = best.get(ch);
      key.className = 'osk-key' + (mark ? ' ' + mark : '');
      key.setAttribute('aria-label', mark ? `${toUpper(ch)}, ${tr(`tile.${mark}`)}` : toUpper(ch));
    }
  }

  private letter(ch: string) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.key = ch;
    b.className = 'osk-key';
    b.textContent = ch === MARK_KEY ? '゛゜小' : toUpper(ch);
    if (ch === MARK_KEY) {
      b.classList.add('osk-wide');
      b.setAttribute('aria-label', tr('kb.mark'));
    } else this.keys.set(ch, b);
    return b;
  }

  private action(kind: 'enter' | 'back') {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.key = kind;
    b.className = 'osk-key osk-wide';
    b.setAttribute('aria-label', tr(kind === 'enter' ? 'kb.enter' : 'kb.delete'));
    // Built as nodes: the CSP's Trusted Types rule blocks innerHTML.
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute(
      'd',
      kind === 'enter' ? 'M20 5v7a3 3 0 0 1-3 3H5m4-4-4 4 4 4' : 'M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7zM12 9l6 6m0-6-6 6',
    );
    svg.append(path);
    b.append(svg);
    return b;
  }
}

function spacer() {
  const s = document.createElement('span');
  s.className = 'osk-gap';
  return s;
}
