// Words that must never be an answer: slurs, sexual words and strong swearing.
// They stay valid as guesses (people type what they type); they just never
// come up as the word of the day, an unlimited word or a race word.
//
// The answer order already stored in D1 includes whatever the lists held when
// a language was first played, so this is checked when an answer is read
// (answers.ts skips to the next word), not only when the lists are built.
//
// Entries are lower case, spelled as the word lists spell them (accents
// included). Several languages are listed even where none of these words is in
// today's lists, so a rebuilt list can't bring one back.

const LISTS: Record<string, string> = {
  en: `bitch bitty boobs booby butts crack dicks dildo dyked dykes faggy fagot fags gooks hoes homos horny jizzy kikes
    lesbo nazis negro niggr nigga niger penis porno pussy queer rapes raped rapey sluts slutty spick spics titty turds
    twats vulva whore wanks chink chinks coons darky darkie gypos gyppo gippo gypsy honky kraut krauts dagos wetback
    squaw redskin pakis paki retard tards spazz spaz trany tranny midget cunts cunty cocks fucks fucky fucker shits
    prick skank slags slag hussy pimps semen sperm anals rapist orgasm boner boners twat cunt whores jizz porn
    nonce spunk gimpy gimps`,
  es: `puta putas puto putos coño coños joder verga vergas pinga pingas polla pollas culos mierda pendejo pendeja marica
    maricón maricas joto jotos negrata sudaca sudacas zorra zorras perra perras follar cabrón cabrones gilipollas mamón
    chocho tetas nazis panocha`,
  fr: `pute putes salope salopes conne connes connard bite bites nègre nègres négro négros bougnoule youpin youtre bicot
    bicots pédé pédés tapette gouine gouines enculé enculés merde merdes chier foutre baise baiser nazis chinetoque
    bamboula pétasse couille couilles`,
  de: `neger nigger fotze fotzen votze ficken ficke fickt fick hure huren nutte nutten schwuchtel kanake kanaken spast
    spasti spasten mongo fidschi kacke scheiße arsch ärsche titten wichse wichser pisse hitler nazis schlampe zigeuner
    judensau schwanz`,
  it: `negro negri negra negre frocio froci frocia culattone ricchione troia troie puttana mignotta cazzo cazzi figa fighe
    fica minchia stronzo stronzi stronza merda merde terrone terroni zingaro zingari zingara nazis coglione coglioni
    vaffa`,
  pt: `puta putas porra porras caralho buceta xoxota foder fodas foda viado viados bicha bichas sapatão merda merdas cuzão
    piroca crioulo nazis pênis`,
  nl: `neger negers nikker nikkers hoer hoeren kut kutje lul lullen flikker flikkers mongool spast tering klote kloot zeiker
    teef slet sletten pooier kanker nazis`,
  sv: `neger negrer negern hora horan horor fitta fittor fittan kuken kukar bög bögar bögen svartskalle zigenare knull
    knulla jävla jävlar nazis`,
  pl: `kurwa kurwy kurew chuj chuje chuja pizda pizdy cipa cipy jebać jebał pedał pedały ciota cioty murzyn murzyni
    czarnuch żydek cygan cyganie dziwka dziwki suka suki gówno dupa dupek kutas fiut nazis`,
  tr: `siktir amcık orospu piç göt götü yarak yarrak sikiş sikik ibne ibneler kahpe pezevenk gavat puşt zenci zenciler
    amına sürtük`,
  el: `πουτάνα πουτάνες μαλάκα μαλάκας μαλάκες γαμώ γαμάω πούστη πούστης πούστηδες αράπης αράπη αράπηδες καριόλα καριόλη
    μουνί μουνιά ψωλή ψωλές αρχίδι αρχίδια σκατά τσούλα τσούλες`,
  ca: `puta putes merda collons cony conys maricó marietes negrata fotre`,
  eu: `puta putak putakume`,
  cy: `cachu cont coc ffwc hwr hwren bastad`,
  ga: `bitseach striapach cac focáil raicleach bod pit`,
  gd: `siùrsach cac pit bod galla`,
  br: `gast gisti kaoc'h`,
  ja: `きちがい しなじん くろんぼ ちんちん せっくす おまんこ まんこ ちんこ ちんぽ ばいた かたわ めくら つんぼ`,
  ko: `씨발 시발 병신 개새끼 좆 지랄 염병 니거 깜둥이 짱깨 쪽바리 창녀 화냥년 미친년 섹스 걸레`,
};

const norm = (w: string) => w.normalize('NFC').toLowerCase().replace(/ς/g, 'σ');

const sets = new Map<string, Set<string>>();

/** The blocked words for a language ("en", or "en:rare" for its hard set). */
export function blockedWords(lang: string): Set<string> {
  const code = lang.split(':')[0];
  let set = sets.get(code);
  if (!set) {
    set = new Set((LISTS[code] ?? '').split(/\s+/).filter(Boolean).map(norm));
    sets.set(code, set);
  }
  return set;
}

/** Whether a word must never be an answer in this language. */
export function isBlocked(lang: string, word: string): boolean {
  return blockedWords(lang).has(norm(word));
}
