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

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ ok: false, error: 'invalid_json' }, 400, env);
    }

    // Honeypot: a real user never fills this hidden field. Pretend success so
    // bots get no signal, and store nothing.
    if (str(payload.company_website)) {
      return json({ ok: true }, 200, env);
    }

    const email = str(payload.email);
    if (!EMAIL_RE.test(email)) {
      return json({ ok: false, error: 'invalid_email' }, 400, env);
    }

    const seatsRaw = payload.seats;
    const seats = typeof seatsRaw === 'number' && Number.isFinite(seatsRaw) ? seatsRaw : Number(str(seatsRaw)) || 0;

    const lead: Lead = {
      email,
      firm: str(payload.firm),
      seats,
      engagement: str(payload.engagement),
      message: str(payload.message),
      receivedAt: new Date().toISOString(),
    };

    const id = shortId();

    if (env.LEADS) {
      try {
        await env.LEADS.put('lead:' + Date.now(), JSON.stringify({ id, ...lead }));
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'storage_error';
        return json({ ok: false, error: 'storage_error', detail }, 500, env);
      }
    }

    if (env.SLACK_WEBHOOK) {
      const summary =
        `New Taxline demo request (${id})\n` +
        `Email: ${lead.email}\n` +
        `Firm: ${lead.firm || '—'}\n` +
        `Seats: ${lead.seats || '—'}\n` +
        `Engagement: ${lead.engagement || '—'}\n` +
        `Message: ${lead.message || '—'}`;
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
