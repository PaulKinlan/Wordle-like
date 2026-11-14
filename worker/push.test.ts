import { describe, expect, it } from 'vitest';
import { due, generateVapidKeys, getVapidKeys, isPushEndpoint, isTimeZone, localTime } from './push';
import { fromB64url, vapidAuthorization } from './webpush';

const row = (tz: string, hour: number, last_sent: string | null = null) => ({
  endpoint: 'https://fcm.googleapis.com/x',
  p256dh: 'a',
  auth: 'b',
  tz,
  hour,
  lang: 'en',
  last_sent,
});

describe('daily reminders', () => {
  it('works out local time in a time zone', () => {
    const now = new Date('2026-11-14T23:30:00Z');
    expect(localTime('Europe/London', now)).toEqual({ date: '2026-11-14', hour: 23 });
    expect(localTime('Asia/Tokyo', now)).toEqual({ date: '2026-11-15', hour: 8 });
    expect(localTime('America/Los_Angeles', now)).toEqual({ date: '2026-11-14', hour: 15 });
  });

  it('sends once a day, at or after the chosen hour', () => {
    const now = new Date('2026-11-14T09:05:00Z');
    const rows = [
      row('Europe/London', 9), // due
      row('Europe/London', 10), // not yet
      row('Europe/London', 8, '2026-11-14'), // already sent today
      row('Europe/London', 8, '2026-11-13'), // missed run: catch up
      row('Asia/Tokyo', 9), // 18:00 there, due
    ];
    expect(due(rows, now).map((d) => [d.row.hour, d.row.tz, d.date])).toEqual([
      [9, 'Europe/London', '2026-11-14'],
      [8, 'Europe/London', '2026-11-14'],
      [9, 'Asia/Tokyo', '2026-11-14'],
    ]);
  });

  it('only accepts real push services and time zones', () => {
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isPushEndpoint('https://web.push.apple.com/QGx')).toBe(true);
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false);
    expect(isPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(isTimeZone('Europe/London')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
  });
});

/** Just enough of D1 for push_config. */
function fakeDb() {
  const rows = new Map<string, string>();
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    run: async () => {
      if (sql.startsWith('INSERT OR IGNORE') && !rows.has('vapid')) rows.set('vapid', args[0] as string);
      return {};
    },
    first: async () => (rows.has('vapid') ? { v: rows.get('vapid') } : null),
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

describe('VAPID keys', () => {
  it('makes keys on first use, keeps them, and signs with them', async () => {
    const env = { DB: fakeDb() };
    expect(await getVapidKeys(env)).toBeNull(); // the cron can't make them
    const a = await getVapidKeys(env, 'https://letterly.example');
    const b = await getVapidKeys(env, 'https://other.example');
    expect(a).toEqual(b);
    expect(a!.subject).toBe('https://letterle.app');
    expect(fromB64url(a!.publicKey)).toHaveLength(65);
    expect(await getVapidKeys(env)).toEqual(a);
    expect(await vapidAuthorization('https://fcm.googleapis.com/fcm/send/x', a!)).toMatch(/^vapid t=/);
  });

  it('prefers Worker secrets', async () => {
    const own = await generateVapidKeys();
    const env = {
      DB: fakeDb(),
      VAPID_PUBLIC_KEY: own.publicKey,
      VAPID_PRIVATE_KEY: own.privateKey,
      VAPID_SUBJECT: 'mailto:me@example.com',
    };
    expect(await getVapidKeys(env, 'https://x.example')).toEqual({ ...own, subject: 'mailto:me@example.com' });
  });
});
