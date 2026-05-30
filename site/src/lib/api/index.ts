import type { ApiAdapter } from './types';
import { mockAdapter } from './mock';
import { cloudflareAdapter } from './cloudflare';

export * from './types';

// Resolve the adapter from build-time env. Default = mock (static, no backend).
// Set PUBLIC_API_ADAPTER=cloudflare and PUBLIC_CONTACT_ENDPOINT=<worker url> to
// route the demo form to the real Cloudflare Worker.
function resolveAdapter(): ApiAdapter {
  const which = import.meta.env.PUBLIC_API_ADAPTER ?? 'mock';
  const endpoint = import.meta.env.PUBLIC_CONTACT_ENDPOINT;
  if (which === 'cloudflare' && endpoint) return cloudflareAdapter(endpoint);
  return mockAdapter;
}

export const api: ApiAdapter = resolveAdapter();
