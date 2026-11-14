// Daily reminders by Web Push.
//
//   GET  /api/v1/push/key          the VAPID public key (made on first use)
//   POST /api/v1/push/subscribe    { subscription, tz, hour, lang }
//   POST /api/v1/push/unsubscribe  { endpoint }
//   POST /api/v1/push/played       { endpoint, date }: played today, skip today's reminder
//
// Subscriptions live in the same D1 database as the answers. A cron trigger
// runs every ten minutes (wrangler.jsonc) and sends each subscriber one notification
// a day, at the hour they picked in their own time zone.
//
// Setup: none. The Worker makes its own VAPID key pair on first use and keeps
// it in D1 (push_config). Worker secrets can override it (see the README).
import { dailyNumber } from '../shared/daily';
import { getLanguage } from '../shared/languages';
import { readObject } from './http';
import { b64url, sendPush, type VapidKeys } from './webpush';

export interface PushEnv {
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** "mailto:you@example.com" or a URL, so push services can reach you. */
  VAPID_SUBJECT?: string;
}

/** Push services browsers use. We only ever send to these. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  // Newer Chrome builds hand out endpoints like https://jmt17.google.com/fcm/send/...
  /^jmt\d*\.google\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/,
];

const MAX_SUBSCRIPTIONS = 5000;

/** The site's home, used as the VAPID contact unless VAPID_SUBJECT is set. */
export const SITE_URL = 'https://letterle.app';

interface StoredVapid {
  publicKey: string;
  privateKey: string;
  /** The site's origin when the keys were made (kept for reference). */
  origin?: string;
}

async function ensureConfigTable(db: D1Database) {
  await db.prepare('CREATE TABLE IF NOT EXISTS push_config (k TEXT PRIMARY KEY, v TEXT NOT NULL)').run();
}

/** The stored keys never change, so they're read from D1 once per running Worker. */
let storedVapid: StoredVapid | null = null;

async function readStored(db: D1Database): Promise<StoredVapid | null> {
  if (storedVapid) return storedVapid;
  // The table may not exist yet.
  const row = await db
    .prepare("SELECT v FROM push_config WHERE k = 'vapid'")
    .first<{ v: string }>()
    .catch(() => null);
  storedVapid = row ? (JSON.parse(row.v) as StoredVapid) : null;
  return storedVapid;
}

/** A new P-256 key pair in the encodings VAPID uses. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { publicKey: b64url(raw), privateKey: jwk.d! };
}

/**
 * The VAPID keys. Worker secrets win if both are set. Otherwise the keys the
 * Worker made itself, stored privately in D1; with `origin` (a request's
 * origin) they're made on first use. Only the public key ever leaves the
 * Worker.
 */
export async function getVapidKeys(env: PushEnv, origin?: string): Promise<VapidKeys | null> {
  const subject = env.VAPID_SUBJECT?.trim();
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: env.VAPID_PUBLIC_KEY.trim(),
      privateKey: env.VAPID_PRIVATE_KEY.trim(),
      subject: subject || SITE_URL,
    };
  }
  let stored = await readStored(env.DB);
  if (!stored && origin) {
    await ensureConfigTable(env.DB);
    const fresh: StoredVapid = { ...(await generateVapidKeys()), origin };
    // If two requests race, the first insert wins and both read it back.
    await env.DB.prepare("INSERT OR IGNORE INTO push_config (k, v) VALUES ('vapid', ?)")
      .bind(JSON.stringify(fresh))
      .run();
    stored = await readStored(env.DB);
  }
  if (!stored) return null;
  return {
    publicKey: stored.publicKey,
    privateKey: stored.privateKey,
    subject: subject || SITE_URL,
  };
}

export function isPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local date (YYYY-MM-DD) and hour in a time zone. */
export function localTime(tz: string, now: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

let migrated = false;

async function ensureTable(db: D1Database) {
  if (migrated) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS push_subs (
        endpoint TEXT PRIMARY KEY,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        tz TEXT NOT NULL,
        hour INTEGER NOT NULL,
        lang TEXT NOT NULL,
        last_sent TEXT,
        created_at TEXT NOT NULL
      )`,
    )
    .run();
  if (!migrated) {
    // Added after the first release: the interface language for the message.
    await db.prepare('ALTER TABLE push_subs ADD COLUMN ui TEXT').run().catch(() => undefined);
    // Snooze: when (ms since epoch) to send today's reminder again.
    await db.prepare('ALTER TABLE push_subs ADD COLUMN snooze_until INTEGER').run().catch(() => undefined);
    migrated = true;
  }
}

/** Labels for the notification's buttons, in each interface language. */
const ACTIONS: Record<string, { play: string; snooze: string; race: string }> = {
  en: { play: 'Play', snooze: 'Snooze 1 hour', race: 'Race a friend' },
  es: { play: 'Jugar', snooze: 'Posponer 1 hora', race: 'Reta a un amigo' },
  fr: { play: 'Jouer', snooze: 'Rappeler dans 1 h', race: 'Défier un ami' },
  de: { play: 'Spielen', snooze: '1 Stunde später', race: 'Freunde herausfordern' },
  it: { play: 'Gioca', snooze: 'Rimanda di 1 ora', race: 'Sfida un amico' },
  pt: { play: 'Jogar', snooze: 'Adiar 1 hora', race: 'Desafiar um amigo' },
  nl: { play: 'Spelen', snooze: 'Over 1 uur', race: 'Daag iemand uit' },
  ca: { play: 'Juga', snooze: 'Ajorna 1 hora', race: 'Repta un amic' },
  eu: { play: 'Jokatu', snooze: 'Atzeratu ordubete', race: 'Desafiatu lagun bat' },
  cy: { play: 'Chwarae', snooze: 'Ailatgoffa ymhen awr', race: 'Rasio ffrind' },
  ga: { play: 'Imir', snooze: 'Cuir siar uair an chloig', race: 'Rás le cara' },
  gd: { play: 'Cluich', snooze: 'Cuir dheth uair a thìde', race: 'Rèis le caraid' },
  br: { play: "C'hoari", snooze: 'Diwezhatoc\'h a-benn 1 eurvezh', race: 'Daeañ ur mignon' },
  pl: { play: 'Graj', snooze: 'Przypomnij za godzinę', race: 'Wyzwij znajomego' },
  sv: { play: 'Spela', snooze: 'Påminn om 1 timme', race: 'Utmana en vän' },
  tr: { play: 'Oyna', snooze: '1 saat ertele', race: 'Bir arkadaşınla yarış' },
  el: { play: 'Παίξε', snooze: 'Αναβολή 1 ώρα', race: 'Αγώνας με φίλο' },
  ja: { play: '遊ぶ', snooze: '1時間後に通知', race: '友だちと対戦' },
  ko: { play: '플레이', snooze: '1시간 후 알림', race: '친구와 대결' },
};

/** A snoozed reminder goes out on the first cron run at least this long after. */
export const SNOOZE_MS = 55 * 60 * 1000;

/** The reminder text in each interface language. */
const REMINDER: Record<string, (n: number | null, name: string) => string> = {
  en: (n, name) => `Word No. ${n} is ready${name}. Keep your streak going!`,
  es: (n, name) => `La palabra n.º ${n} ya está lista${name}. ¡No pierdas la racha!`,
  fr: (n, name) => `Le mot n° ${n} est prêt${name}. Gardez votre série !`,
  de: (n, name) => `Wort Nr. ${n} ist bereit${name}. Halte deine Serie!`,
  it: (n, name) => `La parola n. ${n} è pronta${name}. Non interrompere la serie!`,
  pt: (n, name) => `A palavra n.º ${n} está pronta${name}. Mantém a sequência!`,
  nl: (n, name) => `Woord nr. ${n} staat klaar${name}. Houd je reeks vast!`,
  ca: (n, name) => `La paraula núm. ${n} ja és aquí${name}. No perdis la ratxa!`,
  eu: (n, name) => `${n}. hitza prest dago${name}. Ez galdu bolada!`,
  cy: (n, name) => `Mae gair rhif ${n} yn barod${name}. Daliwch ati gyda'ch rhediad!`,
  ga: (n, name) => `Tá focal uimh. ${n} réidh${name}. Coinnigh do shraith ag dul!`,
  gd: (n, name) => `Tha facal àir. ${n} deiseil${name}. Cùm an sreath a' dol!`,
  br: (n, name) => `Prest eo ar ger niv. ${n}${name}. Kendalc'hit gant hoc'h heuliad!`,
  pl: (n, name) => `Słowo nr ${n} jest gotowe${name}. Nie przerywaj serii!`,
  sv: (n, name) => `Ord nr ${n} är klart${name}. Håll igång sviten!`,
  tr: (n, name) => `${n} numaralı kelime hazır${name}. Serini sürdür!`,
  el: (n, name) => `Η λέξη αρ. ${n} είναι έτοιμη${name}. Μη χάσεις το σερί σου!`,
  ja: (n, name) => `No. ${n} の単語が届きました${name}。連続記録を続けよう！`,
  ko: (n, name) => `${n}번 단어가 준비됐어요${name}. 연속 기록을 이어 가세요!`,
};

const B64URL = /^[A-Za-z0-9_-]+$/;

export async function handlePush(
  request: Request,
  env: PushEnv,
  json: (body: unknown, init?: ResponseInit & { cache?: string }) => Response,
  error: (status: number, code: string, message: string) => Response,
): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.split('/')[4];
  const keys = await getVapidKeys(env, url.origin);

  if (action === 'key' && request.method === 'GET') {
    if (!keys) return error(404, 'push_off', 'Notifications are not set up');
    return json({ publicKey: keys.publicKey }, { cache: 'public, max-age=3600' });
  }
  if (request.method !== 'POST') return error(404, 'not_found', 'Unknown API route');
  if (!keys) return error(404, 'push_off', 'Notifications are not set up');

  const body = await readObject(request, 8 * 1024);
  await ensureTable(env.DB);

  if (action === 'subscribe') {
    const sub = body.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
    const endpoint = sub?.endpoint;
    const p256dh = sub?.keys?.p256dh;
    const auth = sub?.keys?.auth;
    if (!isPushEndpoint(endpoint)) return error(400, 'bad_endpoint', 'Unsupported push service');
    if (typeof p256dh !== 'string' || !B64URL.test(p256dh) || p256dh.length > 100) {
      return error(400, 'bad_keys', 'Bad subscription keys');
    }
    if (typeof auth !== 'string' || !B64URL.test(auth) || auth.length > 40) {
      return error(400, 'bad_keys', 'Bad subscription keys');
    }
    const tz = isTimeZone(body.tz) ? body.tz : 'UTC';
    const hour = Number.isInteger(body.hour) && (body.hour as number) >= 0 && (body.hour as number) < 24 ? (body.hour as number) : 9;
    const lang = typeof body.lang === 'string' && getLanguage(body.lang) ? body.lang : 'en';
    const ui = typeof body.ui === 'string' && REMINDER[body.ui] ? body.ui : 'en';
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs').first<{ n: number }>();
    const exists = await env.DB.prepare('SELECT 1 FROM push_subs WHERE endpoint = ?1').bind(endpoint).first();
    if (!exists && (count?.n ?? 0) >= MAX_SUBSCRIPTIONS) return error(503, 'full', 'Too many subscribers');
    // If they've already played or been reminded today, don't remind them again today.
    const today = localTime(tz, new Date());
    const lastSent = today.hour >= hour ? today.date : null;
    await env.DB.prepare(
      `INSERT INTO push_subs (endpoint, p256dh, auth, tz, hour, lang, last_sent, created_at, ui)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = ?2, auth = ?3, tz = ?4, hour = ?5, lang = ?6, ui = ?9`,
    )
      .bind(endpoint, p256dh, auth, tz, hour, lang, lastSent, new Date().toISOString(), ui)
      .run();
    return json({ ok: true, hour, tz });
  }

  if (action === 'played') {
    if (typeof body.endpoint !== 'string' || typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return error(400, 'bad_request', 'Missing endpoint or date');
    }
    await env.DB.prepare('UPDATE push_subs SET last_sent = ?2, snooze_until = NULL WHERE endpoint = ?1')
      .bind(body.endpoint, body.date)
      .run();
    return json({ ok: true });
  }

  if (action === 'snooze') {
    if (typeof body.endpoint !== 'string') return error(400, 'bad_request', 'Missing endpoint');
    await env.DB.prepare('UPDATE push_subs SET snooze_until = ?2 WHERE endpoint = ?1')
      .bind(body.endpoint, Date.now() + SNOOZE_MS)
      .run();
    return json({ ok: true });
  }

  if (action === 'unsubscribe') {
    if (typeof body.endpoint !== 'string') return error(400, 'bad_request', 'Missing endpoint');
    await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?1').bind(body.endpoint).run();
    return json({ ok: true });
  }

  return error(404, 'not_found', 'Unknown API route');
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  tz: string;
  hour: number;
  lang: string;
  last_sent: string | null;
  ui?: string | null;
  snooze_until?: number | null;
}

/** Which subscribers are due now: their chosen hour, not yet sent today. */
export function due(rows: SubRow[], now: Date): { row: SubRow; date: string }[] {
  const out: { row: SubRow; date: string }[] = [];
  for (const row of rows) {
    const t = localTime(isTimeZone(row.tz) ? row.tz : 'UTC', now);
    // At or after their hour (so a missed cron run catches up), once a day.
    if (t.hour >= row.hour && row.last_sent !== t.date) out.push({ row, date: t.date });
    // Or again today, once a snooze runs out.
    else if (row.snooze_until && now.getTime() >= row.snooze_until) out.push({ row, date: t.date });
  }
  return out;
}

/** Reminders sent in one cron run, and how many go out at the same time. */
const PER_RUN = 40;
const PARALLEL = 10;

/** The cron: sends today's reminder to everyone who is due. */
export async function sendDailyReminders(env: PushEnv, now = new Date()): Promise<{ sent: number; removed: number }> {
  // Keys are made by the first subscribe request, so none means no subscribers.
  const keys = await getVapidKeys(env);
  if (!keys) return { sent: 0, removed: 0 };
  await ensureTable(env.DB);
  const { results } = await env.DB.prepare('SELECT * FROM push_subs').all<SubRow>();
  let sent = 0;
  let removed = 0;
  // A run may only make a limited number of outgoing requests, so it takes
  // PER_RUN at most. The cron fires every ten minutes, and anyone left over
  // is picked up by the next run.
  const batch = due(results, now).slice(0, PER_RUN);
  const send = async ({ row, date }: { row: SubRow; date: string }) => {
    const number = dailyNumber(date);
    const name = getLanguage(row.lang)?.nativeName;
    try {
      return await sendPush(
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        {
          title: 'Letterle',
          body: (REMINDER[row.ui ?? 'en'] ?? REMINDER.en)(number, row.lang !== 'en' && name ? ` (${name})` : ''),
          url: '/',
          image: '/og.png',
          tag: 'daily',
          actions: ACTIONS[row.ui ?? 'en'] ?? ACTIONS.en,
        },
        keys,
        { topic: 'daily', ttl: 12 * 3600 },
      );
    } catch (e) {
      console.error('push failed', e);
      return 0;
    }
  };
  // Sent a few at a time, then recorded with one database call for the lot.
  const writes: D1PreparedStatement[] = [];
  for (let i = 0; i < batch.length; i += PARALLEL) {
    const group = batch.slice(i, i + PARALLEL);
    const statuses = await Promise.all(group.map(send));
    group.forEach(({ row, date }, n) => {
      const status = statuses[n];
      if (status === 404 || status === 410) {
        // The subscription has expired or been revoked.
        writes.push(env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?1').bind(row.endpoint));
        removed++;
      } else {
        // Mark as sent even on other errors, so a broken subscription isn't retried every run.
        writes.push(
          env.DB.prepare('UPDATE push_subs SET last_sent = ?2, snooze_until = NULL WHERE endpoint = ?1').bind(row.endpoint, date),
        );
        if (status >= 200 && status < 300) sent++;
        else if (status) console.warn('push status', status, new URL(row.endpoint).host);
      }
    });
  }
  if (writes.length) await env.DB.batch(writes);
  return { sent, removed };
}

// ---------------------------------------------------------------- race alerts

/** A player's push subscription, kept in the race room while they wait for friends. */
export interface RaceAlert {
  endpoint: string;
  p256dh: string;
  auth: string;
  ui: string;
}

const RACE_JOINED: Record<string, (name: string, code: string) => { title: string; body: string }> = {
  en: (n, c) => ({ title: `${n} joined your race`, body: `Race ${c}. Tap to get ready.` }),
  es: (n, c) => ({ title: `${n} se ha unido a tu carrera`, body: `Carrera ${c}. Toca para prepararte.` }),
  fr: (n, c) => ({ title: `${n} a rejoint votre course`, body: `Course ${c}. Touchez pour vous préparer.` }),
  de: (n, c) => ({ title: `${n} ist deinem Rennen beigetreten`, body: `Rennen ${c}. Tippe, um loszulegen.` }),
  it: (n, c) => ({ title: `${n} si è unito alla tua sfida`, body: `Sfida ${c}. Tocca per prepararti.` }),
  pt: (n, c) => ({ title: `${n} entrou na tua corrida`, body: `Corrida ${c}. Toca para te preparares.` }),
  nl: (n, c) => ({ title: `${n} doet mee aan je race`, body: `Race ${c}. Tik om klaar te gaan staan.` }),
  ca: (n, c) => ({ title: `${n} s'ha unit a la teva cursa`, body: `Cursa ${c}. Toca per preparar-te.` }),
  eu: (n, c) => ({ title: `${n} zure lasterketara batu da`, body: `${c} lasterketa. Ukitu prestatzeko.` }),
  cy: (n, c) => ({ title: `Mae ${n} wedi ymuno â'ch ras`, body: `Ras ${c}. Tapiwch i baratoi.` }),
  ga: (n, c) => ({ title: `Tá ${n} tagtha isteach i do rás`, body: `Rás ${c}. Tapáil le hullmhú.` }),
  gd: (n, c) => ({ title: `Tha ${n} air tighinn dhan rèis agad`, body: `Rèis ${c}. Thoir gnogag airson ullachadh.` }),
  br: (n, c) => ({ title: `${n} a zo deuet en ho redadeg`, body: `Redadeg ${c}. Stokit evit en em brientiñ.` }),
  pl: (n, c) => ({ title: `${n} dołącza do twojego wyścigu`, body: `Wyścig ${c}. Dotknij, aby się przygotować.` }),
  sv: (n, c) => ({ title: `${n} gick med i din kapplöpning`, body: `Kapplöpning ${c}. Tryck för att göra dig redo.` }),
  tr: (n, c) => ({ title: `${n} yarışına katıldı`, body: `Yarış ${c}. Hazırlanmak için dokun.` }),
  el: (n, c) => ({ title: `Ο/Η ${n} μπήκε στον αγώνα σου`, body: `Αγώνας ${c}. Πάτησε για να ετοιμαστείς.` }),
  ja: (n, c) => ({ title: `${n} さんが対戦に参加しました`, body: `対戦 ${c}。タップして準備しよう。` }),
  ko: (n, c) => ({ title: `${n} 님이 대결에 들어왔어요`, body: `대결 ${c}. 눌러서 준비하세요.` }),
};

/** Checks a subscription a player sent to their race room. */
export function parseRaceAlert(raw: unknown, ui: unknown): RaceAlert | null {
  const sub = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!isPushEndpoint(sub?.endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (!B64URL.test(p256dh) || !B64URL.test(auth) || p256dh.length > 100 || auth.length > 40) return null;
  return { endpoint: sub.endpoint, p256dh, auth, ui: typeof ui === 'string' && RACE_JOINED[ui] ? ui : 'en' };
}

/**
 * Tells a waiting player that a friend has joined. Returns false when the
 * subscription is gone, so the room can forget it.
 */
export async function sendRaceJoined(env: PushEnv, alert: RaceAlert, name: string, code: string): Promise<boolean> {
  const keys = await getVapidKeys(env);
  if (!keys) return true;
  const text = (RACE_JOINED[alert.ui] ?? RACE_JOINED.en)(name, code);
  const status = await sendPush(
    { endpoint: alert.endpoint, p256dh: alert.p256dh, auth: alert.auth },
    { ...text, kind: 'race', url: `/r/${code}`, image: `/og/r/${code}.png?v=1`, tag: `race-${code}` },
    keys,
    // A join is only worth knowing about for a few minutes.
    { topic: `race${code}`, ttl: 600 },
  ).catch((e) => {
    console.error('race push failed', e);
    return 0;
  });
  return status !== 404 && status !== 410;
}
