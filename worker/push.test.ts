import { describe, expect, it } from 'vitest';
import { due, isPushEndpoint, isTimeZone, localTime } from './push';

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
