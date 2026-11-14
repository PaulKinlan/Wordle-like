// A debug panel for phones, where there's no console: open the game with
// ?debug and a log appears at the bottom of the page, with a Copy button.
// It stays on for the tab until it's closed.
//
// The last few hundred lines are also kept on the device (even without
// ?debug), so a problem seen in normal play still shows up when the log is
// opened afterwards, across reloads. Nothing leaves the device.
import { SHORT_COMMIT } from '../shared/version';

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

// Two tabs (say a Custom Tab and Chrome itself) share storage: each save adds
// only its own new lines to what's stored, so neither wipes out the other.
const pending: string[] = [];
const TAB = Math.random().toString(36).slice(2, 5);
let saveTimer = 0;
function saveLines() {
  if (saveTimer) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    try {
      const stored = loadLines();
      stored.push(...pending.splice(0));
      localStorage.setItem(LOG_KEY, JSON.stringify(stored.slice(-MAX_LINES)));
    } catch {
      /* storage full or blocked */
    }
  }, 200);
}
let pre: HTMLPreElement | null = null;
let title: HTMLSpanElement | null = null;

function render() {
  if (title) title.textContent = `Debug log (${lines.length})`;
  if (!pre) return;
  const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
  pre.textContent = lines.join('\n');
  if (atEnd) pre.scrollTop = pre.scrollHeight;
}

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
  const line = `${t} [${SHORT_COMMIT} ${TAB}] ${text}`;
  lines.push(line);
  pending.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  saveLines();
  render();
}

export function initDebug() {
  // Each page load starts with a marker, so earlier visits are easy to tell apart.
  debugLog(`--- page load, version ${SHORT_COMMIT} ---`);
  if (!on) return;
  const panel = document.createElement('details');
  panel.className = 'debug-panel';
  // Starts folded to one small bar, so it never covers the board. The Show
  // button (not the whole bar) opens it, so a stray tap doesn't.
  panel.open = false;
  const summary = document.createElement('summary');
  summary.addEventListener('click', (e) => e.preventDefault());
  title = document.createElement('span');
  title.className = 'debug-title';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = 'Show';
  toggle.addEventListener('click', () => {
    panel.open = !panel.open;
    toggle.textContent = panel.open ? 'Hide' : 'Show';
    if (panel.open && pre) pre.scrollTop = pre.scrollHeight;
  });
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy';
  // Copy what's stored, so lines from other tabs are included too.
  copy.addEventListener('click', () => {
    let all = lines;
    try {
      all = [...loadLines(), ...pending];
    } catch {
      /* use this tab's lines */
    }
    void navigator.clipboard
      ?.writeText(all.join('\n'))
      .then(() => {
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy'), 1500);
      })
      .catch(() => undefined);
  });
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
    pending.length = 0;
    try {
      localStorage.removeItem(LOG_KEY);
    } catch {
      /* ignore */
    }
    render();
  });
  summary.append(title, toggle, copy, clear, close);
  pre = document.createElement('pre');
  panel.append(summary, pre);
  render();
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
