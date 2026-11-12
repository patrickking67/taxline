// The rules extractor, the model cross-check, and the extract_fields tool.
// Expected confidences for the seeded W-2 are pinned so a change to the weights is
// a visible change. The model reader is always a fake: no test calls a live API.

import test from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import type { MessagesClient } from '../src/agent.js';
import { createModelExtractor, readToolInput } from '../src/extract/model.js';
import { CROSS_CHECK, reconcile, sameValue } from '../src/extract/reconcile.js';
import { extractFields, editDistance, type RuleField } from '../src/extract/rules.js';
import { parseCode, parseId, parseMoney, parseText } from '../src/extract/values.js';
import { aggregateToolOutputs } from '../src/orchestrator.js';
import { docById } from '../src/seed/queue.js';
import { createDocExtract, type ExtractOutput } from '../src/tools/doc-extract.js';
import { CONFIDENCE_THRESHOLD, type ToolResult } from '../src/types.js';

const W2_LINES = [
  'Form W-2 Wage and Tax Statement 2026',
  'b Employer identification number (EIN)  00-0000001',
  "c Employer's name, address, and ZIP code  Juniper Works LLC",
  '1 Wages, tips, other compensation  50,000.00',
  '2 Federal income tax withheld  6,000.00',
  '3 Social security wages  52,000.00',
  '4 Social security tax withheld  3,224.00',
  '5 Medicare wages and tips  52,000.00',
  '6 Medicare tax withheld  754.00',
  '12a Code D  2,000.00',
  '16 State wages, tips, etc.  50,000.00',
  '17 State income tax  1,500.00',
  '20 Locality name  PHL-RES',
];
const w2 = (edit: (lines: string[]) => string[] = (l) => l) => edit([...W2_LINES]).join('\n');
const swap = (prefix: string, line: string) => (lines: string[]) =>
  lines.map((l) => (l.startsWith(prefix) ? line : l));
const drop = (prefix: string) => (lines: string[]) => lines.filter((l) => !l.startsWith(prefix));
const byLabel = (fields: RuleField[], label: string): RuleField => {
  const f = fields.find((x) => x.label === label);
  assert.ok(f, `no field ${label}`);
  return f;
};

test('money: valid shapes parse, repairs are counted, bad shapes are not guessed', () => {
  assert.deepEqual(
    [parseMoney('$128,400.00').value, parseMoney('128,400.00').cents, parseMoney('0.00').cents],
    ['$128,400.00', 12840000, 0],
  );
  const lookalike = parseMoney('6,1O0.00');
  assert.deepEqual(
    [lookalike.value, lookalike.lookalike, lookalike.ambiguous],
    ['$6,100.00', 1, 0],
  );
  const ambiguous = parseMoney('6,1B0.00');
  assert.deepEqual(
    [ambiguous.value, ambiguous.lookalike, ambiguous.ambiguous],
    ['$6,180.00', 0, 1],
  );
  assert.equal(parseMoney('128.400,00').separator, 2);
  assert.equal(parseMoney('128400.00').separator, 1);
  // A dropped digit breaks the grouping; an unreadable mark cannot be repaired.
  for (const bad of [
    '128,40.00',
    '128,400.0',
    '12~,400.00',
    '128,400',
    '',
    '1 000.00',
    '01,000.00',
  ]) {
    assert.equal(parseMoney(bad).value, null, bad);
  }
});

test('ids, codes, and names: pattern checks and look-alike repairs', () => {
  assert.equal(parseId('00-0000001').value, '00-0000001');
  assert.deepEqual(
    [parseId('OO-000000l').value, parseId('OO-000000l').lookalike],
    ['00-0000001', 3],
  );
  assert.equal(parseId('00 0000001').separator, 1);
  assert.equal(parseId('00-000001').value, null);
  assert.deepEqual(
    [parseCode('PHL-RES').value, parseCode('PHL-RES').wellFormed],
    ['PHL-RES', true],
  );
  assert.deepEqual([parseCode('PHL-RE5').value, parseCode('PHL-RE5').lookalike], ['PHL-RES', 1]);
  assert.deepEqual(
    [parseCode('PHL-RE~').value, parseCode('PHL-RE~').wellFormed],
    ['PHL-RE~', false],
  );
  assert.deepEqual(
    [parseText('Wil1ow W0rks LLC').value, parseText('Wil1ow W0rks LLC').lookalike],
    ['Willow Works LLC', 2],
  );
  assert.equal(parseText('Juni~er Works').value, null);
  assert.equal(editDistance('kitten', 'sitting'), 3);
});

test('a clean W-2 reads every field, detects the form, and confirms box 1', () => {
  const r = extractFields(w2());
  assert.equal(r.docType, 'W-2');
  assert.equal(r.noise, 0);
  assert.deepEqual(
    r.fields.map((f) => [f.label, f.value]),
    [
      ['Employer', 'Juniper Works LLC'],
      ['EIN', '00-0000001'],
      ['Wages · box 1', '$50,000.00'],
      ['Federal w/h · box 2', '$6,000.00'],
      ['State w/h · box 17', '$1,500.00'],
      ['Local code · box 20', 'PHL-RES'],
    ],
  );
  for (const f of r.fields) assert.ok((f.confidence ?? 0) >= 0.98, `${f.label} ${f.confidence}`);
  assert.ok(r.checks.every((c) => c.passed));
  assert.ok(r.checks.some((c) => c.name === 'box 1 + box 12a code D = box 5'));
  assert.equal(byLabel(r.fields, 'Wages · box 1').line, 4);
  assert.match(byLabel(r.fields, 'Wages · box 1').signals.join('; '), /confirmed: box 16 = box 1/);
  // Same text, same result: nothing here is random.
  assert.deepEqual(extractFields(w2()), r);
});

test('the summary layout reads the same values', () => {
  const text = [
    'W-2 Wage and Tax Statement, employee summary 2026',
    'Employer ID (EIN): 00-0000001',
    'Employer: Juniper Works LLC',
    'Box 1 Wages: $50,000.00',
    'Box 2 Federal tax withheld: $6,000.00',
    'Box 16 State wages: $50,000.00',
    'Box 17 State tax withheld: $1,500.00',
    'Box 20 Locality: PHL-RES',
  ].join('\n');
  assert.deepEqual(
    extractFields(text).fields.map((f) => f.value),
    extractFields(w2()).fields.map((f) => f.value),
  );
});

test('visible damage lowers confidence, and more for an ambiguous character', () => {
  const clean = byLabel(extractFields(w2()).fields, 'State w/h · box 17').confidence!;
  const sure = byLabel(
    extractFields(w2(swap('17 ', '17 State income tax  1,5O0.00'))).fields,
    'State w/h · box 17',
  );
  const unsure = byLabel(
    extractFields(w2(swap('17 ', '17 State income tax  1,5B0.00'))).fields,
    'State w/h · box 17',
  );
  assert.equal(sure.value, '$1,500.00');
  assert.equal(unsure.value, '$1,580.00');
  assert.ok(clean > sure.confidence! && sure.confidence! > unsure.confidence!);
  assert.ok(sure.confidence! >= CONFIDENCE_THRESHOLD);
  assert.ok(unsure.confidence! < CONFIDENCE_THRESHOLD);
  // Damage on one line also lowers the fields that read cleanly.
  const other = byLabel(
    extractFields(w2(swap('17 ', '17 State income tax  1,5B0.00'))).fields,
    'Employer',
  );
  assert.ok(other.confidence! < byLabel(extractFields(w2()).fields, 'Employer').confidence!);
});

test('an unreadable value or a missing line is null, never a guess', () => {
  const unreadable = byLabel(
    extractFields(w2(swap('2 ', '2 Federal income tax withheld  6,~00.00'))).fields,
    'Federal w/h · box 2',
  );
  assert.deepEqual([unreadable.value, unreadable.confidence, unreadable.line], [null, null, 5]);
  const missing = byLabel(extractFields(w2(drop('20 '))).fields, 'Local code · box 20');
  assert.deepEqual([missing.value, missing.confidence, missing.line], [null, null, null]);
});

test('box arithmetic: a silent misread of box 1 is caught or outvoted', () => {
  // Box 1 misread, boxes 5, 6, 12a and 16 intact: both checks on box 1 fail.
  const wrong = extractFields(w2(swap('1 ', '1 Wages, tips, other compensation  58,000.00')));
  const box1 = byLabel(wrong.fields, 'Wages · box 1');
  assert.equal(box1.value, '$58,000.00');
  assert.ok(box1.confidence! <= 0.45);
  assert.match(box1.signals.join('; '), /check failed: box 16 = box 1/);
  // Box 16 misread instead: box 1 still ties to box 5 through box 12a, and box 6 confirms box 5.
  const state = extractFields(w2(swap('16 ', '16 State wages, tips, etc.  58,000.00')));
  const kept = byLabel(state.fields, 'Wages · box 1');
  assert.ok(kept.confidence! >= 0.98);
  assert.match(kept.signals.join('; '), /confirmed: box 1 \+ box 12a code D = box 5/);
  // With the box 12a line missing, box 1 below box 5 proves nothing either way.
  const noDeferral = extractFields(w2((l) => drop('16 ')(drop('12a ')(l))));
  assert.ok(!noDeferral.checks.some((c) => c.fields.includes('box1') && c.fields.includes('box5')));
});

test('withholding above wages is flagged', () => {
  const r = extractFields(w2(swap('2 ', '2 Federal income tax withheld  60,000.00')));
  const box2 = byLabel(r.fields, 'Federal w/h · box 2');
  assert.ok(box2.confidence! <= 0.3);
  assert.match(box2.signals.join('; '), /check failed: box 2 is no more than box 1/);
});

test('1099-NEC: backup withholding must be 24% of box 1 when present', () => {
  const nec = (box4: string) =>
    [
      'Form 1099-NEC Nonemployee Compensation 2026',
      "PAYER'S name  Meadow Supply LP",
      "PAYER'S TIN  00-0000002",
      '1 Nonemployee compensation  10,000.00',
      `4 Federal income tax withheld  ${box4}`,
    ].join('\n');
  const good = extractFields(nec('2,400.00'));
  assert.equal(good.docType, '1099-NEC');
  assert.ok(good.checks[0]?.passed);
  const bad = extractFields(nec('2,900.00'));
  for (const label of ['Nonemployee comp · box 1', 'Federal w/h · box 4']) {
    assert.ok(byLabel(bad.fields, label).confidence! <= 0.45, label);
  }
  assert.equal(extractFields(nec('0.00')).checks.length, 0);
});

test('1099-INT is detected; unknown text and unknown types return nothing', () => {
  const int = [
    '1099-INT Interest Income summary 2026',
    'Payer: Harbor Labs Inc.',
    'Payer TIN: 00-0000003',
    'Box 1 Interest income: $412.18',
    'Box 2 Early withdrawal penalty: $0.00',
  ].join('\n');
  const r = extractFields(int);
  assert.equal(r.docType, '1099-INT');
  assert.deepEqual(
    r.fields.map((f) => f.value),
    ['Harbor Labs Inc.', '00-0000003', '$412.18', '$0.00'],
  );
  assert.equal(extractFields('Dear client,\nplease find the invoice attached.').docType, null);
  assert.deepEqual(extractFields(w2(), 'K-1').fields, []);
});

test('the seeded W-2 reads as documented', () => {
  const doc = docById('acme_w2_2024')!;
  assert.deepEqual(
    doc.fields.map((f) => [f.label, f.value, f.confidence]),
    [
      ['Employer', 'Acme Studios LLC', 0.93],
      ['EIN', '00-0000001', 0.98],
      ['Wages · box 1', '$128,400.00', 0.99],
      ['Federal w/h · box 2', '$24,310.00', 0.98],
      ['State w/h · box 17', '$6,180.00', 0.65],
      ['Local code · box 20', 'PHL-RE~', 0.39],
    ],
  );
  assert.equal(doc.confidence, 0.82);
});

const rule = (label: string, value: string | null, confidence: number | null): RuleField => ({
  key: label,
  label,
  kind: label === 'Payer' ? 'text' : 'money',
  value,
  confidence,
  line: value == null ? null : 1,
  source: value,
  signals: [],
});

test('reconcile: agreement keeps the rules score, any disagreement drops under the threshold', () => {
  assert.ok(sameValue('money', '$42,000.00', '42000.00'));
  assert.ok(sameValue('text', 'Meadow LP', 'meadow  lp'));
  const { fields, review } = reconcile(
    [
      rule('A', '$1,000.00', 0.99),
      rule('B', '$2,000.00', 0.99),
      rule('C', '$3.00', 0.99),
      rule('D', null, null),
      rule('E', null, null),
    ],
    [
      { label: 'A', value: '1000.00', confidence: 1 },
      { label: 'B', value: '$2,500.00', confidence: 1 },
      { label: 'D', value: '$9.00', confidence: 1 },
      { label: 'Other income · box 3', value: '$500.00', confidence: 1 },
    ],
  );
  assert.deepEqual(
    fields.map((f) => [f.label, f.value, f.confidence, f.crossCheck]),
    [
      ['A', '$1,000.00', 0.99, 'agreed'],
      ['B', '$2,000.00', CROSS_CHECK.disagreed, 'disagreed'],
      ['C', '$3.00', CROSS_CHECK.rulesOnly, 'rules-only'],
      ['D', '$9.00', CROSS_CHECK.modelOnly, 'model-only'],
      ['E', null, null, 'both-empty'],
    ],
  );
  for (const cap of Object.values(CROSS_CHECK)) assert.ok(cap < CONFIDENCE_THRESHOLD);
  assert.deepEqual(
    review.map((r) => r.label),
    ['B', 'C', 'D', 'Other income · box 3'],
  );
  assert.match(review[0]!.reason, /rules read "\$2,000.00", model read "\$2,500.00"/);
  // The invented label is reported and never becomes a field.
  assert.ok(!fields.some((f) => f.label === 'Other income · box 3'));
  // A model score can never lift a field: the low rules score survives agreement.
  const low = reconcile([rule('A', '$1.00', 0.4)], [{ label: 'A', value: '$1.00', confidence: 1 }]);
  assert.equal(low.fields[0]!.confidence, 0.4);
});

function reply(stop_reason: Anthropic.StopReason, content: unknown[]): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'test-model',
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Message;
}

function fakeClient(respond: () => Anthropic.Message) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    messages: {
      create: async (p) => {
        calls.push(structuredClone(p));
        return respond();
      },
    },
  };
  return { client, calls };
}

const recorded = (fields: unknown[]) =>
  reply('tool_use', [{ type: 'tool_use', id: 'tu_1', name: 'record_fields', input: { fields } }]);

const data = (r: ToolResult<ExtractOutput>): ExtractOutput => {
  assert.ok(r.ok, JSON.stringify(r));
  return r.data;
};

test('model tool input is validated: unknown labels, bad scores, and duplicates are dropped', () => {
  assert.deepEqual(
    readToolInput(
      {
        fields: [
          { label: 'EIN', value: ' 00-0000001 ', confidence: 0.9 },
          { label: 'EIN', value: '11-1111111', confidence: 0.9 },
          { label: 'Made up', value: 'x', confidence: 0.9 },
          { label: 'Employer', value: 'Acme', confidence: 7 },
          { label: 'Payer', value: '', confidence: 0.9 },
          'nonsense',
        ],
      },
      ['EIN', 'Employer', 'Payer'],
    ),
    [
      { label: 'EIN', value: '00-0000001', confidence: 0.9 },
      { label: 'Employer', value: 'Acme', confidence: null },
      { label: 'Payer', value: null, confidence: null },
    ],
  );
  assert.deepEqual(readToolInput(null, ['EIN']), []);
});

test('extract_fields without a model reader is the rules extractor, with line citations', async () => {
  const out = data(await createDocExtract().run({ docId: 'acme_w2_2024' }));
  assert.deepEqual(
    [out.extractor, out.crossCheck, out.needsReview],
    ['rules', 'not-configured', []],
  );
  const state = out.fields.find((f) => f.label === 'State w/h · box 17')!;
  assert.deepEqual(state.citations, [
    { file: 'acme_w2_2024.pdf', heading: 'line 11', snippet: '17 State income tax  6,1B0.00' },
  ]);
  assert.ok(state.signals?.some((s) => /repair/.test(s)));
});

test('a model that agrees changes nothing; one that disagrees sends the field to review', async () => {
  const rules = data(await createDocExtract().run({ docId: '1099_nec_batch' }));
  const same = rules.fields.map((f) => ({ label: f.label, value: f.value, confidence: 0.99 }));

  const agree = fakeClient(() => recorded(same));
  const agreed = data(
    await createDocExtract({ modelExtract: createModelExtractor(agree.client, 'test-model') }).run({
      docId: '1099_nec_batch',
    }),
  );
  assert.deepEqual([agreed.extractor, agreed.crossCheck], ['rules+model', 'agreed']);
  assert.deepEqual(
    agreed.fields.map((f) => f.confidence),
    rules.fields.map((f) => f.confidence),
  );
  // The request does not force the tool, and the document is fenced as data.
  const sent = agree.calls[0]!;
  assert.deepEqual(sent.tool_choice, { type: 'auto' });
  assert.equal(sent.tools?.length, 1);
  assert.match(JSON.stringify(sent.messages), /<document>/);

  const differ = fakeClient(() =>
    recorded(
      same.map((f) => (f.label === 'Nonemployee comp · box 1' ? { ...f, value: '$48,000.00' } : f)),
    ),
  );
  const result = await createDocExtract({
    modelExtract: createModelExtractor(differ.client, 'test-model'),
  }).run({ docId: '1099_nec_batch' });
  const out = data(result);
  assert.equal(out.crossCheck, 'disagreed');
  const comp = out.fields.find((f) => f.label === 'Nonemployee comp · box 1')!;
  assert.deepEqual([comp.value, comp.confidence], ['$42,000.00', CROSS_CHECK.disagreed]);
  // The orchestrator's aggregation turns that into review items; nothing else is flagged.
  const agg = aggregateToolOutputs([{ name: 'extract_fields', result }]);
  assert.deepEqual(
    agg.review.map((r) => [r.label, r.reason]),
    [
      ['Nonemployee comp · box 1', 'confidence 0.50 < 0.85'],
      [
        'Nonemployee comp · box 1',
        'model and rules disagree: rules read "$42,000.00", model read "$48,000.00"',
      ],
    ],
  );
});

test('a model reader that fails falls back to the rules result and says so', async () => {
  const cases: [() => Anthropic.Message, RegExp][] = [
    [
      () => reply('end_turn', [{ type: 'text', text: 'Here are the fields.' }]),
      /did not call record_fields/,
    ],
    [() => reply('refusal', []), /declined/],
    [
      () => {
        throw new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers());
      },
      /temporarily unavailable/,
    ],
  ];
  const rules = data(await createDocExtract().run({ docId: '1099_nec_batch' }));
  for (const [respond, reason] of cases) {
    const { client } = fakeClient(respond);
    const out = data(
      await createDocExtract({ modelExtract: createModelExtractor(client, 'test-model') }).run({
        docId: '1099_nec_batch',
      }),
    );
    assert.deepEqual([out.extractor, out.crossCheck], ['rules', 'unavailable']);
    assert.deepEqual(out.fields, rules.fields);
    assert.match(out.needsReview[0]!.reason, reason);
  }
});

test('a document with no parser is a structured failure, not seeded values', async () => {
  for (const docId of ['k1_meadow_lp', 'depr_schedule', 'vendor_invoices_q1']) {
    const r = await createDocExtract().run({ docId });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.errorCategory, 'business');
      assert.match(r.message, /No extractor for document/);
    }
  }
});
