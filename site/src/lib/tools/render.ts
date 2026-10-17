// DOM rendering for calculator output. Everything is built with
// createElement/textContent — no HTML strings — so input can never inject markup.

import { fmtNum, fmtUsd, type Trace, type TraceLine } from '@taxline/tax-engine';

const fmtLine = (l: TraceLine, cents?: boolean) =>
  l.unit === 'count' ? fmtNum(l.value) : l.value < 0 ? `(${fmtUsd(-l.value, cents)})` : fmtUsd(l.value, cents);

type Attrs = Record<string, string>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string, attrs: Attrs = {}): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Set every `[data-out="key"]` inside `root` to its formatted value. */
export function setOutputs(root: ParentNode, values: Record<string, string>): void {
  for (const [k, v] of Object.entries(values)) {
    root.querySelectorAll(`[data-out="${k}"]`).forEach((el) => {
      el.textContent = v;
    });
  }
}

/**
 * Render a trace into a <tbody> on the paper workpaper surface: form line,
 * label with the formula beneath it, value, and the authority as a link.
 * Lines with a zero value and no emphasis are hidden unless `showZero`.
 */
export function renderTrace(tbody: HTMLElement, trace: Trace, opts: { showZero?: boolean; cents?: boolean } = {}): void {
  tbody.replaceChildren();
  for (const line of trace) {
    if (!opts.showZero && line.value === 0 && !line.emphasis) continue;
    const strong = line.emphasis === 'total' ? 'font-semibold' : line.emphasis === 'subtotal' ? 'font-medium' : '';
    const tr = h('tr', line.emphasis ? 'border-t border-paper-border' : 'border-t border-paper-border/50');
    tr.append(h('td', 'whitespace-nowrap py-2 pr-3 align-top font-mono text-[11px] text-paper-ink-muted', line.ref ?? ''));
    const label = h('td', `py-2 pr-3 align-top text-[13px] ${strong}`);
    label.append(h('div', '', line.label));
    if (line.formula) label.append(h('div', 'mt-0.5 font-mono text-[11px] text-paper-ink-muted', line.formula));
    if (line.authority) {
      const a = h('a', 'mt-0.5 inline-block font-mono text-[10px] text-paper-ink-muted underline decoration-paper-border underline-offset-2 hover:text-paper-ink', line.authority.label);
      if (line.authority.url) {
        a.setAttribute('href', line.authority.url);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
      }
      const wrap = h('div');
      wrap.append(a);
      label.append(wrap);
    }
    tr.append(label);
    tr.append(h('td', `whitespace-nowrap py-2 text-right align-top font-mono text-[13px] tabular-nums ${strong}`, fmtLine(line, opts.cents)));
    tbody.append(tr);
  }
}

/** Copy a plain-text version of the trace (for pasting into a workpaper). */
export function traceToText(title: string, trace: Trace): string {
  const rows = trace
    .filter((l) => l.value !== 0 || l.emphasis)
    .map((l) => {
      const row = `${(l.ref ?? '').padEnd(14)} ${l.label.padEnd(44)} ${fmtLine(l, true).padStart(16)}${l.formula ? `   [${l.formula}]` : ''}`;
      // Keep each line's own authority so a pasted workpaper still cites its source.
      return l.authority ? `${row}\n${''.padEnd(15)}source: ${l.authority.label}${l.authority.url ? ` <${l.authority.url}>` : ''}` : row;
    });
  return [title, '-'.repeat(title.length), ...rows, '', 'Estimate for review. Computed by @taxline/tax-engine (TY2026, Rev. Proc. 2025-32).'].join('\n');
}

export function wireCopy(button: HTMLButtonElement | null, getText: () => string): void {
  if (!button) return;
  const label = button.textContent;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    window.setTimeout(() => (button.textContent = label), 1600);
  });
}

/** Color a headline value by sign: a refund or gain reads ok, a balance due reads warn. */
export function setTone(root: ParentNode, out: string, tone: 'ok' | 'warn' | 'neutral'): void {
  root.querySelectorAll(`[data-out="${out}"]`).forEach((el) => {
    el.classList.remove('text-ok-bright', 'text-warn-bright', 'text-fg');
    el.classList.add(tone === 'ok' ? 'text-ok-bright' : tone === 'warn' ? 'text-warn-bright' : 'text-fg');
  });
}
