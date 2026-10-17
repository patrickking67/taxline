// Dependency-free SVG charts for the calculators.
//
// Conventions (docs/design-contract.md + dataviz rules): one series per chart in
// the signal green, 2px lines, a 10% area wash, hairline recessive grid, ≥8px
// markers with a surface ring, a single baseline, and a hover layer with a
// crosshair + tooltip. Text is always in text tokens, never the series color.
// Every chart sits beside a table holding the same numbers.

const NS = 'http://www.w3.org/2000/svg';

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, style = ''): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (style) el.setAttribute('style', style);
  return el;
}

const TEXT = 'fill:var(--color-fg-faint);font:500 10px var(--font-mono)';
const GRID = 'stroke:var(--color-border);stroke-width:1';

/** A 1/2/2.5/5 × 10ⁿ step that splits `span` into about `count` intervals. */
export function niceStep(span: number, count = 4): number {
  if (span <= 0) return 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
}

/** Ticks covering [lo, hi] on a nice step, always including zero. */
export function niceTicks(hi: number, lo = 0, count = 4): number[] {
  const step = niceStep(Math.max(hi, 0) - Math.min(lo, 0), count);
  const from = Math.floor(Math.min(lo, 0) / step) * step;
  const to = Math.ceil(Math.max(hi, 0) / step) * step || step;
  const out: number[] = [];
  for (let v = from; v <= to + step * 1e-6; v += step) out.push(Math.round(v / step) * step);
  return out;
}

interface Frame {
  svg: SVGSVGElement;
  W: number;
  H: number;
  pad: { t: number; r: number; b: number; l: number };
  tip: HTMLDivElement;
}

function frame(host: HTMLElement, label: string, H = 240): Frame {
  host.replaceChildren();
  host.style.position = 'relative';
  const W = Math.max(280, Math.round(host.clientWidth || 640));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': label });
  svg.style.display = 'block';
  svg.style.overflow = 'visible';
  const tip = document.createElement('div');
  tip.className = 'pointer-events-none absolute z-10 hidden rounded-md border border-border-strong bg-raised px-2.5 py-1.5 font-mono text-[11px] text-fg shadow-pop';
  host.append(svg, tip);
  return { svg, W, H, pad: { t: 14, r: 16, b: 26, l: 54 }, tip };
}

function showTip(f: Frame, x: number, y: number, lines: string[]) {
  f.tip.replaceChildren(
    ...lines.map((t, i) => {
      const d = document.createElement('div');
      d.textContent = t;
      if (i > 0) d.className = 'text-fg-muted';
      return d;
    }),
  );
  f.tip.classList.remove('hidden');
  const host = f.svg.parentElement!;
  const scale = host.clientWidth / f.W;
  const left = Math.min(Math.max(0, x * scale + 12), host.clientWidth - f.tip.offsetWidth);
  f.tip.style.left = `${left}px`;
  f.tip.style.top = `${Math.max(0, y * scale - f.tip.offsetHeight - 10)}px`;
}

export interface LineChartOpts {
  label: string;
  points: [number, number][];
  xFmt: (x: number) => string;
  yFmt: (y: number) => string;
  /** Point to mark and label (e.g. "you are here"). */
  marker?: { x: number; label: string };
  /** Shaded x-ranges behind the line (e.g. tax brackets), sequential opacity. */
  bands?: { from: number; to: number; label: string; weight: number }[];
  /** Allow negative y and draw the zero baseline. */
  signed?: boolean;
  yMax?: number;
  height?: number;
  tipLines?: (p: [number, number]) => string[];
}

export function lineChart(host: HTMLElement, o: LineChartOpts): void {
  const f = frame(host, o.label, o.height);
  const { W, H, pad, svg } = f;
  const xs = o.points.map((p) => p[0]);
  const ys = o.points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const yHi = o.yMax ?? Math.max(...ys, 0);
  const yLo = o.signed ? Math.min(...ys, 0) : 0;
  const yTicks = niceTicks(yHi, yLo);
  const top = yTicks[yTicks.length - 1]!;
  const bottom = yTicks[0]!;
  const X = (x: number) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const Y = (y: number) => pad.t + ((top - y) / (top - bottom || 1)) * (H - pad.t - pad.b);

  for (const b of o.bands ?? []) {
    const bx = X(Math.max(x0, b.from));
    const bw = X(Math.min(x1, b.to)) - bx;
    if (bw <= 0) continue;
    svg.append(s('rect', { x: bx, y: pad.t, width: bw, height: H - pad.t - pad.b }, `fill:var(--color-accent);opacity:${0.03 + b.weight * 0.09}`));
    if (bw > 26) {
      const t = s('text', { x: bx + 4, y: pad.t + 11 }, TEXT);
      t.textContent = b.label;
      svg.append(t);
    }
  }

  for (const v of yTicks) {
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }, v === 0 ? 'stroke:var(--color-border-strong);stroke-width:1' : GRID));
    const t = s('text', { x: pad.l - 8, y: Y(v) + 3, 'text-anchor': 'end' }, TEXT);
    t.textContent = o.yFmt(v);
    svg.append(t);
  }
  for (let k = 0; k <= 4; k++) {
    const xv = x0 + ((x1 - x0) * k) / 4;
    const t = s('text', { x: X(xv), y: H - 8, 'text-anchor': k === 0 ? 'start' : k === 4 ? 'end' : 'middle' }, TEXT);
    t.textContent = o.xFmt(xv);
    svg.append(t);
  }

  const d = o.points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  svg.append(s('path', { d: `${d}L${X(x1)},${Y(Math.max(bottom, 0))}L${X(x0)},${Y(Math.max(bottom, 0))}Z` }, 'fill:var(--color-accent);opacity:0.1'));
  svg.append(s('path', { d, fill: 'none' }, 'stroke:var(--color-accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round'));

  const nearest = (x: number) => o.points.reduce((a, p) => (Math.abs(p[0] - x) < Math.abs(a[0] - x) ? p : a), o.points[0]!);
  if (o.marker) {
    const p = nearest(o.marker.x);
    svg.append(s('line', { x1: X(p[0]), x2: X(p[0]), y1: pad.t, y2: H - pad.b }, 'stroke:var(--color-fg-faint);stroke-width:1'));
    svg.append(s('circle', { cx: X(p[0]), cy: Y(p[1]), r: 5 }, 'fill:var(--color-accent);stroke:var(--color-panel);stroke-width:2'));
    const left = X(p[0]) > W * 0.7;
    const t = s('text', { x: X(p[0]) + (left ? -9 : 9), y: Y(p[1]) - 9, 'text-anchor': left ? 'end' : 'start' }, 'fill:var(--color-fg);font:600 11px var(--font-mono)');
    t.textContent = o.marker.label;
    svg.append(t);
  }

  // Hover layer: crosshair + dot + tooltip, hit area is the whole plot.
  const cross = s('line', { y1: pad.t, y2: H - pad.b }, 'stroke:var(--color-fg-muted);stroke-width:1;display:none');
  const dot = s('circle', { r: 4 }, 'fill:var(--color-fg);stroke:var(--color-panel);stroke-width:2;display:none');
  const hit = s('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b }, 'fill:transparent;cursor:crosshair');
  svg.append(cross, dot, hit);
  const move = (ev: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    const sx = ((ev.clientX - r.left) / r.width) * W;
    const p = nearest(x0 + ((sx - pad.l) / (W - pad.l - pad.r)) * (x1 - x0));
    cross.setAttribute('x1', String(X(p[0])));
    cross.setAttribute('x2', String(X(p[0])));
    cross.style.display = '';
    dot.setAttribute('cx', String(X(p[0])));
    dot.setAttribute('cy', String(Y(p[1])));
    dot.style.display = '';
    showTip(f, X(p[0]), Y(p[1]), o.tipLines ? o.tipLines(p) : [o.yFmt(p[1]), o.xFmt(p[0])]);
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', () => {
    cross.style.display = 'none';
    dot.style.display = 'none';
    f.tip.classList.add('hidden');
  });
}

export interface BarChartOpts {
  label: string;
  bars: { label: string; value: number; tip?: string[] }[];
  yFmt: (y: number) => string;
  height?: number;
  /** Index of the bar to emphasize; others render at reduced opacity. */
  focus?: number;
}

export function barChart(host: HTMLElement, o: BarChartOpts): void {
  const f = frame(host, o.label, o.height);
  const { W, H, pad, svg } = f;
  const max = Math.max(...o.bars.map((b) => b.value), 0);
  const ticks = niceTicks(max || 1);
  const top = ticks[ticks.length - 1]!;
  const Y = (y: number) => pad.t + ((top - y) / top) * (H - pad.t - pad.b);
  for (const v of ticks) {
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }, v === 0 ? 'stroke:var(--color-border-strong);stroke-width:1' : GRID));
    const t = s('text', { x: pad.l - 8, y: Y(v) + 3, 'text-anchor': 'end' }, TEXT);
    t.textContent = o.yFmt(v);
    svg.append(t);
  }
  const slot = (W - pad.l - pad.r) / Math.max(1, o.bars.length);
  const bw = Math.max(2, Math.min(24, slot - 2));
  const every = Math.ceil(o.bars.length / 12);
  o.bars.forEach((b, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const y = Y(Math.max(0, b.value));
    const hgt = Y(0) - y;
    const r = Math.min(4, bw / 2, hgt);
    // Rounded data end, square at the baseline.
    const x = cx - bw / 2;
    const path = hgt <= 0 ? '' : `M${x},${Y(0)}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${Y(0)}Z`;
    const opacity = o.focus == null || o.focus === i ? 1 : 0.55;
    if (path) svg.append(s('path', { d: path }, `fill:var(--color-accent);opacity:${opacity}`));
    if (i % every === 0) {
      const t = s('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, TEXT);
      t.textContent = b.label;
      svg.append(t);
    }
    const hit = s('rect', { x: pad.l + slot * i, y: pad.t, width: slot, height: H - pad.t - pad.b }, 'fill:transparent');
    hit.addEventListener('pointerenter', () => showTip(f, cx, y, b.tip ?? [o.yFmt(b.value), b.label]));
    hit.addEventListener('pointerleave', () => f.tip.classList.add('hidden'));
    svg.append(hit);
  });
}

/** Re-render on container resize (charts are sized to their host in px). */
export function onResize(host: HTMLElement, draw: () => void): void {
  let w = host.clientWidth;
  new ResizeObserver(() => {
    if (Math.abs(host.clientWidth - w) > 8) {
      w = host.clientWidth;
      draw();
    }
  }).observe(host);
}

export const compactUsd = (n: number) => {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
};
