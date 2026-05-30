# Taxline contact Worker

Cloudflare Worker that backs the Taxline demo form. It validates the submission,
stores it in a KV namespace, and optionally posts a summary to Slack.

The site talks to this Worker through a one-method adapter contract:

```
POST JSON  ->  { ok: boolean, id?: string, error?: string }
```

Anything that honors that contract can stand in for this Worker (see
[Swapping the backend](#swapping-the-backend)).

## Request / response

Request body (all fields except `email` optional):

```json
{
  "email": "partner@firm.com",
  "firm": "Firm LLP",
  "seats": 12,
  "engagement": "1040 season",
  "message": "Intake + extraction across ~400 1040s.",
  "company_website": ""
}
```

- `company_website` is a honeypot. If it is non-empty the Worker returns
  `{ "ok": true }` and stores nothing (silently dropping bots).
- Invalid email returns `400 { "ok": false, "error": "invalid_email" }`.
- Success returns `200 { "ok": true, "id": "<short id>" }`.

All responses are JSON and carry CORS headers.

## Deploy

```bash
# 1. Authenticate.
wrangler login

# 2. Create the KV namespace, then paste the printed id into wrangler.toml
#    (uncomment the [[kv_namespaces]] block).
wrangler kv namespace create LEADS

# 3. Point ALLOWED_ORIGIN at your Pages URL. Edit [vars] in wrangler.toml,
#    e.g. ALLOWED_ORIGIN = "https://patrickking67.github.io".

# 4. (Optional) Set the Slack webhook secret to enable notifications.
wrangler secret put SLACK_WEBHOOK

# 5. Deploy.
wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://taxline-contact.<subdomain>.workers.dev`.

Local development: `wrangler dev` (use a `.dev.vars` file for `SLACK_WEBHOOK` —
it is git-ignored).

## Point the site at this Worker

The site reads two build-time env vars (see `site/src/lib/api/index.ts`). Build
with:

```bash
PUBLIC_API_ADAPTER=cloudflare \
PUBLIC_CONTACT_ENDPOINT=https://taxline-contact.<subdomain>.workers.dev \
npm run build --workspace site
```

With no env vars set, the site falls back to a mock adapter and submits nothing —
so the static site works on its own.

## Swapping the backend

Because the contract is just `POST JSON -> { ok, id }`, you can replace this
Worker with any equivalent endpoint and only change `PUBLIC_CONTACT_ENDPOINT`:

- **Azure Functions** — an HTTP-triggered function that parses the JSON body,
  validates `email`, drops honeypot hits, persists the lead (Table/Blob/Cosmos),
  and returns `{ ok, id }`.
- **Supabase Edge Function** — a Deno function that inserts the lead into a
  Postgres table and returns `{ ok, id }`.
- **Formspree** — point `PUBLIC_CONTACT_ENDPOINT` at the form's Formspree URL.
  Formspree returns its own JSON; the adapter treats any `2xx` as success.

Keep CORS limited to the Pages origin and the honeypot check in place whichever
backend you choose.
