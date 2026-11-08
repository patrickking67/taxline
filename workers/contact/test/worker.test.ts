// Contact Worker against in-memory KV and a captured fetch. Runs on Node's
// built-in test runner with type stripping, so it needs no extra packages.

import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { LIMITS, parseSeats, slackEscape } from '../src/index.ts';

type Put = { key: string; value: string };

function harness(opts: { slack?: boolean } = {}) {
  const puts: Put[] = [];
  const posts: string[] = [];
  const pending: Promise<unknown>[] = [];
  const env = {
    LEADS: { put: async (key: string, value: string) => void puts.push({ key, value }) },
    SLACK_WEBHOOK: opts.slack ? 'https://hooks.example.test/T000/B000' : undefined,
    ALLOWED_ORIGIN: 'https://example.test',
  };
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    posts.push(String(init?.body ?? ''));
    return new Response('ok');
  }) as typeof fetch;
  const call = async (body: string, headers: Record<string, string> = {}) => {
    const req = new Request('https://worker.example.test/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await worker.fetch(req, env as any, ctx as any);
    await Promise.all(pending);
    return { status: res.status, cors: res.headers.get('access-control-allow-origin'), body: (await res.json()) as Record<string, unknown> };
  };
  const restore = () => {
    globalThis.fetch = realFetch;
  };
  return { call, puts, posts, restore };
}

test('a valid request is stored and gets an id', async () => {
  const h = harness();
  const r = await h.call(JSON.stringify({ email: 'reviewer@example.test', firm: 'Example Firm', seats: 12 }));
  h.restore();
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(typeof r.body.id, 'string');
  assert.equal(h.puts.length, 1);
  assert.equal(JSON.parse(h.puts[0]!.value).seats, 12);
});

test('two requests in the same millisecond do not overwrite each other', async () => {
  const h = harness();
  const realNow = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    await h.call(JSON.stringify({ email: 'a@example.test' }));
    await h.call(JSON.stringify({ email: 'b@example.test' }));
  } finally {
    Date.now = realNow;
    h.restore();
  }
  assert.equal(new Set(h.puts.map((p) => p.key)).size, 2);
});

test('JSON that is not an object is a 400 with CORS headers, not a crash', async () => {
  for (const body of ['null', '[]', '42', '"text"']) {
    const h = harness();
    const r = await h.call(body);
    h.restore();
    assert.equal(r.status, 400, body);
    assert.equal(r.body.error, 'invalid_json');
    assert.equal(r.cors, 'https://example.test');
  }
});

test('invalid JSON and bad email are rejected; the honeypot stores nothing', async () => {
  const h = harness();
  assert.equal((await h.call('{nope')).status, 400);
  assert.equal((await h.call(JSON.stringify({ email: 'not-an-email' }))).body.error, 'invalid_email');
  assert.equal((await h.call(JSON.stringify({ email: `${'a'.repeat(250)}@example.test` }))).body.error, 'invalid_email');
  const bot = await h.call(JSON.stringify({ email: 'bot@example.test', company_website: 'https://spam.example.test' }));
  h.restore();
  assert.equal(bot.status, 200);
  assert.equal(bot.body.ok, true);
  assert.equal(h.puts.length, 0);
});

test('an oversized body is refused before it is parsed', async () => {
  const h = harness();
  const r = await h.call('{}', { 'content-length': String(LIMITS.bodyBytes + 1) });
  h.restore();
  assert.equal(r.status, 413);
  assert.equal(h.puts.length, 0);
});

test('free text is capped and seats are whole and bounded', async () => {
  const h = harness();
  await h.call(JSON.stringify({ email: 'c@example.test', message: 'x'.repeat(LIMITS.message + 500), seats: '-3' }));
  h.restore();
  const lead = JSON.parse(h.puts[0]!.value);
  assert.equal(lead.message.length, LIMITS.message);
  assert.equal(lead.seats, 0);
  assert.equal(parseSeats(12.7), 12);
  assert.equal(parseSeats('9e9'), LIMITS.seats);
  assert.equal(parseSeats('abc'), 0);
});

test('Slack control sequences in form text are escaped', async () => {
  const h = harness({ slack: true });
  await h.call(JSON.stringify({ email: 'd@example.test', message: '<!channel> see <https://x.example.test|here> & more' }));
  h.restore();
  assert.equal(h.posts.length, 1);
  const text = JSON.parse(h.posts[0]!).text as string;
  assert.ok(!text.includes('<!channel>'));
  assert.ok(text.includes('&lt;!channel&gt;'));
  assert.equal(slackEscape('a & <b>'), 'a &amp; &lt;b&gt;');
});
