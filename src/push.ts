// Daily reminder notifications (Web Push). The Worker sends them from a
// cron; see worker/push.ts. Everything here is a progressive
// enhancement: the setting only shows up where it can work.
import { debugLog } from './debug';
import { reportError } from './telemetry';

const PREFS_KEY = 'letterly:v1:push';

export interface PushPrefs {
  hour: number;
  lang: string;
  tz: string;
  /** Interface language, for the notification text. */
  ui: string;
}

export type PushAvailability = 'ok' | 'install-first' | 'unsupported' | 'off';

async function serverKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/v1/push/key');
    debugLog('GET /push/key →', res.status);
    if (!res.ok) return null;
    return ((await res.json()) as { publicKey: string }).publicKey;
  } catch (e) {
    debugLog('GET /push/key failed:', e);
    return null;
  }
}

/** Whether reminders can be offered on this device. */
export async function pushAvailability(): Promise<PushAvailability> {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) {
    // iPhone and iPad only allow web push for apps added to the Home Screen.
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
    return ios ? 'install-first' : 'unsupported';
  }
  return (await serverKey()) ? 'ok' : 'off';
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg?.active ? reg : navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export function loadPushPrefs(): PushPrefs | null {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
  } catch {
    return null;
  }
}

async function savePrefs(prefs: PushPrefs | null) {
  try {
    if (prefs) localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    else localStorage.removeItem(PREFS_KEY);
    // The service worker can't read localStorage; it needs these if the
    // browser replaces the subscription (pushsubscriptionchange).
    const cache = await caches.open('prefs');
    if (prefs) await cache.put('/push-prefs', new Response(JSON.stringify(prefs)));
    else await cache.delete('/push-prefs');
  } catch {
    /* storage blocked: reminders still work until the subscription rotates */
  }
}

/**
 * For "tell me when a friend joins" in a race: asks permission and returns the
 * push subscription to hand to the room, or an error message key.
 */
export async function raceSubscription(): Promise<PushSubscriptionJSON | 'push.unavailable' | 'push.blocked' | 'push.failed'> {
  const key = await serverKey();
  if (!key) return 'push.unavailable';
  if ((await Notification.requestPermission()) !== 'granted') return 'push.blocked';
  try {
    const reg = await registration();
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    return sub.toJSON();
  } catch (e) {
    reportError('race alerts', e);
    return 'push.failed';
  }
}

/** Whether race alerts can be offered here (push supported and not blocked). */
export const canAlert = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && Notification.permission !== 'denied';

/** Asks permission, subscribes and tells the server. Returns an error message key, or null. */
export async function enablePush(hour: number, lang: string, ui: string): Promise<'push.unavailable' | 'push.blocked' | 'push.failed' | null> {
  const key = await serverKey();
  if (!key) return 'push.unavailable';
  const permission = await Notification.requestPermission();
  debugLog('permission:', permission);
  if (permission !== 'granted') return 'push.blocked';
  let step = 'service worker';
  try {
    const reg = await registration();
    debugLog('sw ready:', reg.scope);
    step = 'existing subscription';
    let sub = await reg.pushManager.getSubscription();
    if (sub) debugLog('existing subscription:', new URL(sub.endpoint).host);
    step = 'subscribe';
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    debugLog('subscribed:', new URL(sub.endpoint).host);
    const prefs: PushPrefs = { hour, lang, ui, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
    step = 'POST /push/subscribe';
    const res = await fetch('/api/v1/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), ...prefs }),
    });
    debugLog('POST /push/subscribe →', res.status, res.ok ? '' : await res.text().catch(() => ''));
    if (!res.ok) throw new Error(`subscribe failed (${res.status})`);
    await savePrefs(prefs);
    return null;
  } catch (e) {
    debugLog(`reminders failed at "${step}":`, e);
    reportError(`reminders: ${step}`, e);
    return 'push.failed';
  }
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  await savePrefs(null);
  if (!sub) return;
  await fetch('/api/v1/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

/** After today's daily game: no need to remind this device today. */
export async function markPlayedToday(date: string): Promise<void> {
  if (!loadPushPrefs()) return;
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  await fetch('/api/v1/push/played', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint, date }),
  }).catch(() => undefined);
}
