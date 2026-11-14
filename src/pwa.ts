// Progressive enhancements for the installed app. Each one checks for
// support first and does nothing where it isn't available (mostly Chrome
// and Android).

// ---------------------------------------------------------------- haptics

let hapticsOn = true;

export const canVibrate = () => 'vibrate' in navigator;

export function setHaptics(on: boolean) {
  hapticsOn = on;
}

function buzz(pattern: number | number[]) {
  if (!hapticsOn || !canVibrate()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* not allowed (e.g. no user gesture yet) */
  }
}

export const haptics = {
  /** One tap per tile as the row flips (tiles flip every 260 ms). */
  reveal(tiles: number) {
    const pattern: number[] = [];
    for (let i = 0; i < tiles; i++) pattern.push(12, 248);
    buzz(pattern);
  },
  /** Not a word, wrong length, hard-mode rule broken. */
  reject: () => buzz([40, 50, 40]),
  win: () => buzz([30, 70, 30, 70, 140]),
};

// ---------------------------------------------------------------- app badge

type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/** A dot on the app icon while today's word is still to play. */
export function setUnplayedBadge(unplayed: boolean) {
  const nav = navigator as BadgeNavigator;
  if (!nav.setAppBadge) return;
  (unplayed ? nav.setAppBadge() : nav.clearAppBadge!()).catch(() => undefined);
}

// ---------------------------------------------------------------- wake lock

let lock: WakeLockSentinel | null = null;
let wantLock = false;

/** Keeps the screen on while a race is running, so the phone doesn't sleep mid-row. */
export async function keepAwake(on: boolean) {
  wantLock = on;
  if (!('wakeLock' in navigator)) return;
  if (!on) {
    await lock?.release().catch(() => undefined);
    lock = null;
    return;
  }
  if (lock || document.visibilityState !== 'visible') return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => (lock = null));
  } catch {
    lock = null; // battery saver, or not allowed
  }
}

// The browser drops the lock when the tab is hidden; take it again on return.
document.addEventListener('visibilitychange', () => {
  if (wantLock && document.visibilityState === 'visible') void keepAwake(true);
});
