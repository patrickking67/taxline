import type { ApiAdapter, FleetService } from './types';
import { mockAdapter } from './mock';
import { cloudflareAdapter } from './cloudflare';
import { mockFleet } from './mockFleet';
import { serviceFleet } from './serviceFleet';

export * from './types';

// Two seams resolved from build-time env, both defaulting to a fully offline mock
// so the static site works on GitHub Pages with no backend:
//
//   api   — the demo/contact form  (PUBLIC_CONTACT_ENDPOINT → Cloudflare Worker)
//   fleet — the agent backend      (PUBLIC_SERVICE_ENDPOINT → Node service)
//
// Set PUBLIC_API_ADAPTER to anything other than "mock" plus the matching endpoint
// to point either seam at a real backend. Any endpoint honoring the same contract
// (Azure Functions, Supabase, …) drops in without touching the components.

function resolveAdapter(): ApiAdapter {
  const which = import.meta.env.PUBLIC_API_ADAPTER ?? 'mock';
  const endpoint = import.meta.env.PUBLIC_CONTACT_ENDPOINT;
  if (which === 'cloudflare' && endpoint) return cloudflareAdapter(endpoint);
  return mockAdapter;
}

function resolveFleet(): FleetService {
  const which = import.meta.env.PUBLIC_API_ADAPTER ?? 'mock';
  const endpoint = import.meta.env.PUBLIC_SERVICE_ENDPOINT;
  if (which !== 'mock' && endpoint) return serviceFleet(endpoint);
  return mockFleet;
}

export const api: ApiAdapter = resolveAdapter();
export const fleet: FleetService = resolveFleet();
