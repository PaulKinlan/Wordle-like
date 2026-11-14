// "A new version is ready": checks the live version every so often and offers
// a reload. The page itself is always fetched fresh (the service worker is
// network-first for pages), so a long-open tab or installed app is the only
// place old code can linger. Nothing reloads on its own, so a game in progress
// is never interrupted.
import { COMMIT } from '../shared/version';
import { debugLog } from './debug';

const EVERY_MS = 30 * 60 * 1000;
const MIN_GAP_MS = 5 * 60 * 1000;

let lastCheck = 0;
let found = false;

async function check(onUpdate: (commit: string) => void) {
  if (found || COMMIT === 'dev' || !navigator.onLine) return;
  lastCheck = Date.now();
  // A new service worker (sw.js changed) installs and takes over by itself.
  void navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => undefined);
  try {
    const res = await fetch('/health', { cache: 'no-store' });
    const live = ((await res.json()) as { commit?: string }).commit;
    debugLog('update check: running', COMMIT.slice(0, 7), 'live', live?.slice(0, 7));
    if (live && live !== 'dev' && live !== COMMIT) {
      found = true;
      onUpdate(live);
    }
  } catch {
    /* offline or the check failed: try again later */
  }
}

/** Calls onUpdate once, when a newer version than this page is live. */
export function watchForUpdates(onUpdate: (commit: string) => void) {
  const maybe = () => {
    if (Date.now() - lastCheck >= MIN_GAP_MS) void check(onUpdate);
  };
  setInterval(maybe, EVERY_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && maybe());
  addEventListener('online', maybe);
  setTimeout(maybe, 60_000);
}
