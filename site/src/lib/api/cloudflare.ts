import type { ApiAdapter, DemoRequest, DemoResult } from './types';

// Real adapter: POSTs to the Cloudflare Worker in `workers/contact/`.
// Endpoint is injected at build via PUBLIC_CONTACT_ENDPOINT.
// Swap this file's URL for an Azure Function / Supabase Edge Function / Formspree
// endpoint and the rest of the app is unchanged.
export function cloudflareAdapter(endpoint: string): ApiAdapter {
  return {
    name: 'cloudflare',
    async submitDemo(req: DemoRequest): Promise<DemoResult> {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return { ok: false, error: text || `Request failed (${res.status}).` };
        }
        const data = (await res.json().catch(() => ({}))) as Partial<DemoResult>;
        return { ok: true, id: data.id };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Network error.' };
      }
    },
  };
}
