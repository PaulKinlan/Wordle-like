// Daily reminders by Web Push.
//
//   GET  /api/v1/push/key          the VAPID public key (404 if push isn't set up)
//   POST /api/v1/push/subscribe    { subscription, tz, hour, lang }
//   POST /api/v1/push/unsubscribe  { endpoint }
//   POST /api/v1/push/played       { endpoint, date }: played today, skip today's reminder
//
// Subscriptions live in the same D1 database as the answers. A cron trigger
// runs every hour (wrangler.jsonc) and sends each subscriber one notification
// a day, at the hour they picked in their own time zone.
//
// Setup: VAPID keys as Worker secrets, see the README ("Daily notifications").
import { dailyNumber } from '../shared/daily';
import { getLanguage } from '../shared/languages';
import { sendPush, type VapidKeys } from './webpush';

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
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/,
];

const MAX_SUBSCRIPTIONS = 5000;

export function vapidKeys(env: PushEnv): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY.trim(),
    privateKey: env.VAPID_PRIVATE_KEY.trim(),
    subject: env.VAPID_SUBJECT?.trim() || 'https://github.com/PaulKinlan/Wordle-like',
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
    migrated = true;
  }
}

/** The reminder text in each interface language. */
const REMINDER: Record<string, (n: number | null, name: string) => string> = {
  en: (n, name) => `Word No. ${n} is ready${name}. Keep your streak going!`,
  es: (n, name) => `La palabra n.º ${n} ya está lista${name}. ¡No pierdas la racha!`,
  fr: (n, name) => `Le mot n° ${n} est prêt${name}. Gardez votre série !`,
  de: (n, name) => `Wort Nr. ${n} ist bereit${name}. Halte deine Serie!`,
  it: (n, name) => `La parola n. ${n} è pronta${name}. Non interrompere la serie!`,
  pt: (n, name) => `A palavra n.º ${n} está pronta${name}. Mantém a sequência!`,
  nl: (n, name) => `Woord nr. ${n} staat klaar${name}. Houd je reeks vast!`,
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
  const keys = vapidKeys(env);

  if (action === 'key' && request.method === 'GET') {
    if (!keys) return error(404, 'push_off', 'Notifications are not set up');
    return json({ publicKey: keys.publicKey }, { cache: 'public, max-age=3600' });
  }
  if (request.method !== 'POST') return error(404, 'not_found', 'Unknown API route');
  if (!keys) return error(404, 'push_off', 'Notifications are not set up');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error(400, 'bad_request', 'Expected a JSON body');
  }
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
    await env.DB.prepare('UPDATE push_subs SET last_sent = ?2 WHERE endpoint = ?1').bind(body.endpoint, body.date).run();
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
}

/** Which subscribers are due now: their chosen hour, not yet sent today. */
export function due(rows: SubRow[], now: Date): { row: SubRow; date: string }[] {
  const out: { row: SubRow; date: string }[] = [];
  for (const row of rows) {
    const t = localTime(isTimeZone(row.tz) ? row.tz : 'UTC', now);
    // At or after their hour (so a missed cron run catches up), once a day.
    if (t.hour >= row.hour && row.last_sent !== t.date) out.push({ row, date: t.date });
  }
  return out;
}

/** The hourly cron: sends today's reminder to everyone who is due. */
export async function sendDailyReminders(env: PushEnv, now = new Date()): Promise<{ sent: number; removed: number }> {
  const keys = vapidKeys(env);
  if (!keys) return { sent: 0, removed: 0 };
  await ensureTable(env.DB);
  const { results } = await env.DB.prepare('SELECT * FROM push_subs').all<SubRow>();
  let sent = 0;
  let removed = 0;
  // Workers allow a limited number of outgoing requests per run; anyone left
  // over is picked up by the next hourly run.
  for (const { row, date } of due(results, now).slice(0, 40)) {
    const number = dailyNumber(date);
    const name = getLanguage(row.lang)?.nativeName;
    let status = 0;
    try {
      status = await sendPush(
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        {
          title: 'Letterly',
          body: (REMINDER[row.ui ?? 'en'] ?? REMINDER.en)(number, row.lang !== 'en' && name ? ` (${name})` : ''),
          url: '/',
          tag: 'daily',
        },
        keys,
        { topic: 'daily', ttl: 12 * 3600 },
      );
    } catch (e) {
      console.error('push failed', e);
    }
    if (status === 404 || status === 410) {
      // The subscription has expired or been revoked.
      await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?1').bind(row.endpoint).run();
      removed++;
    } else {
      // Mark as sent even on other errors, so a broken subscription isn't retried every hour.
      await env.DB.prepare('UPDATE push_subs SET last_sent = ?2 WHERE endpoint = ?1').bind(row.endpoint, date).run();
      if (status >= 200 && status < 300) sent++;
      else if (status) console.warn('push status', status, new URL(row.endpoint).host);
    }
  }
  return { sent, removed };
}
