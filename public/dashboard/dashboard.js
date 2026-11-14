// Letterle dashboard: real-user errors and Web Vitals from /api/v1/telemetry/summary.
// Signed in by Cloudflare Access when that's set up (ACCESS_TEAM and ACCESS_AUD);
// otherwise the key comes from the link (#key=...), so it never reaches server
// logs, and is remembered on this device. Charts are in charts.js. Built with DOM nodes only (the CSP has Trusted Types).

import { columnChart, dayLabel, dayRange, lineChart, sparkline, stackBars } from './charts.js';

const KEY = 'letterle:dashboard-key';
const $ = (id) => document.getElementById(id);
const VITALS = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'];
const LABELS = {
  LCP: 'Largest Contentful Paint',
  INP: 'Interaction to Next Paint',
  CLS: 'Cumulative Layout Shift',
  FCP: 'First Contentful Paint',
  TTFB: 'Time to First Byte',
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c instanceof Node ? c : String(c));
  return node;
}

function getKey() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('key');
  if (fromHash) {
    try {
      localStorage.setItem(KEY, fromHash);
    } catch {}
    history.replaceState(null, '', location.pathname);
    return fromHash;
  }
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const fmt = (name, v) =>
  v === null || v === undefined ? '–' : name === 'CLS' ? v.toFixed(2) : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;

function rating(name, v, thresholds) {
  const t = thresholds[name];
  if (!t || v === null || v === undefined) return '';
  return v <= t[0] ? 'good' : v <= t[1] ? 'ni' : 'poor';
}

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function table(headers, rows) {
  if (!rows.length) return el('div', { class: 'table-wrap' }, el('p', { class: 'empty' }, 'Nothing yet.'));
  return el(
    'div',
    { class: 'table-wrap' },
    el('table', {}, el('thead', {}, el('tr', {}, headers.map((h) => el('th', {}, h)))), el('tbody', {}, rows)),
  );
}

function vitalsCards(data) {
  const box = $('vitals');
  box.replaceChildren(
    ...VITALS.map((name) => {
      const v = data.vitals[name];
      const r = rating(name, v?.p75, data.thresholds);
      const count = v?.count ?? 0;
      const good = count ? (v.good / count) * 100 : 0;
      const poor = count ? (v.poor / count) * 100 : 0;
      return el(
        'div',
        { class: 'card', title: LABELS[name] },
        el('div', { class: 'name' }, name, el('span', { class: r }, r === 'ni' ? 'needs work' : r)),
        el('div', { class: `value ${r}` }, fmt(name, v?.p75)),
        el('div', { class: 'meta' }, `${count} visits · ${Math.round(good)}% good · ${Math.round(poor)}% poor`),
        el(
          'div',
          { class: 'bar', 'aria-hidden': 'true' },
          el('span', { class: 'bg-good', style: `width:${good}%` }),
          el('span', { class: 'bg-ni', style: `width:${count ? 100 - good - poor : 0}%` }),
          el('span', { class: 'bg-poor', style: `width:${poor}%` }),
        ),
        trend(name, data),
      );
    }),
  );
}

/** The vital's 75th percentile per day, against the "good" line. */
function trend(name, data) {
  const days = dayRange(Math.min(data.days, 30));
  return sparkline(days.map((d) => data.vitalsByDay[d]?.[name]?.p75 ?? null), data.thresholds[name]?.[0]);
}

function vitalsTable(id, groups, data, sortKeys) {
  const keys = sortKeys ? Object.keys(groups).sort(sortKeys) : Object.keys(groups).sort((a, b) => count(groups[b]) - count(groups[a]));
  function count(g) {
    return Math.max(0, ...VITALS.map((n) => g[n]?.count ?? 0));
  }
  $(id).replaceChildren(
    table(
      ['', ...VITALS, 'Visits'],
      keys.map((k) =>
        el(
          'tr',
          {},
          el('td', {}, k),
          VITALS.map((n) => {
            const v = groups[k][n]?.p75;
            return el('td', { class: `num ${rating(n, v, data.thresholds)}` }, fmt(n, v));
          }),
          el('td', { class: 'num' }, count(groups[k])),
        ),
      ),
    ),
  );
}

function problems(data) {
  $('problems').replaceChildren(
    table(
      ['What', 'Count', 'Last seen', 'Where'],
      data.problems.map((p) =>
        el(
          'tr',
          {},
          el(
            'td',
            {},
            el('span', { class: 'kind' }, p.kind),
            ' ',
            el('strong', {}, p.name),
            el('div', {}, p.message ?? ''),
            p.sample ? el('details', {}, el('summary', {}, 'details'), el('pre', {}, pretty(p.sample))) : null,
          ),
          el('td', { class: 'num' }, p.count),
          el('td', { class: 'num' }, ago(p.last)),
          el(
            'td',
            {},
            [p.browsers, p.pages, p.commits && `version ${String(p.commits).split(',').map((c) => c.slice(0, 7)).join(', ')}`]
              .filter(Boolean)
              .join(' · '),
          ),
        ),
      ),
    ),
  );
}

function pretty(s) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

const PROBLEM_KINDS = new Set(['error', 'rejection', 'csp', 'report', 'server', 'resource']);

function problemsChart(data) {
  const days = dayRange(Math.min(data.days, 30));
  const per = {};
  for (const r of data.volume) if (PROBLEM_KINDS.has(r.kind)) (per[r.day] ??= {})[r.kind] = r.count;
  if (days.length < 2) return $('problems-chart').replaceChildren();
  columnChart($('problems-chart'), {
    bars: days.map((d) => {
      const kinds = Object.entries(per[d] ?? {}).sort((a, b) => b[1] - a[1]);
      const value = kinds.reduce((t, [, n]) => t + n, 0);
      return {
        label: dayLabel(d),
        value,
        cls: 'poor',
        tip: [el('b', {}, `${dayLabel(d)}: ${value} problems`), ...kinds.map(([k, n]) => el('div', {}, `${k} `, el('strong', {}, n)))],
      };
    }),
  });
}

function volume(data) {
  const days = {};
  for (const r of data.volume) (days[r.day] ??= {})[r.kind] = r.count;
  const kinds = [...new Set(data.volume.map((r) => r.kind))].sort();
  $('volume').replaceChildren(
    table(
      ['Day', ...kinds],
      Object.keys(days)
        .sort()
        .reverse()
        .map((d) => el('tr', {}, el('td', {}, d), kinds.map((k) => el('td', { class: 'num' }, days[d][k] ?? 0)))),
    ),
  );
}

// ---------------------------------------------------------------- usage

const n0 = (v) => (v === null || v === undefined ? 0 : Number(v));
const pct = (a, b) => (b ? `${Math.round((n0(a) / b) * 100)}%` : '–');
const dec = (v, d = 1) => (v === null || v === undefined ? '–' : Number(v).toFixed(d));
const secs = (v) => (v === null || v === undefined ? '–' : v >= 60 ? `${Math.floor(v / 60)}m ${Math.round(v % 60)}s` : `${Math.round(v)}s`);

/** A count with a small bar, scaled to the largest in its table. */
function barCell(n, max) {
  return el('td', { class: 'num' }, el('div', { class: 'hbar' }, el('i', { style: `width:${max ? Math.max(2, (n / max) * 80) : 0}px` }), String(n)));
}

function breakdown(id, rows, label = 'Visits') {
  const max = Math.max(0, ...rows.map((r) => n0(r.n)));
  $(id).replaceChildren(
    table(
      ['', label, ...(rows.some((r) => r.visitors !== undefined) ? ['Visitors'] : [])],
      rows.map((r) =>
        el('tr', {}, el('td', {}, String(r.k)), barCell(n0(r.n), max), r.visitors !== undefined ? el('td', { class: 'num' }, r.visitors) : null),
      ),
    ),
  );
}

function card(name, value, meta) {
  return el('div', { class: 'card' }, el('div', { class: 'name' }, name), el('div', { class: 'value' }, value), meta ? el('div', { class: 'meta' }, meta) : null);
}

function usageSection(u) {
  const sum = (k) => u.daily.reduce((t, d) => t + n0(d[k]), 0);
  const won = sum('won');
  const finished = sum('finished');
  const wonGuesses = u.daily.reduce((t, d) => t + n0(d.avgGuesses) * n0(d.won), 0);
  $('live').replaceChildren(
    el('span', { class: 'live' }, `● ${n0(u.live.visitors)} on now`),
    el('span', {}, `${n0(u.live.sessions)} sessions in the last 5 minutes`),
  );
  $('totals').replaceChildren(
    card('Visitors', sum('visitors'), 'daily visitors, added up'),
    card('Sessions', sum('sessions')),
    card('Page views', sum('pageviews')),
    card('Games started', sum('started')),
    card('Games finished', finished, `${pct(finished, sum('started'))} of started`),
    card('Win rate', pct(won, finished), `avg ${won ? (wonGuesses / won).toFixed(2) : '–'} guesses`),
    card('Races', sum('races')),
    card('Shares', sum('shares')),
    card('Installs', sum('installs')),
    card('Time per visit', secs(u.engagement.avg), `${n0(u.engagement.n)} visits measured`),
  );
  $('daily').replaceChildren(
    table(
      ['Day', 'Visitors', 'Sessions', 'Views', 'Started', 'Finished', 'Daily', 'Unlimited', 'Won', 'Avg guesses', 'Races', 'Shares', 'Installs', 'Time/visit'],
      u.daily.map((d) =>
        el(
          'tr',
          {},
          el('td', {}, d.day),
          ['visitors', 'sessions', 'pageviews', 'started', 'finished', 'daily', 'unlimited'].map((k) => el('td', { class: 'num' }, n0(d[k]))),
          el('td', { class: 'num' }, `${n0(d.won)} (${pct(d.won, n0(d.finished))})`),
          el('td', { class: 'num' }, dec(d.avgGuesses, 2)),
          ['races', 'shares', 'installs'].map((k) => el('td', { class: 'num' }, n0(d[k]))),
          el('td', { class: 'num' }, secs(d.engaged)),
        ),
      ),
    ),
  );
  usageCharts(u);
  const f = u.funnel;
  const steps = [
    ['Opened the game', f.visited],
    ['Started a game', f.started],
    ['Finished a game', f.finished],
    ['Won a game', f.won],
    ['Shared a result', f.shared],
  ];
  const top = n0(f.visited);
  $('funnel').replaceChildren(
    table(
      ['Step', 'Sessions', 'Of opened'],
      steps.map(([label, v]) => el('tr', {}, el('td', {}, label), barCell(n0(v), top), el('td', { class: 'num' }, pct(v, top)))),
    ),
  );
  $('games').replaceChildren(
    table(
      ['Mode', 'Language', 'Started', 'Finished', 'Won', 'Win rate', 'Avg guesses', 'Players'],
      u.games.map((g) => {
        const started = u.starts.filter((s) => s.mode === g.mode && s.lang === g.lang).reduce((t, s) => t + n0(s.n), 0);
        return el(
          'tr',
          {},
          el('td', {}, `${g.mode}${g.hard ? ' (hard)' : ''}`),
          el('td', {}, g.lang),
          el('td', { class: 'num' }, g.hard ? '' : started),
          el('td', { class: 'num' }, g.games),
          el('td', { class: 'num' }, g.won),
          el('td', { class: 'num' }, pct(g.won, n0(g.games))),
          el('td', { class: 'num' }, dec(g.avgGuesses, 2)),
          el('td', { class: 'num' }, g.visitors),
        );
      }),
    ),
  );
  breakdown('guesses', u.guesses.map((r) => ({ k: r.k === 'X' ? 'Lost' : `${r.k}`, n: r.n })), 'Games');
  $('races').replaceChildren(
    table(['', 'Count', 'Avg players'], u.races.map((r) => el('tr', {}, el('td', {}, r.k), el('td', { class: 'num' }, r.n), el('td', { class: 'num' }, r.k === 'created' ? '' : dec(r.avgPlayers))))),
  );
  for (const [id, key] of [
    ['referrers', 'referrers'],
    ['campaigns', 'campaigns'],
    ['launch', 'launch'],
    ['pages', 'pages'],
    ['countries', 'countries'],
    ['languages', 'languages'],
    ['browsers', 'browsers'],
    ['devices', 'devices'],
    ['installed', 'installed'],
    ['screens', 'screens'],
    ['connection', 'connection'],
  ]) {
    breakdown(id, (u[key] ?? []).map((r) => (r.k === '(none)' && key === 'referrers' ? { ...r, k: 'direct or unknown' } : r)));
  }
  breakdown('theme', [...u.theme, ...u.reducedMotion.map((r) => ({ ...r, k: `motion: ${r.k}` }))]);
  breakdown('actions', u.actions, 'Times');
  breakdown('action-details', u.actionDetails, 'Times');
  const e = u.engagement;
  breakdown(
    'engagement',
    [
      { k: 'under 10 seconds', n: n0(e.under10s) },
      { k: '10 to 60 seconds', n: n0(e.under1m) },
      { k: '1 to 5 minutes', n: n0(e.under5m) },
      { k: 'over 5 minutes', n: n0(e.over5m) },
    ],
  );
  breakdown('reminders', u.reminders.map((r) => ({ k: `word language ${r.k}`, n: r.n })), 'Subscribers');
  const maxHour = Math.max(0, ...u.hours.map((h) => n0(h.pageviews)));
  $('hours').replaceChildren(
    table(
      ['Hour', 'Page views', 'Games'],
      u.hours.map((h) => el('tr', {}, el('td', {}, `${String(h.hour).padStart(2, '0')}:00`), barCell(n0(h.pageviews), maxHour), el('td', { class: 'num' }, n0(h.games)))),
    ),
  );
}

function usageCharts(u) {
  const days = dayRange(u.daily.length ? Number($('days').value) : 0);
  const byDay = Object.fromEntries(u.daily.map((d) => [d.day, d]));
  const col = (k) => days.map((d) => n0(byDay[d]?.[k]));
  const labels = days.map(dayLabel);
  if (days.length > 1) {
    lineChart($('daily-chart'), {
      labels,
      series: [
        { name: 'Visitors', cls: 's1', values: col('visitors') },
        { name: 'Started', cls: 's2', values: col('started') },
        { name: 'Finished', cls: 's3', values: col('finished') },
      ],
    });
    lineChart($('winrate-chart'), {
      labels,
      yMax: 100,
      H: 130,
      fmtY: (v) => `${v}%`,
      fmtV: (v) => `${Math.round(v)}%`,
      series: [{ name: 'Won', cls: 's1', values: days.map((d) => (n0(byDay[d]?.finished) ? (n0(byDay[d].won) / n0(byDay[d].finished)) * 100 : null)) }],
    });
  } else {
    $('daily-chart').replaceChildren();
    $('winrate-chart').replaceChildren();
  }

  // Finished games per word language, won and not won.
  const langs = {};
  for (const g of u.games) {
    const l = (langs[g.lang] ??= { won: 0, games: 0 });
    l.won += n0(g.won);
    l.games += n0(g.games);
  }
  stackBars(
    $('lang-chart'),
    Object.entries(langs)
      .sort((a, b) => b[1].games - a[1].games)
      .map(([lang, l]) => ({ label: lang.toUpperCase(), parts: [l.won, l.games - l.won], note: `${l.games} · ${pct(l.won, l.games)} won` })),
    [
      { name: 'Won', cls: 's1' },
      { name: 'Not won', cls: 'rest' },
    ],
  );

  const total = u.guesses.reduce((t, r) => t + n0(r.n), 0);
  const g = Object.fromEntries(u.guesses.map((r) => [String(r.k), n0(r.n)]));
  const tries = Math.max(6, ...Object.keys(g).filter((k) => k !== 'X').map(Number));
  columnChart($('guesses-chart'), {
    valueLabels: true,
    every: 1,
    bars: [...Array.from({ length: tries }, (_, i) => String(i + 1)), 'X'].map((k) => ({
      label: k === 'X' ? 'Lost' : k,
      value: g[k] ?? 0,
      cls: k === 'X' ? 'rest' : 's1',
      tip: [el('b', {}, k === 'X' ? 'Lost' : `Won in ${k}`), el('div', {}, el('strong', {}, g[k] ?? 0), ` games · ${pct(g[k], total)}`)],
    })),
  });

  const hours = Object.fromEntries(u.hours.map((h) => [h.hour, h]));
  columnChart($('hours-chart'), {
    every: 3,
    bars: Array.from({ length: 24 }, (_, h) => {
      const label = `${String(h).padStart(2, '0')}:00`;
      const r = hours[h];
      return {
        label,
        value: n0(r?.pageviews),
        tip: [el('b', {}, label), el('div', {}, 'Page views ', el('strong', {}, n0(r?.pageviews))), el('div', {}, 'Games ', el('strong', {}, n0(r?.games)))],
      };
    }),
  });
}

async function health() {
  try {
    const res = await fetch('/health', { cache: 'no-store' });
    const h = await res.json();
    $('health').replaceChildren(
      el('span', { class: h.status === 'ok' ? 'good' : 'poor' }, h.status === 'ok' ? '● Healthy' : `● ${h.status}`),
      el('span', {}, 'Live version ', el('a', { href: h.commitUrl, target: '_blank', rel: 'noopener' }, h.shortCommit)),
      el('span', {}, `Database ${h.checks.database} (${h.checks.databaseMs} ms)`),
      ...(h.built ? [el('span', {}, `Built ${new Date(h.built).toLocaleString()}`)] : []),
    );
  } catch (e) {
    $('health').replaceChildren(el('span', { class: 'poor' }, `● /health failed: ${e.message}`));
  }
}

/** Cloudflare Access signs in on a full page load, so reloading is the way back in. */
function needSignIn() {
  $('login').hidden = true;
  $('main').hidden = true;
  $('status').replaceChildren('Your sign-in has run out. ', el('a', { href: '/dashboard/', class: 'signin' }, 'Sign in again'));
}

async function load() {
  // With Cloudflare Access in front, no key is needed; without it, the server asks for one.
  const key = getKey();
  $('status').textContent = 'Loading…';
  void health();
  const res = await fetch(`/api/v1/telemetry/summary?days=${$('days').value}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    cache: 'no-store',
    // An expired Access session answers with a redirect to Cloudflare's sign-in page.
    redirect: 'manual',
  }).catch(() => null);
  if (!res) {
    $('status').textContent = "Couldn't reach the server.";
    return;
  }
  if (res.type === 'opaqueredirect') return needSignIn();
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    if (body.error === 'access_required') return needSignIn();
    if (key) {
      try {
        localStorage.removeItem(KEY);
      } catch {}
    }
    $('login').hidden = false;
    $('main').hidden = true;
    $('status').textContent = key ? 'That key was not accepted.' : 'Open this page with your dashboard link, or paste the key.';
    return;
  }
  if (!res.ok) {
    $('status').textContent = `Couldn't load (${res.status}).`;
    return;
  }
  const data = await res.json();
  $('login').hidden = true;
  $('main').hidden = false;
  $('status').textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString()}`;
  if (data.usage) usageSection(data.usage);
  vitalsCards(data);
  problemsChart(data);
  problems(data);
  vitalsTable('by-day', data.vitalsByDay, data, (a, b) => b.localeCompare(a));
  vitalsTable('by-device', data.vitalsByDevice, data);
  vitalsTable('by-browser', data.vitalsByBrowser, data);
  vitalsTable('by-commit', data.vitalsByCommit, data);
  vitalsTable('by-page', data.vitalsByPage, data);
  volume(data);
}

$('login').addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    localStorage.setItem(KEY, $('key').value.trim());
  } catch {}
  void load();
});
$('refresh').addEventListener('click', () => void load());
$('days').addEventListener('change', () => void load());
void load();
