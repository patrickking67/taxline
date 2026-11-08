// HTTP boundary: body parsing, status codes, and error shapes, against the real
// handler on an ephemeral port. Offline mode (no key), so no network calls.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { handle } from '../src/server.js';

async function withServer(fn: (base: string) => Promise<void>) {
  const server = http.createServer((req, res) => void handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

const post = (url: string, body: string) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

test('JSON that is not an object is a 400, not a 500', async () => {
  await withServer(async (base) => {
    for (const body of ['null', '[]', '7', '"task"']) {
      for (const route of ['/agents/run', '/scenario', '/demo', '/memory/remember']) {
        const res = await post(base + route, body);
        assert.equal(res.status, 400, `${route} ${body}`);
        const json = (await res.json()) as { ok: boolean; error: string };
        assert.equal(json.ok, false);
        assert.equal(json.error, 'invalid JSON');
      }
    }
  });
});

test('a body over the limit gets a 413 response instead of a reset socket', async () => {
  await withServer(async (base) => {
    const res = await post(base + '/scenario', JSON.stringify({ text: 'x'.repeat(20_000) }));
    assert.equal(res.status, 413);
    assert.equal(((await res.json()) as { error: string }).error, 'payload too large');
  });
});

test('validation and routing errors keep their shapes', async () => {
  await withServer(async (base) => {
    assert.equal((await post(base + '/agents/run', '{nope')).status, 400);
    assert.equal((await post(base + '/agents/run', '{}')).status, 400);
    assert.equal((await post(base + '/demo', JSON.stringify({ email: 'nope' }))).status, 400);
    assert.equal((await fetch(base + '/doc/missing')).status, 404);
    assert.equal((await fetch(base + '/nowhere')).status, 404);
    const health = (await (await fetch(base + '/health')).json()) as {
      ok: boolean;
      liveAgents: boolean;
    };
    assert.equal(health.ok, true);
    assert.equal(health.liveAgents, false);
  });
});

test('an offline run is gated behind human approval', async () => {
  await withServer(async (base) => {
    const res = await post(
      base + '/agents/run',
      JSON.stringify({ task: 'Extract the W-2', agent: 'extraction', docId: 'nope' }),
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { approved: boolean; output: string };
    assert.equal(json.approved, false);
    assert.match(json.output, /^HUMAN APPROVAL REQUIRED/);
  });
});
