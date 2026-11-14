// On-screen keyboard layouts, one per word language. Each layout is rows of
// tiles: the same single characters the game stores (a Welsh digraph is one
// private-use character, Korean is jamo, Japanese is hiragana).
//
// Latin layouts follow the language's usual phone keyboard, keeping only the
// letters in its alphabet, then add a row for any letters still missing
// (accents, ñ, ç...). Japanese is a kana grid with a key that cycles the last
// kana through its voiced and small forms, like a phone's kana keyboard.
import { getLanguage, digraphChar } from '../shared/languages';

export interface Layout {
  rows: string[][];
  /** Japanese: the mark key cycles the last kana through these sets. */
  cycles?: string[];
}

const QWERTY = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

const LATIN_LAYOUTS: Record<string, string[]> = {
  fr: ['azertyuiop', 'qsdfghjklm', 'wxcvbn'],
  de: ['qwertzuiopü', 'asdfghjklöä', 'yxcvbnmß'],
  sv: ['qwertyuiopå', 'asdfghjklöä', 'zxcvbnm'],
  tr: ['qwertyuıopğü', 'asdfghjklşi', 'zxcvbnmöç'],
  es: ['qwertyuiop', 'asdfghjklñ', 'zxcvbnm'],
  eu: ['qwertyuiop', 'asdfghjklñ', 'zxcvbnm'],
  br: ['qwertyuiop', 'asdfghjklñ', 'zxcvbnm'],
  ca: ['qwertyuiop', 'asdfghjklç', 'zxcvbnm'],
  pl: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'ąćęłńóśźż'],
  el: ['ερτυθιοπ', 'ασδφγηξκλ', 'ζχψωβνμ'],
};

// Korean: the standard 2-beolsik phone layout, with the shifted keys (double
// consonants and ㅒ ㅖ) as their own row so there's no hidden shift state.
const KOREAN = ['ㅂㅈㄷㄱㅅㅛㅕㅑㅐㅔ', 'ㅁㄴㅇㄹㅎㅗㅓㅏㅣ', 'ㅋㅌㅊㅍㅠㅜㅡ', 'ㄲㄸㅃㅆㅉㅒㅖ'];

// Japanese: gojūon order, one row per consonant column turned sideways so it
// fits a phone: rows are a i u e o, columns are あ か さ た な は ま や ら わ.
// A blank is a gap in the grid.
const KANA = [
  'あかさたなはまやらわ',
  'いきしちにひみ　り　',
  'うくすつぬふむゆるを',
  'えけせてねへめ　れ　',
  'おこそとのほもよろん',
];
export const MARK_KEY = '゛';
const KANA_CYCLES = [
  'かが', 'きぎ', 'くぐ', 'けげ', 'こご',
  'さざ', 'しじ', 'すず', 'せぜ', 'そぞ',
  'ただ', 'ちぢ', 'つっづ', 'てで', 'とど',
  'はばぱ', 'ひびぴ', 'ふぶぷ', 'へべぺ', 'ほぼぽ',
  'あぁ', 'いぃ', 'うぅゔ', 'えぇ', 'おぉ',
  'やゃ', 'ゆゅ', 'よょ', 'わゎ',
];

/** The keyboard for a word language. Every letter of its alphabet is on it (or, for kana, one mark-key press away). */
export function layoutFor(lang: string): Layout {
  const info = getLanguage(lang);
  const alphabet = [...(info?.alphabet ?? 'abcdefghijklmnopqrstuvwxyz')];
  if (lang === 'ja') {
    return { rows: [...KANA.map((r) => [...r].map((c) => (c === '　' ? '' : c))), ['ー', MARK_KEY]], cycles: KANA_CYCLES };
  }
  const source = lang === 'ko' ? KOREAN : (LATIN_LAYOUTS[lang] ?? QWERTY);
  const have = new Set(alphabet);
  const rows = source.map((r) => [...r].filter((c) => have.has(c))).filter((r) => r.length);
  // Welsh: the digraphs (ch dd ff ng ll ph rh th) get a row of their own.
  if (info?.digraphs) rows.push(info.digraphs.map(digraphChar));
  const placed = new Set(rows.flat());
  const missing = alphabet.filter((c) => !placed.has(c));
  if (missing.length) rows.push(missing);
  return { rows };
}

/** The next form of a kana for the mark key: か → が → か, は → ば → ぱ → は. */
export function cycleKana(ch: string, cycles: string[]): string {
  for (const set of cycles) {
    const i = set.indexOf(ch);
    if (i >= 0) return set[(i + 1) % set.length];
  }
  return ch;
}
