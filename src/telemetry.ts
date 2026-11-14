// Real-user monitoring, without third parties: errors, CSP violations,
// browser reports (deprecations, interventions) and Core Web Vitals, sent to
// our own Worker (worker/telemetry.ts) when the page is hidden. Nothing
// personal: no ids, no letters typed, page paths without query strings.
import { COMMIT } from '../shared/version';
import { debugLog } from './debug';

interface Event {
  kind: 'vital' | 'error' | 'rejection' | 'csp' | 'report' | 'resource' | 'pageview' | 'action';
  name: string;
  value?: number;
  message?: string;
  detail?: unknown;
}

const MAX_PER_PAGE = 60;
let enabled = false;

/** A random id for this tab's visit (sessionStorage, gone when the tab closes): counts sessions, nothing more. */
export const session = (() => {
  try {
    let id = sessionStorage.getItem('letterle:session');
    if (!id) {
      id = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem('letterle:session', id);
    }
    return id;
  } catch {
    return null;
  }
})();
/** The page this visit landed on, with shared-result and invite links grouped (they have ids in them). */
const landing = location.pathname.replace(/^\/s\/.*/, '/s/').replace(/^\/r\/.*/, '/r/');
let queue: Event[] = [];
let sentCount = 0;
const seen = new Set<string>();

function add(e: Event) {
  // The same error over and over only counts once per page load.
  const key = `${e.kind}|${e.name}|${e.message ?? ''}`;
  if (!enabled) return;
  if (e.kind !== 'vital' && e.kind !== 'action' && seen.has(key)) return;
  seen.add(key);
  if (sentCount + queue.length >= MAX_PER_PAGE) return;
  queue.push(e);
  debugLog('telemetry:', e.kind, e.name, e.value ?? e.message ?? '');
}

function flush() {
  if (!queue.length) return;
  const body = JSON.stringify({ commit: COMMIT, page: landing, session, events: queue });
  sentCount += queue.length;
  queue = [];
  try {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon?.('/api/v1/telemetry', blob)) return;
  } catch {
    /* fall through */
  }
  void fetch('/api/v1/telemetry', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(
    () => undefined,
  );
}

const stackTop = (stack?: string) => stack?.split('\n').slice(0, 5).join('\n');

function observe(type: string, cb: (entries: PerformanceEntry[]) => void, opts: Record<string, unknown> = {}) {
  try {
    const po = new PerformanceObserver((list) => cb(list.getEntries()));
    po.observe({ type, buffered: true, ...opts } as PerformanceObserverInit);
    return po;
  } catch {
    return null; // not supported in this browser
  }
}

/** Core Web Vitals, measured the same way as Google's web-vitals library (simplified). */
function watchVitals() {
  // TTFB and FCP are known early.
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav && nav.responseStart > 0) add({ kind: 'vital', name: 'TTFB', value: Math.round(nav.responseStart) });
  observe('paint', (entries) => {
    for (const e of entries) if (e.name === 'first-contentful-paint') add({ kind: 'vital', name: 'FCP', value: Math.round(e.startTime) });
  });

  // LCP: the last candidate before the first input or the page being hidden.
  let lcp = 0;
  let lcpEl = '';
  observe('largest-contentful-paint', (entries) => {
    const last = entries.at(-1) as PerformanceEntry & { element?: Element | null };
    if (!last) return;
    lcp = last.startTime;
    const el = last.element;
    lcpEl = el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList[0] ? `.${el.classList[0]}` : ''}` : '';
  });

  // CLS: the largest burst of layout shifts (gaps under 1s, at most 5s long).
  let cls = 0;
  let session = 0;
  let sessionStart = 0;
  let sessionLast = 0;
  observe('layout-shift', (entries) => {
    for (const e of entries as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
      if (e.hadRecentInput) continue;
      if (session && e.startTime - sessionLast < 1000 && e.startTime - sessionStart < 5000) session += e.value;
      else {
        session = e.value;
        sessionStart = e.startTime;
      }
      sessionLast = e.startTime;
      cls = Math.max(cls, session);
    }
  });

  // INP: the slowest interaction (close to the 98th percentile for a short visit).
  let inp = 0;
  let inpTarget = '';
  observe(
    'event',
    (entries) => {
      for (const e of entries as (PerformanceEntry & { interactionId?: number; target?: Element | null })[]) {
        if (!e.interactionId) continue;
        if (e.duration > inp) {
          inp = e.duration;
          inpTarget = `${e.name} ${e.target?.tagName.toLowerCase() ?? ''}${e.target?.id ? `#${e.target.id}` : ''}`;
        }
      }
    },
    { durationThreshold: 40 },
  );

  let reported = false;
  addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState !== 'hidden') return;
      if (!reported) {
        reported = true;
        if (lcp) add({ kind: 'vital', name: 'LCP', value: Math.round(lcp), detail: lcpEl ? { element: lcpEl } : undefined });
        add({ kind: 'vital', name: 'CLS', value: Math.round(cls * 1000) / 1000 });
        if (inp) add({ kind: 'vital', name: 'INP', value: Math.round(inp), detail: { target: inpTarget } });
      }
      flush();
    },
    true,
  );
  addEventListener('pagehide', flush, true);
}

function watchErrors() {
  addEventListener('error', (e) => {
    // A failed <img>/<script> fires error on the element, not the window.
    const t = e.target as Element | null;
    if (t && t !== (window as unknown) && 'tagName' in t) {
      add({ kind: 'resource', name: t.tagName.toLowerCase(), message: (t as HTMLImageElement).src || (t as HTMLLinkElement).href });
      return;
    }
    add({
      kind: 'error',
      name: e.error?.name ?? 'Error',
      message: e.message,
      detail: { at: `${e.filename}:${e.lineno}:${e.colno}`, stack: stackTop(e.error?.stack) },
    });
  }, true);
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    add({
      kind: 'rejection',
      name: r instanceof Error ? r.name : typeof r,
      message: r instanceof Error ? r.message : String(r).slice(0, 300),
      detail: r instanceof Error ? { stack: stackTop(r.stack) } : undefined,
    });
  });
  document.addEventListener('securitypolicyviolation', (e) => {
    // Our only Trusted Types policy is 'sw'. Any other name comes from a browser
    // extension or the browser itself (Safari's decodeHTMLEntitiesPolicy), not us.
    if (e.effectiveDirective === 'trusted-types' && e.sample !== 'sw') return;
    add({
      kind: 'csp',
      name: e.effectiveDirective,
      message: `${e.effectiveDirective} blocked ${e.blockedURI || 'inline'}`,
      detail: { source: `${e.sourceFile}:${e.lineNumber}`, sample: e.sample },
    });
  });
  // Deprecations and interventions the browser would only show in the console.
  const RO = (window as unknown as { ReportingObserver?: new (cb: (reports: { type: string; body: Record<string, unknown> }[]) => void, o: object) => { observe(): void } }).ReportingObserver;
  if (RO) {
    try {
      new RO(
        (reports) => {
          for (const r of reports) {
            add({
              kind: 'report',
              name: r.type,
              message: String(r.body?.message ?? r.body?.id ?? ''),
              detail: { id: r.body?.id, at: `${r.body?.sourceFile ?? ''}:${r.body?.lineNumber ?? ''}` },
            });
          }
        },
        { types: ['deprecation', 'intervention'], buffered: true },
      ).observe();
    } catch {
      /* unsupported */
    }
  }
}

/** How long the page was actually visible, sent each time it's hidden. */
function watchEngagement() {
  let visibleSince = document.visibilityState === 'visible' ? performance.now() : 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') visibleSince = performance.now();
    else if (visibleSince) {
      const seconds = Math.round((performance.now() - visibleSince) / 1000);
      visibleSince = 0;
      if (seconds > 0) add({ kind: 'action', name: 'engaged', value: Math.min(seconds, 3600) });
    }
  }, true); // capture: runs before the flush listener
}

/** One page view: where the visit came from, and how the app was opened. */
function pageview() {
  const params = new URLSearchParams(location.search);
  let ref: string | undefined;
  try {
    const r = document.referrer ? new URL(document.referrer) : null;
    ref = r && r.host !== location.host ? r.host : undefined;
  } catch {
    ref = undefined;
  }
  const installed = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches;
  add({
    kind: 'pageview',
    name: landing,
    detail: {
      ref,
      utm_source: params.get('utm_source') ?? undefined,
      utm_medium: params.get('utm_medium') ?? undefined,
      utm_campaign: params.get('utm_campaign') ?? undefined,
      launch:
        params.has('race') || landing === '/r/'
          ? 'race-invite'
          : landing === '/s/'
            ? 'shared-result'
            : (params.get('play') ?? (installed ? 'app' : 'web')),
      installed,
      langs: navigator.languages?.slice(0, 3),
      screen: `${screen.width}x${screen.height}`,
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      connection: (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType,
    },
  });
}

export function initTelemetry() {
  // Development builds don't report.
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
  enabled = true;
  watchErrors();
  watchVitals();
  watchEngagement();
  pageview();
  // Send the page view soon, not only when the page is hidden, so live counts work.
  setTimeout(flush, 3000);
}

/** A product event: a share, a setting changed, a race made... */
export function track(name: string, detail?: Record<string, unknown>, value?: number) {
  add({ kind: 'action', name, detail, value });
}

/** For errors the app catches itself but still wants to know about. */
export function reportError(where: string, e: unknown) {
  add({
    kind: 'error',
    name: e instanceof Error ? e.name : 'Error',
    message: `${where}: ${e instanceof Error ? e.message : String(e)}`,
    detail: e instanceof Error ? { stack: stackTop(e.stack) } : undefined,
  });
}
