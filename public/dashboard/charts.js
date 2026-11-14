// Small SVG charts for the dashboard. No library, no inline styles in markup
// (the CSP has style-src 'self'): colors come from classes in dashboard.css,
// sizes from SVG attributes, and the tooltip is moved through the CSSOM.

const NS = 'http://www.w3.org/2000/svg';
const TALL = 180;
const PAD = { t: 12, r: 12, b: 24, l: 36 };

function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  n.append(...kids);
  return n;
}

function html(tag, cls, ...kids) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.append(...kids.filter((k) => k !== null && k !== undefined).map((k) => (k instanceof Node ? k : String(k))));
  return n;
}

/** A "nice" top for the y-axis, and the step between gridlines. */
function niceMax(v) {
  if (v <= 0) return [4, 1];
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw && (s >= 1 || mag < 1));
  return [Math.ceil(v / step) * step, step];
}

const short = (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(+v.toFixed(2)));

/** Days from the start of the period to today (UTC), so empty days show as 0. */
export function dayRange(days) {
  const out = [];
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  for (let i = days - 1; i >= 0; i--) out.push(new Date(today - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export const dayLabel = (d) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/**
 * Draws into `box` now and again whenever its width changes.
 * `draw(width)` returns { svg, slots, x0, x1, tip(i), mark(i) } for the hover layer.
 */
function mount(box, legend, draw) {
  let last = 0;
  const render = () => {
    const w = Math.round(box.clientWidth);
    if (!w || w === last) return;
    last = w;
    const c = draw(w);
    const tip = html('div', 'tip');
    tip.hidden = true;
    const plot = html('div', 'plot', c.svg, tip);
    box.replaceChildren(...(legend ? [legend] : []), plot);
    const move = (e) => {
      const r = c.svg.getBoundingClientRect();
      const x = e.clientX - r.left;
      const band = (c.x1 - c.x0) / c.slots;
      const i = Math.max(0, Math.min(c.slots - 1, c.band ? Math.floor((x - c.x0) / band) : Math.round((x - c.x0) / band)));
      c.mark(i);
      tip.replaceChildren(...c.tip(i));
      tip.hidden = false;
      const cx = c.band ? c.x0 + band * (i + 0.5) : c.x0 + band * i;
      tip.style.left = `${Math.min(Math.max(cx, 70), w - 70)}px`;
    };
    c.svg.addEventListener('pointermove', move);
    c.svg.addEventListener('pointerdown', move);
    c.svg.addEventListener('pointerleave', () => {
      tip.hidden = true;
      c.mark(-1);
    });
  };
  render();
  box.ro?.disconnect();
  box.ro = new ResizeObserver(render);
  box.ro.observe(box);
}

function axes(g, w, max, step, fmtY, H) {
  for (let v = 0; v <= max + 1e-9; v += step) {
    const y = PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
    g.append(
      svg('line', {
        class: v ? 'grid' : 'base',
        x1: PAD.l,
        x2: w - PAD.r,
        y1: y,
        y2: y,
      }),
    );
    g.append(svg('text', { class: 'axis', x: PAD.l - 6, y: y + 4, 'text-anchor': 'end' }, fmtY(v)));
  }
}

function xLabels(g, labels, xAt, every, h, right) {
  const last = labels.length - 1;
  labels.forEach((l, i) => {
    if (i !== last && (i % every || last - i < every)) return;
    // The last label ends at the plot's edge rather than running off it.
    const end = i === last && last > 0 && xAt(i) + 24 > right;
    g.append(
      svg(
        'text',
        {
          class: 'axis',
          x: end ? right : xAt(i),
          y: h - 6,
          'text-anchor': end ? 'end' : 'middle',
        },
        l,
      ),
    );
  });
}

export function legend(series) {
  if (series.length < 2) return null;
  return html('div', 'legend', ...series.map((s) => html('span', null, html('i', `sw ${s.cls}`), s.name)));
}

/**
 * Lines over x (days, usually). series: [{ name, cls, values }]. One y-axis only.
 * Each line is also named at its end, so color is never the only key.
 */
export function lineChart(box, { labels, series, fmtY = short, fmtV = String, yMax, H = TALL }) {
  const n = labels.length;
  const top = yMax ?? Math.max(0, ...series.flatMap((s) => s.values.filter((v) => v !== null)));
  const [max, step] = yMax ? [yMax, yMax / 4] : niceMax(top);
  const endRoom = series.length > 1 ? 64 : 0;
  mount(box, legend(series), (w) => {
    const x0 = PAD.l;
    const x1 = w - PAD.r - endRoom;
    const xAt = (i) => (n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1));
    const yAt = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
    const g = svg('g');
    axes(g, w - endRoom, max, step, fmtY, H);
    xLabels(g, labels, xAt, Math.max(1, Math.ceil(n / Math.max(2, Math.floor((x1 - x0) / 64)))), H, w - PAD.r);
    const ends = [];
    for (const s of series) {
      let d = '';
      s.values.forEach((v, i) => {
        if (v === null) return;
        d += `${d && s.values[i - 1] !== null ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
      });
      g.append(svg('path', { class: `line ${s.cls}`, d }));
      if (n <= 14)
        s.values.forEach(
          (v, i) =>
            v !== null &&
            g.append(
              svg('circle', {
                class: `dot ${s.cls}`,
                cx: xAt(i),
                cy: yAt(v),
                r: 3.5,
              }),
            ),
        );
      const li = s.values.findLastIndex((v) => v !== null);
      if (endRoom && li >= 0) ends.push({ s, y: yAt(s.values[li]) + 4 });
    }
    // Spread the end labels so they never sit on each other.
    ends
      .sort((a, b) => a.y - b.y)
      .forEach((e, i, all) => {
        if (i) e.y = Math.max(e.y, all[i - 1].y + 13);
        g.append(svg('text', { class: 'end', x: x1 + 8, y: e.y }, e.s.name));
      });
    const cross = svg('line', {
      class: 'cross',
      y1: PAD.t,
      y2: H - PAD.b,
      visibility: 'hidden',
    });
    g.append(cross);
    const root = svg('svg', { viewBox: `0 0 ${w} ${H}`, width: w, height: H, role: 'img' }, g);
    return {
      svg: root,
      x0,
      x1: n === 1 ? x1 : x1 + (x1 - x0) / (n - 1),
      slots: n,
      mark: (i) => {
        cross.setAttribute('visibility', i < 0 ? 'hidden' : 'visible');
        if (i >= 0) (cross.setAttribute('x1', xAt(i)), cross.setAttribute('x2', xAt(i)));
      },
      tip: (i) => [
        html('b', null, labels[i]),
        ...series.map((s) =>
          html(
            'div',
            null,
            series.length > 1 ? html('i', `sw ${s.cls}`) : null,
            `${s.name} `,
            html('strong', null, s.values[i] === null ? '–' : fmtV(s.values[i])),
          ),
        ),
      ],
    };
  });
}

/** One bar per slot. bars: [{ label, value, cls?, tip? }]. */
export function columnChart(box, { bars, fmtY = short, valueLabels = false, every, H = TALL }) {
  const n = bars.length;
  const [max, step] = niceMax(Math.max(0, ...bars.map((b) => b.value)));
  mount(box, null, (w) => {
    const x0 = PAD.l;
    const x1 = w - PAD.r;
    const band = (x1 - x0) / n;
    const bw = Math.max(2, Math.min(48, band - 2));
    const yAt = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
    const g = svg('g');
    axes(g, w, max, step, fmtY, H);
    const xAt = (i) => x0 + band * (i + 0.5);
    xLabels(
      g,
      bars.map((b) => b.label),
      xAt,
      every ?? Math.max(1, Math.ceil(n / Math.floor((x1 - x0) / 32))),
      H,
      x1,
    );
    const rects = bars.map((b, i) => {
      const y = yAt(b.value);
      const h = H - PAD.b - y;
      const x = xAt(i) - bw / 2;
      const r = Math.min(4, bw / 2, h);
      // Rounded at the data end only, square on the baseline.
      const d =
        h <= 0 ? '' : `M${x},${H - PAD.b}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${H - PAD.b}Z`;
      const p = svg('path', { class: `col ${b.cls ?? 's1'}`, d });
      g.append(p);
      if (valueLabels && b.value) g.append(svg('text', { class: 'val', x: xAt(i), y: y - 5, 'text-anchor': 'middle' }, short(b.value)));
      return p;
    });
    return {
      svg: svg('svg', { viewBox: `0 0 ${w} ${H}`, width: w, height: H, role: 'img' }, g),
      x0,
      x1,
      slots: n,
      band: true,
      mark: (i) => rects.forEach((r, j) => r.classList.toggle('dim', i >= 0 && j !== i)),
      tip: (i) => bars[i].tip ?? [html('b', null, bars[i].label), html('div', null, html('strong', null, bars[i].value))],
    };
  });
}

/** Horizontal stacked bars in HTML. rows: [{ label, parts: [n, ...], note }], parts named by `series`. */
export function stackBars(box, rows, series) {
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((a, b) => a + b, 0)));
  box.replaceChildren(
    legend(series) ?? '',
    ...rows.map((r) => {
      const track = html('div', 'track');
      r.parts.forEach((p, i) => {
        if (!p) return;
        const seg = html('i', `seg ${series[i].cls}`);
        seg.style.width = `${(p / max) * 100}%`;
        seg.title = `${series[i].name}: ${p}`;
        track.append(seg);
      });
      return html('div', 'srow', html('span', 'slabel', r.label), track, html('span', 'snote', r.note));
    }),
  );
}

/** A tiny trend line for a stat card, with a dashed "good" line. */
export function sparkline(values, good) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined);
  if (pts.length < 2) return null;
  const w = 160;
  const h = 36;
  const max = Math.max(good ?? 0, ...pts.map(([, v]) => v)) * 1.1 || 1;
  const x = (i) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v) => h - 2 - (v / max) * (h - 4);
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return svg(
    'svg',
    {
      class: 'spark',
      viewBox: `0 0 ${w} ${h}`,
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
    },
    good
      ? svg('line', {
          class: 'goodline',
          x1: 0,
          x2: w,
          y1: y(good),
          y2: y(good),
        })
      : '',
    svg('path', { class: 'line s1', d }),
  );
}
