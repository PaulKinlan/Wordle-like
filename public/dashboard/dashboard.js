// Letterle dashboard: real-user errors and Web Vitals from /api/v1/telemetry/summary.
// The key comes from the link (#key=...), so it never reaches server logs, and
// is remembered on this device. Built with DOM nodes only (the CSP has Trusted Types).

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
      );
    }),
  );
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

async function health() {
  try {
    const res = await fetch('/health', { cache: 'no-store' });
    const h = await res.json();
    $('health').replaceChildren(
      el('span', { class: h.status === 'ok' ? 'good' : 'poor' }, h.status === 'ok' ? '● Healthy' : `● ${h.status}`),
      el('span', {}, 'Live version ', el('a', { href: h.commitUrl, target: '_blank', rel: 'noopener' }, h.shortCommit)),
      el('span', {}, `Database ${h.checks.database} (${h.checks.databaseMs} ms)`),
      h.built ? el('span', {}, `Built ${new Date(h.built).toLocaleString()}`) : null,
    );
  } catch (e) {
    $('health').replaceChildren(el('span', { class: 'poor' }, `● /health failed: ${e.message}`));
  }
}

async function load() {
  const key = getKey();
  if (!key) {
    $('login').hidden = false;
    $('main').hidden = true;
    $('status').textContent = 'Open this page with your dashboard link, or paste the key.';
    return;
  }
  $('status').textContent = 'Loading…';
  void health();
  const res = await fetch(`/api/v1/telemetry/summary?days=${$('days').value}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
  });
  if (res.status === 401) {
    try {
      localStorage.removeItem(KEY);
    } catch {}
    $('login').hidden = false;
    $('main').hidden = true;
    $('status').textContent = 'That key was not accepted.';
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
  vitalsCards(data);
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
