// Observability: what players' browsers report back, kept in D1 for 30 days.
//
//   POST /api/v1/telemetry          batches from src/telemetry.ts (errors, Web Vitals, ...)
//   POST /api/v1/reports            the browser's Reporting API (CSP, deprecations,
//                                   interventions, crashes) and legacy CSP reports
//   GET  /api/v1/telemetry/summary  the dashboard's data (needs the dashboard key)
//   GET  /health                    a quick health check, with the build's commit
//
// Nothing personal is stored: no IP address, no user agent string (only a
// browser family and device class), and page paths without query strings.
import { BUILT, COMMIT, COMMIT_URL, SHORT_COMMIT } from '../shared/version';

export interface TelemetryEnv {
  DB: D1Database;
  /** Optional: a fixed key for the dashboard instead of the generated one. */
  DASHBOARD_KEY?: string;
}

type Json = (body: unknown, init?: ResponseInit & { cache?: string }) => Response;
type ErrorFn = (status: number, code: string, message: string) => Response;

export const RETENTION_DAYS = 30;
const MAX_BODY = 32 * 1024;
const MAX_EVENTS = 40;
const KINDS = new Set(['vital', 'error', 'rejection', 'csp', 'report', 'server', 'resource']);
const VITALS = new Set(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']);

/** Google's thresholds: [good up to, needs improvement up to]. */
export const VITAL_THRESHOLDS: Record<string, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export function rate(name: string, value: number): 'good' | 'needs-improvement' | 'poor' | null {
  const t = VITAL_THRESHOLDS[name];
  if (!t) return null;
  return value <= t[0] ? 'good' : value <= t[1] ? 'needs-improvement' : 'poor';
}

let ready = false;

export async function ensureTelemetryTables(db: D1Database) {
  if (ready) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        value REAL,
        rating TEXT,
        message TEXT,
        detail TEXT,
        page TEXT,
        commit_sha TEXT,
        browser TEXT,
        device TEXT
      )`,
    ),
    db.prepare('CREATE INDEX IF NOT EXISTS telemetry_at ON telemetry (at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS telemetry_kind ON telemetry (kind, name, at)'),
    db.prepare('CREATE TABLE IF NOT EXISTS app_config (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
  ]);
  ready = true;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** "Chrome", "Safari", "Firefox", "Edge", "Samsung" or "Other": never the full user agent. */
export function browserFamily(ua: string | null): string {
  if (!ua) return 'Other';
  if (/SamsungBrowser/.test(ua)) return 'Samsung';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Other';
}

function deviceClass(ua: string | null): string {
  if (!ua) return 'unknown';
  if (/iPad|Tablet/.test(ua)) return 'tablet';
  return /Mobi|Android|iPhone/.test(ua) ? 'mobile' : 'desktop';
}

/** Only the path of one of our own pages, never a query or another site. */
function pagePath(raw: unknown, host: string): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw, `https://${host}`);
    return u.host === host ? u.pathname.slice(0, 100) : 'external';
  } catch {
    return null;
  }
}

/** Removes our own origin from stack traces and messages, so they group nicely. */
function tidy(text: string | null, origin: string): string | null {
  return text ? text.split(origin).join('') : text;
}

interface Row {
  kind: string;
  name: string;
  value: number | null;
  rating: string | null;
  message: string | null;
  detail: string | null;
  page: string | null;
  browser: string;
  device: string;
  commit: string;
}

async function insert(db: D1Database, rows: Row[], now = Date.now()) {
  if (!rows.length) return;
  await ensureTelemetryTables(db);
  const stmt = db.prepare(
    `INSERT INTO telemetry (at, kind, name, value, rating, message, detail, page, commit_sha, browser, device)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
  );
  await db.batch(
    rows.map((r) =>
      stmt.bind(now, r.kind, r.name, r.value, r.rating, r.message, r.detail, r.page, r.commit, r.browser, r.device),
    ),
  );
}

/** An error in the Worker itself, recorded like the browser's. */
export async function recordServerError(db: D1Database, request: Request, e: unknown) {
  const url = new URL(request.url);
  const err = e instanceof Error ? e : new Error(String(e));
  await insert(db, [
    {
      kind: 'server',
      name: err.name,
      value: null,
      rating: null,
      message: err.message.slice(0, 300),
      detail: JSON.stringify({ route: `${request.method} ${url.pathname}`, stack: err.stack?.split('\n').slice(0, 6).join('\n') }).slice(0, 2000),
      page: url.pathname.slice(0, 100),
      browser: browserFamily(request.headers.get('User-Agent')),
      device: deviceClass(request.headers.get('User-Agent')),
      commit: COMMIT,
    },
  ]).catch(() => undefined);
}

async function readBody(request: Request): Promise<string | null> {
  const len = Number(request.headers.get('Content-Length') ?? 0);
  if (len > MAX_BODY) return null;
  const text = await request.text();
  return text.length > MAX_BODY ? null : text;
}

/** The dashboard key: a secret if set, otherwise one made on first use and kept in D1. */
export async function dashboardKey(env: TelemetryEnv): Promise<string> {
  if (env.DASHBOARD_KEY) return env.DASHBOARD_KEY;
  await ensureTelemetryTables(env.DB);
  const fresh = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare("INSERT OR IGNORE INTO app_config (k, v) VALUES ('dashboard_key', ?)").bind(fresh).run();
  const row = await env.DB.prepare("SELECT v FROM app_config WHERE k = 'dashboard_key'").first<{ v: string }>();
  return row!.v;
}

function sameKey(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handleTelemetry(request: Request, env: TelemetryEnv, json: Json, error: ErrorFn): Promise<Response> {
  const url = new URL(request.url);
  const ua = request.headers.get('User-Agent');
  const base = { browser: browserFamily(ua), device: deviceClass(ua) };

  if (url.pathname === '/api/v1/telemetry' && request.method === 'POST') {
    // Our own pages only.
    const site = request.headers.get('Sec-Fetch-Site');
    if (site && site !== 'same-origin') return error(403, 'forbidden', 'Wrong origin');
    const text = await readBody(request);
    if (text === null) return error(413, 'too_big', 'Too much data');
    let body: { commit?: unknown; page?: unknown; events?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      return error(400, 'bad_request', 'Expected JSON');
    }
    const page = pagePath(body.page, url.host);
    const commit = str(body.commit, 40) ?? 'unknown';
    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
    const rows: Row[] = [];
    for (const raw of events as Record<string, unknown>[]) {
      const kind = str(raw?.kind, 20);
      const name = str(raw?.name, 80);
      if (!kind || !KINDS.has(kind) || !name || kind === 'server') continue;
      const value = num(raw.value);
      if (kind === 'vital' && (!VITALS.has(name) || value === null || value < 0)) continue;
      rows.push({
        ...base,
        kind,
        name,
        value,
        rating: kind === 'vital' ? rate(name, value!) : null,
        message: tidy(str(raw.message, 300), url.origin),
        detail: raw.detail === undefined ? null : tidy(JSON.stringify(raw.detail).slice(0, 2000), url.origin),
        page,
        commit,
      });
    }
    await insert(env.DB, rows);
    return new Response(null, { status: 204 });
  }

  if (url.pathname === '/api/v1/reports' && request.method === 'POST') {
    const text = await readBody(request);
    if (text === null) return new Response(null, { status: 413 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400 });
    }
    // Reporting API: an array of { type, url, body }. Legacy CSP: { "csp-report": {...} }.
    const reports: { type: string; url?: string; body: Record<string, unknown> }[] = Array.isArray(parsed)
      ? (parsed as { type: string; url?: string; body: Record<string, unknown> }[])
      : parsed && typeof parsed === 'object' && 'csp-report' in parsed
        ? [{ type: 'csp-violation', body: (parsed as Record<string, Record<string, unknown>>)['csp-report'] }]
        : [];
    const rows: Row[] = reports.slice(0, MAX_EVENTS).map((r) => {
      const b = r.body ?? {};
      const summary =
        str(b.message, 300) ??
        str(b.effectiveDirective ?? b['effective-directive'] ?? b.violatedDirective ?? b['violated-directive'], 100) ??
        str(b.reason, 300) ??
        str(b.id, 100);
      const blocked = str(b.blockedURL ?? b['blocked-uri'], 200);
      return {
        ...base,
        kind: 'report',
        name: str(r.type, 40) ?? 'unknown',
        value: null,
        rating: null,
        message: tidy(blocked ? `${summary ?? ''} ${blocked}`.trim() : summary, url.origin),
        detail: tidy(JSON.stringify(b).slice(0, 2000), url.origin),
        page: pagePath(r.url ?? b.documentURL ?? b['document-uri'], url.host),
        commit: 'unknown',
      };
    });
    await insert(env.DB, rows);
    return new Response(null, { status: 204 });
  }

  if (url.pathname === '/api/v1/telemetry/summary' && request.method === 'GET') {
    const auth = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!auth || !sameKey(auth, await dashboardKey(env))) return error(401, 'unauthorized', 'Wrong or missing key');
    const days = Math.min(30, Math.max(1, Number(url.searchParams.get('days')) || 7));
    return json(await summary(env.DB, days));
  }

  return error(404, 'not_found', 'Unknown API route');
}

/** 75th percentile, the value Web Vitals are judged on. */
export function p75(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.75) - 1)];
}

interface VitalRow {
  name: string;
  value: number;
  rating: string;
  page: string | null;
  browser: string;
  device: string;
  commit_sha: string;
  day: string;
}

export async function summary(db: D1Database, days: number) {
  await ensureTelemetryTables(db);
  const since = Date.now() - days * 86_400_000;
  const [vitalsRes, problemsRes, volumeRes] = await db.batch([
    db
      .prepare(
        `SELECT name, value, rating, page, browser, device, commit_sha, date(at / 1000, 'unixepoch') AS day
         FROM telemetry WHERE kind = 'vital' AND at >= ?1 ORDER BY at DESC LIMIT 50000`,
      )
      .bind(since),
    db
      .prepare(
        `SELECT kind, name, message, COUNT(*) AS count, MAX(at) AS last, MIN(at) AS first,
                GROUP_CONCAT(DISTINCT browser) AS browsers, GROUP_CONCAT(DISTINCT page) AS pages,
                GROUP_CONCAT(DISTINCT commit_sha) AS commits, MAX(detail) AS sample
         FROM telemetry WHERE kind != 'vital' AND at >= ?1
         GROUP BY kind, name, message ORDER BY count DESC LIMIT 100`,
      )
      .bind(since),
    db
      .prepare(
        `SELECT date(at / 1000, 'unixepoch') AS day, kind, COUNT(*) AS count
         FROM telemetry WHERE at >= ?1 GROUP BY day, kind ORDER BY day`,
      )
      .bind(since),
  ]);
  const vitals = (vitalsRes.results ?? []) as unknown as VitalRow[];

  const group = (key: (r: VitalRow) => string) => {
    const out: Record<string, Record<string, { p75: number | null; count: number; good: number; poor: number }>> = {};
    const buckets = new Map<string, VitalRow[]>();
    for (const r of vitals) {
      const k = `${key(r)}\u0000${r.name}`;
      const list = buckets.get(k) ?? [];
      list.push(r);
      buckets.set(k, list);
    }
    for (const [k, list] of buckets) {
      const [g, name] = k.split('\u0000');
      out[g] ??= {};
      out[g][name] = {
        p75: p75(list.map((r) => r.value)),
        count: list.length,
        good: list.filter((r) => r.rating === 'good').length,
        poor: list.filter((r) => r.rating === 'poor').length,
      };
    }
    return out;
  };

  return {
    days,
    generatedAt: new Date().toISOString(),
    commit: COMMIT,
    thresholds: VITAL_THRESHOLDS,
    vitals: group(() => 'all').all ?? {},
    vitalsByDay: group((r) => r.day),
    vitalsByDevice: group((r) => r.device),
    vitalsByBrowser: group((r) => r.browser),
    vitalsByPage: group((r) => r.page ?? 'unknown'),
    vitalsByCommit: group((r) => (r.commit_sha ?? 'unknown').slice(0, 7)),
    problems: problemsRes.results ?? [],
    volume: volumeRes.results ?? [],
  };
}

/** Run from the hourly cron: drop data past the retention period. */
export async function pruneTelemetry(db: D1Database) {
  await ensureTelemetryTables(db);
  await db.prepare('DELETE FROM telemetry WHERE at < ?1').bind(Date.now() - RETENTION_DAYS * 86_400_000).run();
}

export async function health(db: D1Database, json: Json): Promise<Response> {
  const started = Date.now();
  let database = 'ok';
  try {
    await db.prepare('SELECT 1').first();
  } catch {
    database = 'error';
  }
  const ok = database === 'ok';
  return json(
    {
      status: ok ? 'ok' : 'degraded',
      commit: COMMIT,
      shortCommit: SHORT_COMMIT,
      commitUrl: COMMIT_URL,
      built: BUILT,
      checks: { database, databaseMs: Date.now() - started },
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
