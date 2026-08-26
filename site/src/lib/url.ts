/**
 * The one way to build a URL inside this site.
 *
 * `BASE_URL` is `/` for a custom domain and `/taxline` — with no trailing slash —
 * for the GitHub Pages project page. Thirteen files had each grown the same
 * private copy of this helper written as `(base + p)`, which only collapses a
 * double slash and never inserts a missing one. That works locally, where
 * `BASE_URL` is `/`, and breaks every link in production, where `u('agents')`
 * produced `/taxlineagents`. The separator goes in before the collapse.
 */
export const base = import.meta.env.BASE_URL;

/** Join a path onto the site base. `u('agents')` → `/taxline/agents`. */
export const u = (p = '') => `${base}/${p}`.replace(/\/{2,}/g, '/');

/** Absolute form, for metadata a crawler resolves against nothing. */
export const absolute = (p: string, site: URL | undefined) => new URL(u(p), site).href;
