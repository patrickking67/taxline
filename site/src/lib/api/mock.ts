import type { ApiAdapter, DemoRequest, DemoResult } from './types';

// Default adapter. Works on static hosting (GitHub Pages) with no backend.
// Logs to console and resolves success so the form is fully testable offline.
export const mockAdapter: ApiAdapter = {
  name: 'mock',
  async submitDemo(req: DemoRequest): Promise<DemoResult> {
    if (req.company_website) return { ok: false, error: 'rejected' }; // honeypot
    if (!req.email || !/.+@.+\..+/.test(req.email)) {
      return { ok: false, error: 'A valid work email is required.' };
    }
    await new Promise((r) => setTimeout(r, 600));
    // eslint-disable-next-line no-console
    console.info('[taxline mock] demo request', req);
    return { ok: true, id: `demo_${Math.random().toString(36).slice(2, 10)}` };
  },
};
