// A debug panel for phones, where there's no console: open the game with
// ?debug and a log appears at the bottom of the page, with a Copy button.
// It stays on for the tab until it's closed.

const KEY = 'letterly:v1:debug';
const lines: string[] = [];
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
  if (!on) return;
  const t = new Date().toISOString().slice(11, 19);
  lines.push(`${t} ${text}`);
  if (pre) pre.textContent = lines.join('\n');
}

export function initDebug() {
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
  summary.append(' ', copy, ' ', close);
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
