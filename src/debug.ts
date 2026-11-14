// A debug panel for phones, where there's no console: open the game with
import { SHORT_COMMIT } from '../shared/version';
// ?debug and a log appears at the bottom of the page, with a Copy button.
// It stays on for the tab until it's closed.
//
// The last few hundred lines are also kept on the device (even without
// ?debug), so a problem seen in normal play still shows up when the log is
// opened afterwards, across reloads. Nothing leaves the device.

const KEY = 'letterly:v1:debug';
const LOG_KEY = 'letterly:v1:debuglog';
const MAX_LINES = 400;
const lines: string[] = loadLines();

function loadLines(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.slice(-MAX_LINES) : [];
  } catch {
    return [];
  }
}

let saveTimer = 0;
function saveLines() {
  if (saveTimer) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(lines.slice(-MAX_LINES)));
    } catch {
      /* storage full or blocked */
    }
  }, 200);
}
let pre: HTMLPreElement | null = null;

function enabled(): boolean {
  try {
    if (new URLSearchParams(location.search).has('debug')) sessionStorage.setItem(KEY, '1');
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return new URLSearchParams(location.search).has('debug');
  }
}

const on = enabled();

/** Adds a line to the debug panel (and the console). */
export function debugLog(...parts: unknown[]) {
  const text = parts
    .map((p) => (p instanceof Error ? `${p.name}: ${p.message}` : typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ');
  console.debug('[letterle]', text);
  const t = new Date().toISOString().slice(11, 19);
  lines.push(`${t} ${text}`);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  saveLines();
  if (pre) pre.textContent = lines.join('\n');
}

export function initDebug() {
  // Each page load starts with a marker, so earlier visits are easy to tell apart.
  debugLog(`--- page load, version ${SHORT_COMMIT} ---`);
  if (!on) return;
  const panel = document.createElement('details');
  panel.className = 'debug-panel';
  panel.open = true;
  const summary = document.createElement('summary');
  summary.textContent = 'Debug log';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.addEventListener('click', () => void navigator.clipboard?.writeText(lines.join('\n')).catch(() => undefined));
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Turn off';
  close.addEventListener('click', () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    panel.remove();
  });
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Clear';
  clear.addEventListener('click', () => {
    lines.length = 0;
    saveLines();
    if (pre) pre.textContent = '';
  });
  summary.append(' ', copy, ' ', clear, ' ', close);
  pre = document.createElement('pre');
  panel.append(summary, pre);
  document.body.append(panel);
  addEventListener('error', (e) => debugLog('error:', e.message, `${e.filename}:${e.lineno}`));
  addEventListener('unhandledrejection', (e) => debugLog('unhandled:', e.reason));
  debugLog('ua:', navigator.userAgent);
  debugLog('origin:', location.origin, 'standalone:', matchMedia('(display-mode: standalone)').matches);
  debugLog(
    'push support:',
    { sw: 'serviceWorker' in navigator, push: 'PushManager' in window, notif: 'Notification' in window },
    'permission:',
    'Notification' in window ? Notification.permission : 'n/a',
  );
  navigator.serviceWorker
    ?.getRegistration()
    .then((r) => debugLog('sw:', r ? { scope: r.scope, active: !!r.active, waiting: !!r.waiting } : 'none'));
}
