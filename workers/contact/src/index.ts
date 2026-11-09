// Taxline contact-form Worker.
//
// Receives demo requests from the static site (GitHub Pages) and persists them
// to KV, with an optional best-effort Slack notification. The site talks to this
// via a tiny adapter contract: POST JSON -> { ok, id }. Any endpoint that honors
// that contract (Azure Functions, Supabase Edge Function, Formspree, ...) can
// replace this Worker without touching the frontend.

export interface Env {
  /** KV namespace for stored leads. Optional so the Worker boots without it. */
  LEADS?: KVNamespace;
  /** Slack Incoming Webhook URL. Set as a secret, never committed. */
  SLACK_WEBHOOK?: string;
  /** Allowed CORS origin (the Pages site). Falls back to "*". */
  ALLOWED_ORIGIN?: string;
}

interface Lead {
  email: string;
  firm: string;
  seats: number;
  engagement: string;
  message: string;
  receivedAt: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field caps. A demo request is a few lines; anything past this is truncated. */
export const LIMITS = {
  email: 254,
  firm: 200,
  engagement: 120,
  message: 4_000,
  seats: 100_000,
  bodyBytes: 32_000,
} as const;

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(env),
    },
  });
}

function shortId(): string {
  // Short, URL-safe, collision-resistant enough for a human-facing ref.
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

function str(value: unknown, max = Infinity): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Whole seats in [0, LIMITS.seats]. Anything unparseable is 0. */
export function parseSeats(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(str(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), LIMITS.seats);
}

/**
 * Slack reads `&`, `<`, and `>` as control characters: `<!channel>` pings a whole
 * channel and `<https://x|text>` hides a link. Escape them so form text shows as
 * typed (https://api.slack.com/reference/surfaces/formatting#escaping).
 */
export function slackEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // CORS preflight.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method_not_allowed' }, 405, env);
    }

    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > LIMITS.bodyBytes) {
      return json({ ok: false, error: 'payload_too_large' }, 413, env);
    }

    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return json({ ok: false, error: 'invalid_json' }, 400, env);
    }
    // `null`, an array, or a bare value parses as JSON but is not a form.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return json({ ok: false, error: 'invalid_json' }, 400, env);
    }
    const payload = parsed as Record<string, unknown>;

    // Honeypot: a real user never fills this hidden field. Pretend success so
    // bots get no signal, and store nothing.
    if (str(payload.company_website)) {
      return json({ ok: true }, 200, env);
    }

    const email = str(payload.email);
    if (email.length > LIMITS.email || !EMAIL_RE.test(email)) {
      return json({ ok: false, error: 'invalid_email' }, 400, env);
    }

    const lead: Lead = {
      email,
      firm: str(payload.firm, LIMITS.firm),
      seats: parseSeats(payload.seats),
      engagement: str(payload.engagement, LIMITS.engagement),
      message: str(payload.message, LIMITS.message),
      receivedAt: new Date().toISOString(),
    };

    const id = shortId();

    if (env.LEADS) {
      try {
        // The id keeps two requests in the same millisecond from overwriting each other.
        await env.LEADS.put(`lead:${lead.receivedAt}:${id}`, JSON.stringify({ id, ...lead }));
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'storage_error';
        return json({ ok: false, error: 'storage_error', detail }, 500, env);
      }
    }

    if (env.SLACK_WEBHOOK) {
      const summary = slackEscape(
        `New Taxline demo request (${id})\n` +
          `Email: ${lead.email}\n` +
          `Firm: ${lead.firm || '-'}\n` +
          `Seats: ${lead.seats || '-'}\n` +
          `Engagement: ${lead.engagement || '-'}\n` +
          `Message: ${lead.message || '-'}`,
      );
      // Best-effort: never block or fail the response on Slack delivery.
      ctx.waitUntil(
        fetch(env.SLACK_WEBHOOK, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: summary }),
        }).catch(() => undefined),
      );
    }

    return json({ ok: true, id }, 200, env);
  },
};
