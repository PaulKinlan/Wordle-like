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
// Visitors are counted the way privacy-first analytics do it: a hash of
// IP + user agent + a random salt that changes every day and is then
// deleted, so a visitor can be counted within a day but never followed
// across days, and the hash can't be turned back into an IP. No cookies.
import { BUILT, COMMIT, COMMIT_URL, REPO_URL } from '../shared/version';
import { BadBody, readText } from './http';

export interface TelemetryEnv {
  DB: D1Database;
  /** Optional: a fixed key for the dashboard instead of the generated one. */
  DASHBOARD_KEY?: string;
}

type Json = (body: unknown, init?: ResponseInit & { cache?: string }) => Response;
type ErrorFn = (status: number, code: string, message: string) => Response;

/** Errors and Web Vitals are kept 30 days; usage (visits, games, actions) 13 months, for year-on-year trends. */
export const RETENTION_DAYS = 30;
export const USAGE_RETENTION_DAYS = 400;
const USAGE_KINDS = "('pageview', 'action', 'game', 'game_start', 'race')";
const PROBLEM_KINDS = "('error', 'rejection', 'csp', 'report', 'server', 'resource')";
const MAX_BODY = 32 * 1024;
const MAX_EVENTS = 40;
const KINDS = new Set(['vital', 'error', 'rejection', 'csp', 'report', 'server', 'resource', 'pageview', 'action']);
/** Kinds only the Worker records (clients can't send these). */
const SERVER_KINDS = new Set(['server', 'game', 'game_start', 'race']);
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
        device TEXT,
        visitor TEXT,
        session TEXT,
        country TEXT
      )`,
    ),
    db.prepare('CREATE INDEX IF NOT EXISTS telemetry_at ON telemetry (at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS telemetry_kind ON telemetry (kind, name, at)'),
    db.prepare('CREATE TABLE IF NOT EXISTS app_config (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
  ]);
  // Tables made by an earlier version lack the usage columns.
  const cols = await db.prepare('PRAGMA table_info(telemetry)').all<{ name: string }>();
  const have = new Set((cols.results ?? []).map((c) => c.name));
  for (const c of ['visitor', 'session', 'country']) {
    if (!have.has(c)) await db.prepare(`ALTER TABLE telemetry ADD COLUMN ${c} TEXT`).run();
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS telemetry_usage ON telemetry (at, kind) WHERE kind IN ('pageview', 'action', 'game', 'game_start', 'race')").run();
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

/** A random salt for today (UTC), made on first use; old ones are deleted by the cron. */
let salt: { day: string; value: string } | undefined;

async function dailySalt(db: D1Database, day: string): Promise<string> {
  // Read from D1 once a day per running Worker, not on every event.
  if (salt?.day === day) return salt.value;
  const value = await storedSalt(db, day);
  salt = { day, value };
  return value;
}

async function storedSalt(db: D1Database, day: string): Promise<string> {
  const fresh = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await db.prepare('INSERT OR IGNORE INTO app_config (k, v) VALUES (?1, ?2)').bind(`salt:${day}`, fresh).run();
  return (await db.prepare('SELECT v FROM app_config WHERE k = ?1').bind(`salt:${day}`).first<{ v: string }>())!.v;
}

/** Today's anonymous visitor id for this request (see the note at the top). */
export async function visitorId(db: D1Database, request: Request): Promise<string | null> {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return null;
  await ensureTelemetryTables(db);
  const day = new Date().toISOString().slice(0, 10);
  const salt = await dailySalt(db, day);
  const data = new TextEncoder().encode(`${salt}|${ip}|${request.headers.get('User-Agent') ?? ''}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const country = (request: Request) => {
  const c = (request as Request & { cf?: { country?: string } }).cf?.country;
  return typeof c === 'string' && /^[A-Z]{2}$/.test(c) ? c : null;
};

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
  visitor?: string | null;
  session?: string | null;
  country?: string | null;
}

async function insert(db: D1Database, rows: Row[], now = Date.now()) {
  if (!rows.length) return;
  await ensureTelemetryTables(db);
  const stmt = db.prepare(
    `INSERT INTO telemetry (at, kind, name, value, rating, message, detail, page, commit_sha, browser, device, visitor, session, country)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  );
  await db.batch(
    rows.map((r) =>
      stmt.bind(
        now,
        r.kind,
        r.name,
        r.value,
        r.rating,
        r.message,
        r.detail,
        r.page,
        r.commit,
        r.browser,
        r.device,
        r.visitor ?? null,
        r.session ?? null,
        r.country ?? null,
      ),
    ),
  );
}

export interface UsageEvent {
  kind: string;
  name: string;
  value?: number | null;
  rating?: string | null;
  message?: string | null;
  detail?: unknown;
}

/** A usage event the Worker sees itself: a game started or finished, a race, ... */
export async function recordEvent(db: D1Database, request: Request | null, e: UsageEvent) {
  const ua = request?.headers.get('User-Agent') ?? null;
  await insert(db, [
    {
      kind: e.kind,
      name: e.name,
      value: e.value ?? null,
      rating: e.rating ?? null,
      message: e.message ?? null,
      detail: e.detail === undefined ? null : JSON.stringify(e.detail).slice(0, 2000),
      page: null,
      browser: request ? browserFamily(ua) : 'server',
      device: request ? deviceClass(ua) : 'server',
      commit: COMMIT,
      visitor: request ? await visitorId(db, request).catch(() => null) : null,
      session: request?.headers.get('X-Session')?.slice(0, 20) ?? null,
      country: request ? country(request) : null,
    },
  ]).catch((err) => console.error('recordEvent failed', err));
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
  try {
    return await readText(request, MAX_BODY);
  } catch (e) {
    if (e instanceof BadBody) return null;
    throw e;
  }
}

let generatedKey: string | undefined;

/** The dashboard key: a secret if set, otherwise one made on first use and kept in D1. */
export async function dashboardKey(env: TelemetryEnv): Promise<string> {
  if (env.DASHBOARD_KEY) return env.DASHBOARD_KEY;
  // Wrong guesses at the key shouldn't cost a database write each.
  if (generatedKey) return generatedKey;
  await ensureTelemetryTables(env.DB);
  const fresh = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare("INSERT OR IGNORE INTO app_config (k, v) VALUES ('dashboard_key', ?)").bind(fresh).run();
  const row = await env.DB.prepare("SELECT v FROM app_config WHERE k = 'dashboard_key'").first<{ v: string }>();
  generatedKey = row!.v;
  return generatedKey;
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
    let body: { commit?: unknown; page?: unknown; session?: unknown; events?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      return error(400, 'bad_request', 'Expected JSON');
    }
    if (!body || typeof body !== 'object') return error(400, 'bad_request', 'Expected JSON');
    const page = pagePath(body.page, url.host);
    const commit = str(body.commit, 40) ?? 'unknown';
    const who = {
      visitor: await visitorId(env.DB, request).catch(() => null),
      session: str((body as { session?: unknown }).session, 20),
      country: country(request),
    };
    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
    const rows: Row[] = [];
    for (const raw of events as Record<string, unknown>[]) {
      const kind = str(raw?.kind, 20);
      const name = str(raw?.name, 80);
      if (!kind || !KINDS.has(kind) || !name || SERVER_KINDS.has(kind)) continue;
      const value = num(raw.value);
      if (kind === 'vital' && (!VITALS.has(name) || value === null || value < 0)) continue;
      rows.push({
        ...base,
        ...who,
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
    const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
    const rows: Row[] = reports.filter(isObject).slice(0, MAX_EVENTS).map((r) => {
      const b = isObject(r.body) ? r.body : {};
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
    // Errors and vitals only go back 30 days; usage goes back 13 months.
    const days = Math.min(USAGE_RETENTION_DAYS, Math.max(1, Number(url.searchParams.get('days')) || 7));
    const [health, use] = await Promise.all([summary(env.DB, Math.min(days, RETENTION_DAYS)), usage(env.DB, days)]);
    return json({ ...health, days, usage: use });
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
         FROM telemetry WHERE kind IN ${PROBLEM_KINDS} AND at >= ?1
         GROUP BY kind, name, message ORDER BY count DESC LIMIT 100`,
      )
      .bind(since),
    db
      .prepare(
        `SELECT date(at / 1000, 'unixepoch') AS day, kind, COUNT(*) AS count
         FROM telemetry WHERE at >= ?1 AND kind NOT IN ${USAGE_KINDS} GROUP BY day, kind ORDER BY day`,
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

/**
 * Audience and product numbers, like a web analytics tool: visitors, sessions,
 * page views, where people came from, games played and won, races, shares...
 * Visitor ids change every day, so "visitors" over a period is the sum of
 * daily visitors (visitor-days), not unique people.
 */
export async function usage(db: D1Database, days: number) {
  await ensureTelemetryTables(db);
  const now = Date.now();
  const since = now - days * 86_400_000;
  const pv = (expr: string, limit = 25) =>
    db
      .prepare(
        `SELECT COALESCE(${expr}, '(none)') AS k, COUNT(*) AS n, COUNT(DISTINCT visitor) AS visitors
         FROM telemetry WHERE kind = 'pageview' AND at >= ?1 GROUP BY k ORDER BY n DESC LIMIT ${limit}`,
      )
      .bind(since);
  const q = (sql: string) => db.prepare(sql).bind(since);
  const queries = {
    live: db
      .prepare(
        `SELECT COUNT(DISTINCT visitor) AS visitors, COUNT(DISTINCT session) AS sessions
         FROM telemetry WHERE at >= ?1 AND kind IN ${USAGE_KINDS}`,
      )
      .bind(now - 5 * 60_000),
    daily: q(
      `SELECT date(at / 1000, 'unixepoch') AS day,
              COUNT(DISTINCT visitor) AS visitors,
              COUNT(DISTINCT session) AS sessions,
              SUM(kind = 'pageview') AS pageviews,
              SUM(kind = 'game_start') AS started,
              SUM(kind = 'game') AS finished,
              SUM(kind = 'game' AND rating = 'won') AS won,
              SUM(kind = 'game' AND name = 'daily') AS daily,
              SUM(kind = 'game' AND name = 'unlimited') AS unlimited,
              AVG(CASE WHEN kind = 'game' AND rating = 'won' THEN value END) AS avgGuesses,
              SUM(kind = 'race' AND name = 'started') AS races,
              SUM(kind = 'action' AND name = 'share') AS shares,
              SUM(kind = 'action' AND name = 'install_accepted') AS installs,
              AVG(CASE WHEN kind = 'action' AND name = 'engaged' THEN value END) AS engaged
       FROM telemetry WHERE at >= ?1 AND kind IN ${USAGE_KINDS}
       GROUP BY day ORDER BY day DESC`,
    ),
    funnel: q(
      `SELECT COUNT(DISTINCT CASE WHEN kind = 'pageview' THEN session END) AS visited,
              COUNT(DISTINCT CASE WHEN kind = 'game_start' THEN session END) AS started,
              COUNT(DISTINCT CASE WHEN kind = 'game' THEN session END) AS finished,
              COUNT(DISTINCT CASE WHEN kind = 'game' AND rating = 'won' THEN session END) AS won,
              COUNT(DISTINCT CASE WHEN kind = 'action' AND name = 'share' THEN session END) AS shared
       FROM telemetry WHERE at >= ?1 AND kind IN ${USAGE_KINDS} AND session IS NOT NULL`,
    ),
    referrers: pv("json_extract(detail, '$.ref')"),
    campaigns: pv(
      `NULLIF(TRIM(COALESCE(json_extract(detail, '$.utm_source'), '') || ' / ' || COALESCE(json_extract(detail, '$.utm_medium'), '') || ' / ' || COALESCE(json_extract(detail, '$.utm_campaign'), '')), '/  /')`,
    ),
    pages: pv('page'),
    countries: pv('country', 50),
    browsers: pv('browser'),
    devices: pv('device'),
    launch: pv("json_extract(detail, '$.launch')"),
    installed: pv("CASE json_extract(detail, '$.installed') WHEN 1 THEN 'installed app' ELSE 'browser tab' END"),
    languages: pv("json_extract(detail, '$.langs[0]')"),
    screens: pv("json_extract(detail, '$.screen')", 15),
    connection: pv("json_extract(detail, '$.connection')"),
    theme: pv("CASE json_extract(detail, '$.dark') WHEN 1 THEN 'dark' ELSE 'light' END"),
    reducedMotion: pv("CASE json_extract(detail, '$.reducedMotion') WHEN 1 THEN 'reduce' ELSE 'no preference' END"),
    games: q(
      `SELECT name AS mode, message AS lang, COALESCE(json_extract(detail, '$.hard'), 0) AS hard,
              COUNT(*) AS games, SUM(rating = 'won') AS won,
              AVG(CASE WHEN rating = 'won' THEN value END) AS avgGuesses, COUNT(DISTINCT visitor) AS visitors
       FROM telemetry WHERE kind = 'game' AND at >= ?1 GROUP BY mode, lang, hard ORDER BY games DESC`,
    ),
    starts: q(
      `SELECT name AS mode, message AS lang, COUNT(*) AS n
       FROM telemetry WHERE kind = 'game_start' AND at >= ?1 GROUP BY mode, lang`,
    ),
    guesses: q(
      `SELECT CASE WHEN rating = 'won' THEN CAST(value AS INTEGER) ELSE 'X' END AS k, COUNT(*) AS n
       FROM telemetry WHERE kind = 'game' AND at >= ?1 GROUP BY k ORDER BY k`,
    ),
    races: q(
      `SELECT name AS k, COUNT(*) AS n, AVG(value) AS avgPlayers
       FROM telemetry WHERE kind = 'race' AND at >= ?1 GROUP BY k ORDER BY n DESC`,
    ),
    actions: q(
      `SELECT name AS k, COUNT(*) AS n, COUNT(DISTINCT visitor) AS visitors
       FROM telemetry WHERE kind = 'action' AND name != 'engaged' AND at >= ?1 GROUP BY k ORDER BY n DESC`,
    ),
    actionDetails: q(
      `SELECT name || ' ' || detail AS k, COUNT(*) AS n
       FROM telemetry WHERE kind = 'action' AND detail IS NOT NULL AND at >= ?1 GROUP BY k ORDER BY n DESC LIMIT 40`,
    ),
    hours: q(
      `SELECT CAST(strftime('%H', at / 1000, 'unixepoch') AS INTEGER) AS hour,
              SUM(kind = 'pageview') AS pageviews, SUM(kind = 'game') AS games
       FROM telemetry WHERE at >= ?1 AND kind IN ('pageview', 'game') GROUP BY hour ORDER BY hour`,
    ),
    engagement: q(
      `SELECT COUNT(*) AS n, AVG(value) AS avg, SUM(value < 10) AS under10s, SUM(value >= 10 AND value < 60) AS under1m,
              SUM(value >= 60 AND value < 300) AS under5m, SUM(value >= 300) AS over5m
       FROM telemetry WHERE kind = 'action' AND name = 'engaged' AND at >= ?1`,
    ),
  };
  const names = Object.keys(queries) as (keyof typeof queries)[];
  const results = await db.batch(names.map((n) => queries[n]));
  const out = Object.fromEntries(names.map((n, i) => [n, results[i].results ?? []])) as Record<keyof typeof queries, Record<string, unknown>[]>;

  // Daily reminder subscribers (the table only exists once someone subscribes).
  let reminders: Record<string, unknown>[] = [];
  try {
    reminders = (await db.prepare('SELECT lang AS k, COUNT(*) AS n FROM push_subs GROUP BY lang ORDER BY n DESC').all()).results ?? [];
  } catch {
    /* no subscribers yet */
  }
  return { ...out, live: out.live[0] ?? {}, funnel: out.funnel[0] ?? {}, engagement: out.engagement[0] ?? {}, reminders };
}

/** Run from the hourly cron: drop data past the retention period. */
export async function pruneTelemetry(db: D1Database) {
  await ensureTelemetryTables(db);
  await db
    .prepare(`DELETE FROM telemetry WHERE at < ?1 AND kind NOT IN ${USAGE_KINDS}`)
    .bind(Date.now() - RETENTION_DAYS * 86_400_000)
    .run();
  await db.prepare('DELETE FROM telemetry WHERE at < ?1').bind(Date.now() - USAGE_RETENTION_DAYS * 86_400_000).run();
  // Yesterday's salt is no longer needed; deleting it makes old visitor ids unlinkable.
  const today = new Date().toISOString().slice(0, 10);
  await db.prepare("DELETE FROM app_config WHERE k LIKE 'salt:%' AND k < ?1").bind(`salt:${today}`).run();
}

let version: { commit: string; built: string } | undefined;

/**
 * The build this Worker belongs to. The deploy bundles the Worker without the
 * commit Vite defines (shared/version.ts then says "dev"), so it is read from
 * /version.json, which the same build writes beside the page.
 */
export async function buildVersion(assets: Fetcher | undefined, origin: string): Promise<{ commit: string; built: string }> {
  if (COMMIT !== 'dev') return { commit: COMMIT, built: BUILT };
  if (version) return version;
  try {
    const res = await assets!.fetch(new URL('/version.json', origin));
    const v = (await res.json()) as { commit?: unknown; built?: unknown };
    if (typeof v.commit === 'string' && /^[0-9a-f]{7,40}$/.test(v.commit)) {
      version = { commit: v.commit, built: typeof v.built === 'string' ? v.built : '' };
      return version;
    }
  } catch {
    // No file (a test, or a build without it): "dev" it is.
  }
  return { commit: COMMIT, built: BUILT };
}

export async function health(db: D1Database, json: Json, assets?: Fetcher, origin = 'https://letterle.app'): Promise<Response> {
  const started = Date.now();
  const { commit, built } = await buildVersion(assets, origin);
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
      commit,
      shortCommit: commit === 'dev' ? 'dev' : commit.slice(0, 7),
      commitUrl: commit === 'dev' ? COMMIT_URL : `${REPO_URL}/commit/${commit}`,
      built,
      checks: { database, databaseMs: Date.now() - started },
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
