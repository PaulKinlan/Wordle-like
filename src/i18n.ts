// Interface language. Separate from the word language: you can play Welsh
// words with English menus, or the other way round. English is the default
// and is built in; other locales load on demand.
import en, { type MessageKey, type Messages } from './locales/en';

export type { MessageKey };

export interface UiLanguage {
  code: string;
  /** Name in the language itself. */
  nativeName: string;
  name: string;
}

export const UI_LANGUAGES: UiLanguage[] = [
  { code: 'en', nativeName: 'English', name: 'English' },
  { code: 'es', nativeName: 'Español', name: 'Spanish' },
  { code: 'fr', nativeName: 'Français', name: 'French' },
  { code: 'de', nativeName: 'Deutsch', name: 'German' },
  { code: 'it', nativeName: 'Italiano', name: 'Italian' },
  { code: 'pt', nativeName: 'Português', name: 'Portuguese' },
  { code: 'nl', nativeName: 'Nederlands', name: 'Dutch' },
  { code: 'ca', nativeName: 'Català', name: 'Catalan' },
  { code: 'eu', nativeName: 'Euskara', name: 'Basque' },
  { code: 'cy', nativeName: 'Cymraeg', name: 'Welsh' },
  { code: 'ga', nativeName: 'Gaeilge', name: 'Irish' },
  { code: 'gd', nativeName: 'Gàidhlig', name: 'Scottish Gaelic' },
  { code: 'br', nativeName: 'Brezhoneg', name: 'Breton' },
  { code: 'pl', nativeName: 'Polski', name: 'Polish' },
  { code: 'sv', nativeName: 'Svenska', name: 'Swedish' },
  { code: 'tr', nativeName: 'Türkçe', name: 'Turkish' },
  { code: 'el', nativeName: 'Ελληνικά', name: 'Greek' },
  { code: 'ja', nativeName: '日本語', name: 'Japanese' },
  { code: 'ko', nativeName: '한국어', name: 'Korean' },
];

const loaders: Record<string, () => Promise<{ default: Messages }>> = {
  es: () => import('./locales/es'),
  fr: () => import('./locales/fr'),
  de: () => import('./locales/de'),
  it: () => import('./locales/it'),
  pt: () => import('./locales/pt'),
  nl: () => import('./locales/nl'),
  ca: () => import('./locales/ca'),
  eu: () => import('./locales/eu'),
  cy: () => import('./locales/cy'),
  ga: () => import('./locales/ga'),
  gd: () => import('./locales/gd'),
  br: () => import('./locales/br'),
  pl: () => import('./locales/pl'),
  sv: () => import('./locales/sv'),
  tr: () => import('./locales/tr'),
  el: () => import('./locales/el'),
  ja: () => import('./locales/ja'),
  ko: () => import('./locales/ko'),
};

let current: Messages = en;
let currentCode = 'en';

export function uiLang() {
  return currentCode;
}

/** Switches the interface language. Falls back to English if it can't load. */
export async function setUiLanguage(code: string): Promise<void> {
  if (code === currentCode) return;
  try {
    current = code === 'en' || !loaders[code] ? en : (await loaders[code]()).default;
    currentCode = loaders[code] ? code : 'en';
  } catch {
    current = en;
    currentCode = 'en';
  }
  document.documentElement.lang = currentCode;
}

/** A message with {placeholders} filled in. */
export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  const text = current[key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/**
 * Fills an element with a message, turning **bold** into <strong>. Builds DOM
 * nodes rather than HTML, so it works under the Trusted Types CSP.
 */
export function fillRich(el: Element, key: MessageKey) {
  const parts = t(key).split(/\*\*(.+?)\*\*/g);
  el.replaceChildren(
    ...parts.map((part, i) => {
      if (i % 2 === 0) return document.createTextNode(part);
      const strong = document.createElement('strong');
      strong.textContent = part;
      return strong;
    }),
  );
}

/**
 * Translates the static page: data-i18n (text), data-i18n-rich (with bold),
 * data-i18n-aria (aria-label).
 */
export function translatePage(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n as MessageKey);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-rich]')) fillRich(el, el.dataset.i18nRich as MessageKey);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria as MessageKey));
  }
}
