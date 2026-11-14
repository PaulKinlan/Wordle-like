// Makes worker/words/ja/*.json: Japanese words of 4 kana, from the readings in
// the npm package kotobako-data (derived from JMdict, CC BY-SA 4.0, with JLPT
// levels from open-anki-jlpt-decks). Run: node scripts/build-japanese.mjs
//
// Words are written in hiragana; katakana folds to hiragana (see the ja entry
// in shared/languages.ts). Small kana (ゃ, っ...) and voiced kana (が, ぱ...)
// are letters of their own. Answers are native words (no katakana loanwords):
//   candidates: JLPT N5 to N3     rare: JLPT N2     allowed: every other reading
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const data = require('kotobako-data/kotobako-static.json');
const LENGTH = 4;

const toHiragana = (s) => [...s].map((c) => {
  const x = c.codePointAt(0);
  return x >= 0x30a1 && x <= 0x30f6 ? String.fromCodePoint(x - 0x60) : c;
}).join('');
const ok = (w) => /^[ぁ-ゔー]+$/u.test(w) && !/[ゐゑ]/u.test(w) && [...w].length === LENGTH;
const loanword = (e) => /^[ァ-ヶー・]+$/u.test(e.word);

const candidates = new Set();
const rare = new Set();
const allowed = new Set();
for (const e of data.datasets.vocab) {
  const w = toHiragana(e.reading.normalize('NFC'));
  if (!ok(w)) continue;
  if (!loanword(e) && !w.includes('ー')) {
    if (['N5', 'N4', 'N3'].includes(e.jlpt)) candidates.add(w);
    else if (e.jlpt === 'N2') rare.add(w);
  }
  allowed.add(w);
}
for (const w of candidates) rare.delete(w);
for (const w of [...candidates, ...rare]) allowed.delete(w);

const dir = new URL('../worker/words/ja/', import.meta.url);
mkdirSync(dir, { recursive: true });
const sorted = (s) => [...s].sort();
writeFileSync(new URL('candidates.json', dir), JSON.stringify(sorted(candidates)));
writeFileSync(new URL('rare.json', dir), JSON.stringify(sorted(rare)));
writeFileSync(new URL('allowed.json', dir), JSON.stringify(sorted(allowed)));
writeFileSync(
  new URL('LICENSE', dir),
  `Word lists for "ja", built by scripts/build-japanese.mjs from the npm package
kotobako-data (${data.version}): readings from JMdict (Electronic Dictionary
Research and Development Group, https://www.edrdg.org/jmdict/j_jmdict.html),
with JLPT levels from open-anki-jlpt-decks. CC BY-SA 4.0
(https://creativecommons.org/licenses/by-sa/4.0/). These lists are shared under
the same licence.
`,
);
console.log('ja', { candidates: candidates.size, rare: rare.size, allowed: allowed.size });
