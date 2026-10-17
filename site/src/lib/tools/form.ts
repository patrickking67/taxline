// Calculator form state. Inputs are the source of truth; the query string
// mirrors them so a result is shareable and survives a reload. Values are read
// by `name`, coerced by input type, and handed to the page's compute function.

export type FormValues = Record<string, string | number | boolean>;

function readValue(el: HTMLInputElement | HTMLSelectElement): string | number | boolean {
  if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.checked;
  if (el.dataset.kind === 'money' || (el instanceof HTMLInputElement && el.type === 'number')) {
    const n = Number(el.value.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return el.value;
}

const fields = (form: HTMLFormElement) =>
  Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[name], select[name]'));

/** Restore from the URL, compute now, and recompute on every edit. */
export function bindCalculator(form: HTMLFormElement, compute: (v: FormValues) => void): void {
  const params = new URLSearchParams(location.search);
  for (const el of fields(form)) {
    const q = params.get(el.name);
    if (q == null) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = q === '1';
    else el.value = q;
  }

  // Money inputs show thousands separators but accept anything numeric.
  for (const el of form.querySelectorAll<HTMLInputElement>('input[data-kind="money"]')) {
    const tidy = () => {
      const n = Number(el.value.replace(/[$,\s]/g, ''));
      if (el.value.trim() !== '' && Number.isFinite(n)) el.value = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    };
    el.addEventListener('blur', tidy);
    tidy();
  }

  let timer: number | undefined;
  const run = () => {
    const values: FormValues = {};
    for (const el of fields(form)) values[el.name] = readValue(el);
    compute(values);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const next = new URLSearchParams();
      for (const el of fields(form)) {
        const v = values[el.name];
        const def = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.defaultChecked : (el as HTMLInputElement).defaultValue ?? '';
        const cur = typeof v === 'boolean' ? v : String(el.value);
        if (typeof v === 'boolean' ? v !== def : cur !== def) next.set(el.name, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
      }
      const qs = next.toString();
      history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
    }, 250);
  };
  form.addEventListener('input', run);
  form.addEventListener('change', run);
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('reset', () => window.setTimeout(run, 0));
  run();
}

export const num = (v: FormValues[string] | undefined) => (typeof v === 'number' ? v : Number(v) || 0);
export const pct = (v: FormValues[string] | undefined) => num(v) / 100;
