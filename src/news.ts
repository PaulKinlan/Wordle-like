// What's new: renders the change log (src/changelog.ts) into its sheet and
// keeps the "something new" dot on the ? button.
import { CHANGELOG, LATEST } from './changelog';
import { t, uiLang } from './i18n';
import { REPO_URL } from '../shared/version';

const SEEN = 'letterle:v1:news-seen';
// Set by the first visit to How to play: tells a returning player from a new one.
const SEEN_HELP = 'letterly:v1:seen-help';

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the dot just shows again next time */
  }
}

function setDot(unseen: boolean) {
  const root = document.documentElement;
  if (unseen) root.dataset.news = 'unseen';
  else delete root.dataset.news;
  document.getElementById('btn-help')?.setAttribute('aria-label', t(unseen ? 'news.unseen' : 'app.help'));
}

/**
 * Call before the first visit is recorded. A brand-new player has nothing
 * "new" to catch up on, so everything so far counts as seen for them.
 */
export function initNews() {
  let seen = read(SEEN);
  if (seen === null && read(SEEN_HELP) === null) {
    seen = LATEST;
    write(SEEN, seen);
  }
  setDot(!!LATEST && seen !== LATEST);
}

/** Interface language changed: the button's label is translated text. */
export function refreshNewsLabel() {
  setDot(document.documentElement.dataset.news === 'unseen');
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/** Fills the sheet (DOM nodes only, for the Trusted Types CSP) and marks it seen. */
export function renderNews() {
  const list = document.getElementById('news-list');
  if (!list) return;
  const lang = uiLang();
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  // The entries are written in English for now.
  if (lang !== 'en') list.lang = 'en';
  else list.removeAttribute('lang');
  list.replaceChildren(
    ...CHANGELOG.flatMap((day) => {
      const heading = el('h3', fmt.format(new Date(`${day.date}T00:00:00Z`)));
      heading.lang = lang;
      const nodes: HTMLElement[] = [heading];
      for (const entry of day.entries) {
        const article = el('article');
        const p = el('p', entry.text);
        if (entry.prs.length) {
          const prs = el('span', undefined, 'prs');
          for (const n of entry.prs) {
            const a = el('a', `#${n}`);
            a.href = `${REPO_URL}/pull/${n}`;
            a.target = '_blank';
            a.rel = 'noopener';
            prs.append(a);
          }
          p.append(prs);
        }
        article.append(el('h4', entry.title), p);
        nodes.push(article);
      }
      if (day.behind) {
        const behind = el('p', undefined, 'behind');
        const label = el('strong', t('news.behind'));
        label.lang = lang;
        behind.append(label, `: ${day.behind}`);
        nodes.push(behind);
      }
      return nodes;
    }),
  );
  write(SEEN, LATEST);
  setDot(false);
}
