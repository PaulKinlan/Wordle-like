// Offering to install the app. Three routes, best first:
//
// 1. The <install> element (Chrome 158+ on desktop so far). The browser
//    draws its own Install button and confirmation, and it works whether or
//    not beforeinstallprompt has fired. Where it isn't supported (or reports
//    itself invalid), our own button next to it (route 2 or 3) shows instead.
// 2. beforeinstallprompt (Chrome, Edge, Samsung on Android): our button
//    calls prompt() on the saved event.
// 3. iPhone and iPad Safari, which have neither: our button opens a sheet
//    with the Share > Add to Home Screen steps.
//
// The offer appears in three places, all marked [data-install-slot]: the
// Settings row, a small link on the end-of-game panel (the keyboard is down
// there, so the board never loses height), and a one-time sheet after the
// second finished game. Everything hides once the app is installed or is
// running from the home screen.

import { track } from './telemetry';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type InstallElement = HTMLElement & { isValid?: boolean };
type InstallResultEvent = Event & { result?: 'success' | 'aborted' | 'invalid-data' };

const KEY = 'letterly:v1:install';
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
const NUDGE_AFTER_GAMES = 2;

interface InstallState {
  /** Finished games counted towards the one-time sheet. */
  games: number;
  /** Don't show the sheet again before this time (ms). */
  next: number;
  installed?: boolean;
}

function readState(): InstallState {
  try {
    return { games: 0, next: 0, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { games: 0, next: 0 };
  }
}

function writeState(s: InstallState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: the sheet may show again, nothing worse */
  }
}

export const elementSupported = () => 'HTMLInstallElement' in window;

export function runningInstalled() {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: window-controls-overlay)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone/iPad (iPadOS reports itself as a Mac with touch). */
export function isIOS() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
let onChange = () => {};

const validElement = (el: InstallElement) => elementSupported() && el.isValid !== false;

/**
 * True when there's a working way to install from here: a usable <install>
 * element, a saved beforeinstallprompt, or the iPhone steps. Any one is enough.
 */
export function canOffer() {
  if (installed || runningInstalled()) return false;
  if (deferred) return true;
  if ([...document.querySelectorAll<InstallElement>('install')].some(validElement)) return true;
  return isIOS();
}

function markInstalled() {
  installed = true;
  deferred = null;
  writeState({ ...readState(), installed: true });
  sync();
}

function sync() {
  const show = canOffer();
  for (const el of document.querySelectorAll<HTMLElement>('[data-install-slot]')) el.hidden = !show;
  // Each <install> sits next to our own button: the browser's control when
  // it's supported and usable, otherwise our button (beforeinstallprompt,
  // or the iPhone steps).
  for (const el of document.querySelectorAll<InstallElement>('install')) {
    const native = validElement(el);
    el.hidden = !native;
    const btn = el.nextElementSibling as HTMLElement | null;
    if (btn?.matches('[data-install]')) btn.hidden = native;
  }
  onChange();
}

/**
 * Wires up every [data-install] button and <install> element on the page.
 * openSheet() is called when a fallback button needs to show the iPhone
 * steps (or the browser-menu hint) instead of a prompt.
 */
export function initInstall(opts: { openSheet: () => void; onChange?: () => void }) {
  installed = readState().installed === true;
  onChange = opts.onChange ?? onChange;

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we offer it ourselves, at a calmer moment
    deferred = e as InstallPromptEvent;
    // Chrome only offers this when the app isn't installed, so it was removed.
    if (installed) {
      installed = false;
      writeState({ ...readState(), installed: false });
    }
    sync();
  });
  addEventListener('appinstalled', () => {
    track('install_accepted', { via: 'appinstalled' });
    markInstalled();
  });

  for (const el of document.querySelectorAll<InstallElement>('install')) {
    const where = el.closest<HTMLElement>('[data-install-where]')?.dataset.installWhere ?? 'unknown';
    el.addEventListener('validationstatuschange', sync);
    el.addEventListener('click', () => track('install_prompt', { via: 'element', where }));
    el.addEventListener('installresult', (e) => {
      const result = (e as InstallResultEvent).result;
      if (result === 'success') {
        track('install_accepted', { via: 'element', where });
        el.closest('dialog')?.close();
        markInstalled();
      } else {
        track(result === 'invalid-data' ? 'install_invalid' : 'install_dismissed', { via: 'element', where });
      }
    });
  }

  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-install]')) {
    const where = btn.closest<HTMLElement>('[data-install-where]')?.dataset.installWhere ?? 'unknown';
    btn.addEventListener('click', () => {
      if (!deferred) {
        // No prompt to show (iPhone, or a browser that only installs from its menu).
        track('install_steps', { where });
        opts.openSheet();
        return;
      }
      track('install_prompt', { via: 'button', where });
      const e = deferred;
      deferred = null;
      void e
        .prompt()
        .then(() => e.userChoice)
        .then(({ outcome }) => {
          // An accepted prompt also fires appinstalled, which counts it.
          if (outcome !== 'accepted') track('install_dismissed', { via: 'button', where });
          else btn.closest('dialog')?.close();
          sync();
        })
        .catch(() => sync());
    });
  }

  matchMedia('(display-mode: standalone)').addEventListener('change', sync);
  sync();
}

/** How the sheet should explain installing: a button, iPhone steps, or the browser menu. */
export function sheetRoute(): 'button' | 'ios' | 'menu' {
  if (deferred || [...document.querySelectorAll<InstallElement>('install')].some(validElement)) return 'button';
  return isIOS() ? 'ios' : 'menu';
}

/** Count a finished game towards the one-time sheet. */
export function noteFinishedGame() {
  const s = readState();
  writeState({ ...s, games: s.games + 1 });
}

/** True (and snoozes for 30 days) when it's time for the one-time sheet. */
export function takeNudge(): boolean {
  const s = readState();
  if (s.games < NUDGE_AFTER_GAMES || Date.now() < s.next || !canOffer()) return false;
  writeState({ ...s, next: Date.now() + SNOOZE_MS });
  return true;
}
