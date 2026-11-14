// Makes worker/words/ko/*.json: Korean words that are 6 letters (jamo) when
// typed on a standard keyboard, e.g. 한국 = ㅎㅏㄴㄱㅜㄱ (see shared/hangul.ts).
// Run: node scripts/build-korean.mjs   (Node 22.6+ for the .ts import)
//
// Sources: word counts from FrequencyWords (OpenSubtitles 2018, hermitdave,
// CC BY-SA 4.0) and the Hunspell dictionary in the npm package dictionary-ko
// (hunspell-dict-ko, word data CC BY-SA). Answers are dictionary base forms
// (not inflected ones). Answers are the most common words, kept in syllables
// (한국) so the real spelling shows when a game ends; the other guesses are
// stored already split (ㅎㅏㄴㄱㅜㄱ), as worker/words.ts expects.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { splitHangul } from '../shared/hangul.ts';

const LENGTH = 6;
const FREQ = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ko/ko_50k.txt';

// Each line is "word/flag". Flags 2, 3 and 4 mark inflected forms (가감하여,
// 가감한, 가감할): fine as guesses, but answers come from the base forms.
const entries = readFileSync(new URL('../node_modules/dictionary-ko/index.dic', import.meta.url), 'utf8')
  .split('\n')
  .slice(1)
  .map((l) => l.normalize('NFC').split('/'))
  .filter(([w]) => /^[가-힣]+$/u.test(w));
const dic = entries.map(([w]) => w);
const headwords = new Set(entries.filter(([, flag]) => !['2', '3', '4'].includes(flag)).map(([w]) => w));
// Never an answer (still fine as a guess): swearing, slurs, crude words and names.
const BLOCK = new Set(
  '강간 개새끼 개소리 대가리 머저리 병신 불알 아가리 염병 젠장 포르노 콘돔 불륜 거시기 흑인 백인 에이즈 마누라 할멈 대마초 링컨 닉슨 마리아 성은'.split(' '),
);
const fits = (w) => [...splitHangul(w)].length === LENGTH;

const res = await fetch(FREQ);
if (!res.ok) throw new Error(`${FREQ}: ${res.status}`);
const ranked = [];
for (const line of (await res.text()).split('\n')) {
  const [word, count] = line.trim().split(' ');
  const w = word?.normalize('NFC');
  if (w && Number(count) >= 3 && headwords.has(w) && !BLOCK.has(w) && fits(w) && !ranked.includes(w)) ranked.push(w);
}
const candidates = ranked.slice(0, 1000);
const rare = ranked.slice(1000, 3000);
const used = new Set([...candidates, ...rare]);
const allowed = [...new Set(dic.filter((w) => fits(w) && !used.has(w)))];

const dir = new URL('../worker/words/ko/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('candidates.json', dir), JSON.stringify([...candidates].sort()));
writeFileSync(new URL('rare.json', dir), JSON.stringify([...rare].sort()));
writeFileSync(new URL('allowed.json', dir), JSON.stringify(allowed.map(splitHangul).sort()));
writeFileSync(
  new URL('LICENSE', dir),
  `Word lists for "ko", built by scripts/build-korean.mjs from:

1. FrequencyWords by Hermit Dave (https://github.com/hermitdave/FrequencyWords),
   from OpenSubtitles 2018, CC BY-SA 4.0.

2. The Hunspell dictionary in the npm package dictionary-ko@2.0.0
   (hunspell-dict-ko, https://github.com/spellcheck-ko/hunspell-dict-ko). Its word
   data is CC BY-SA (2.0 KR / 4.0); see its licence file.

These lists are shared under CC BY-SA 4.0.
`,
);
console.log('ko', { candidates: candidates.length, rare: rare.length, allowed: allowed.length });
