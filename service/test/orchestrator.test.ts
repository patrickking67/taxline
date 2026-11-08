// Orchestration state: the approval gate, field aggregation, run-issue routing,
// entry routing, and the full chain in offline mode. No network: runs without an
// API key use the deterministic tool stub, and live-path runs use a fake client.

import test from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import type { MessagesClient } from '../src/agent.js';
import { aggregateToolOutputs, orchestrate, pickEntryAgent, requireHumanApproval, runIssues } from '../src/orchestrator.js';
import { fail, ok, type ExtractedField, type OrchestratorResult } from '../src/types.js';
import { citationFile } from '../src/kb/retrieve.js';

const field = (label: string, value: string | null, confidence: number | null): ExtractedField => ({
  label,
  value,
  confidence,
  citations: [{ file: 'fixture_w2.pdf', heading: 'p.1 of 1' }],
});

const draft = (over: Partial<OrchestratorResult> = {}): OrchestratorResult => ({
  output: 'Draft workpaper.',
  citations: [],
  needsHumanReview: [],
  trace: [],
  approved: false,
  ...over,
});

test('the gate withholds output until a person approves', () => {
  const blocked = requireHumanApproval(draft({ needsHumanReview: [{ reason: 'confidence 0.74 < 0.85', label: 'State w/h' }] }), false);
  assert.equal(blocked.approved, false);
  assert.match(blocked.output, /^HUMAN APPROVAL REQUIRED/);
  assert.match(blocked.output, /Draft workpaper\.$/);
  assert.equal(blocked.needsHumanReview[0]?.reason, 'human approval required before shipping');
  assert.equal(blocked.needsHumanReview.length, 2);

  const approved = requireHumanApproval(draft(), true);
  assert.equal(approved.approved, true);
  assert.equal(approved.output, 'Draft workpaper.');
  assert.equal(approved.needsHumanReview.length, 0);
});

test('every extracted field is kept and low-confidence ones are flagged without assess_confidence', () => {
  const agg = aggregateToolOutputs([
    {
      name: 'extract_fields',
      result: ok({ fields: [field('Wages', '$100.00', 0.97), field('State w/h', '$6.00', 0.74), field('Local code', null, 0.41)] }),
    },
  ]);
  assert.deepEqual(agg.fields.map((f) => f.label), ['Wages', 'State w/h', 'Local code']);
  assert.deepEqual(
    agg.review.map((r) => [r.label, r.reason]),
    [
      ['State w/h', 'confidence 0.74 < 0.85'],
      ['Local code', 'missing value'],
    ],
  );
  assert.equal(agg.errors.length, 0);
});

test('the model cannot raise a score or launder a value through assess_confidence', () => {
  const agg = aggregateToolOutputs([
    { name: 'extract_fields', result: ok({ fields: [field('State w/h', '$6.00', 0.74)] }) },
    {
      name: 'assess_confidence',
      result: ok({
        threshold: 0.85,
        passed: [
          // Same field, score restated by the model.
          { label: 'State w/h', value: '$6.00', confidence: 0.99, citations: [] },
          // A value no tool extracted, with a made-up citation.
          { label: 'Wages', value: '$999,999.00', confidence: 0.99, citations: [{ file: 'irs.gov/made-up' }] },
        ],
        needsReview: [],
      }),
    },
  ]);
  // The extracted record wins: original score and original citation.
  assert.equal(agg.fields.length, 1);
  assert.equal(agg.fields[0]?.confidence, 0.74);
  assert.equal(agg.fields[0]?.citations[0]?.file, 'fixture_w2.pdf');
  assert.deepEqual(
    agg.review.map((r) => [r.label, r.reason]),
    [
      ['State w/h', 'confidence 0.74 < 0.85'],
      ['Wages', 'not traceable to extract_fields output'],
    ],
  );
});

test('tool errors are collected for the hub and shown to the reviewer', () => {
  const agg = aggregateToolOutputs([{ name: 'extract_fields', result: fail('business', 'No document with id "x".') }]);
  assert.equal(agg.errors.length, 1);
  assert.equal(agg.errors[0]?.errorCategory, 'business');
  assert.equal(agg.errors[0]?.isRetryable, false);
  assert.deepEqual(agg.review, [{ reason: 'tool "extract_fields" failed (business): No document with id "x".' }]);
});

test('an unfinished run always becomes a review item', () => {
  assert.deepEqual(runIssues('research', { hitBackstop: false, stopReason: 'end_turn' }), []);
  assert.match(runIssues('research', { hitBackstop: true, stopReason: 'tool_use' })[0]!.reason, /backstop/);
  assert.match(runIssues('research', { hitBackstop: false, stopReason: 'max_tokens' })[0]!.reason, /cut off/);
  assert.match(runIssues('research', { hitBackstop: false, stopReason: 'refusal' })[0]!.reason, /declined/);
  const failed = runIssues('research', { hitBackstop: false, stopReason: null, error: fail('transient', 'The model is temporarily unavailable.') });
  assert.equal(failed[0]?.reason, 'agent "research" failed: The model is temporarily unavailable. (transient, retryable)');
});

test('the entry agent is chosen from the task text', () => {
  assert.equal(pickEntryAgent('When is the 1120-S due date?'), 'compliance');
  assert.equal(pickEntryAgent('Research the treatment of a home office'), 'research');
  assert.equal(pickEntryAgent('Assemble the workpaper for the reviewer'), 'workpaper');
  assert.equal(pickEntryAgent('Extract the values from this W-2'), 'extraction');
  assert.equal(pickEntryAgent('Something arrived'), 'intake');
});

test('offline, the full chain runs and holds low-confidence fields for review', async () => {
  const r = await orchestrate({ task: 'Extract the W-2', agent: 'extraction', docId: 'acme_w2_2024' });
  assert.deepEqual(r.trace.map((s) => s.agent), ['extraction', 'workpaper', 'compliance']);
  assert.equal(r.approved, false);
  assert.match(r.output, /^HUMAN APPROVAL REQUIRED/);
  assert.equal(r.fields?.length, 6);
  for (const f of r.fields ?? []) assert.equal(f.citations[0]?.file, 'acme_w2_2024.pdf');
  const flagged = r.needsHumanReview.filter((x) => x.label).map((x) => x.label);
  assert.deepEqual(flagged, ['State w/h · box 17', 'Local code · box 20']);
});

test('offline, an unknown document invents no fields and the failure is surfaced', async () => {
  const r = await orchestrate({ task: 'Extract', agent: 'extraction', docId: 'no_such_doc' });
  // A business error does not stop the chain, but it must reach the reviewer.
  assert.equal(r.fields, undefined);
  assert.equal(r.approved, false);
  assert.ok(r.needsHumanReview.some((x) => x.reason === 'tool "extract_fields" failed (business): No document with id "no_such_doc" in the queue.'));
});

test('a failed model call is reported, not thrown, and stops the chain', async () => {
  const client: MessagesClient = {
    messages: {
      create: async () => {
        throw new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers());
      },
    },
  };
  const r = await orchestrate({ task: 'Extract the W-2', agent: 'extraction', docId: 'acme_w2_2024' }, { client });
  assert.equal(r.trace.length, 1);
  assert.equal(r.approved, false);
  assert.ok(
    r.needsHumanReview.some((x) => x.reason === 'agent "extraction" failed: The model is temporarily unavailable. (transient, retryable)'),
    JSON.stringify(r.needsHumanReview),
  );
});

test('remembered records are never cited as knowledge-base files', () => {
  assert.equal(citationFile({ kind: 'kb', file: 'tax/filing-deadlines.md' }), 'tax/filing-deadlines.md');
  assert.equal(citationFile({ kind: 'finding', file: 'tax/filing-deadlines.md' }), 'memory:finding:tax/filing-deadlines.md');
  assert.equal(citationFile({ kind: 'finding' }), 'memory:finding');
  assert.equal(citationFile({}), 'memory:finding');
});
