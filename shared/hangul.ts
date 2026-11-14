// Korean: each tile is one key on a standard (2-beolsik) Korean keyboard. A
// syllable block is split into its letters (jamo), and the combined vowels and
// final consonant pairs are split too, so 한국 is ㅎ ㅏ ㄴ ㄱ ㅜ ㄱ and 과 is ㄱ ㅗ ㅏ.
// The double consonants (ㄲ ㄸ ㅃ ㅆ ㅉ) and ㅐ ㅔ ㅒ ㅖ are single keys, so they stay one tile.

const LEADS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const VOWELS = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const TAILS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/** Combined letters, as the keys typed for them. */
const SPLIT: Record<string, string> = {
  ㅘ: 'ㅗㅏ', ㅙ: 'ㅗㅐ', ㅚ: 'ㅗㅣ', ㅝ: 'ㅜㅓ', ㅞ: 'ㅜㅔ', ㅟ: 'ㅜㅣ', ㅢ: 'ㅡㅣ',
  ㄳ: 'ㄱㅅ', ㄵ: 'ㄴㅈ', ㄶ: 'ㄴㅎ', ㄺ: 'ㄹㄱ', ㄻ: 'ㄹㅁ', ㄼ: 'ㄹㅂ', ㄽ: 'ㄹㅅ', ㄾ: 'ㄹㅌ', ㄿ: 'ㄹㅍ', ㅀ: 'ㄹㅎ', ㅄ: 'ㅂㅅ',
};

/** The letters that can be on a tile, consonants then vowels. */
export const HANGUL_KEYS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎㅏㅐㅑㅒㅓㅔㅕㅖㅗㅛㅜㅠㅡㅣ';

/** "한국" -> "ㅎㅏㄴㄱㅜㄱ". Anything that isn't Hangul passes through. */
export function splitHangul(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)! - 0xac00;
    if (code >= 0 && code < 11172) {
      const lead = LEADS[Math.floor(code / 588)];
      const vowel = VOWELS[Math.floor((code % 588) / 28)];
      const tail = TAILS[code % 28];
      out += lead + (SPLIT[vowel] ?? vowel) + (SPLIT[tail] ?? tail);
    } else out += SPLIT[ch] ?? ch;
  }
  return out;
}
