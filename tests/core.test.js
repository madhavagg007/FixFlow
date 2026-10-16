const test = require('node:test');
const assert = require('node:assert/strict');
const { data, core, categoryIds } = require('./helpers');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const caseOf = (over = {}) => core.normalizeCase({ id: 'c1', title: 'T', description: 'D', category: 'internet', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z', ...over }, categoryIds);

test('uid returns unique, safe ids', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => core.uid()));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.match(id, /^[\w-]{1,64}$/);
});

test('fmt handles bad dates', () => {
  assert.equal(core.fmt('not a date'), 'Unknown date');
  assert.equal(core.fmt(undefined), 'Unknown date');
  assert.notEqual(core.fmt('2026-01-01T00:00:00Z'), 'Unknown date');
});

test('normalizeCase rejects non-objects', () => {
  for (const bad of [null, undefined, 42, 'x', true]) assert.equal(core.normalizeCase(bad, categoryIds), null);
});

test('normalizeCase fills every field of an empty object', () => {
  const c = core.normalizeCase({}, categoryIds);
  assert.match(c.id, /^[\w-]+$/);
  assert.equal(c.category, 'other');
  assert.equal(c.status, 'open');
  assert.deepEqual([c.answers, c.stepResults, c.evidenceVals], [{}, {}, {}]);
  assert.deepEqual([c.steps, c.log, c.attachments, c.evidence], [[], [], [], []]);
  assert.ok(c.created && c.updated);
});

test('normalizeCase never trusts ids that could inject markup', () => {
  for (const evil of ['"><img src=x onerror=alert(1)>', "');alert(1);//", 'a b', '', 'x'.repeat(65), { toString: () => 'x' }, 12345, ['a'], true]) {
    const c = caseOf({ id: evil });
    assert.match(c.id, /^[\w-]{1,64}$/);
    assert.notEqual(c.id, evil);
  }
  assert.equal(caseOf({ id: 'abc-123_X' }).id, 'abc-123_X');
  assert.equal(typeof caseOf({ id: 12345 }).id, 'string', 'numeric ids are replaced, not kept as numbers');
  const att = caseOf({ attachments: [{ id: { toString: () => 'x' }, data: PNG }] }).attachments[0];
  assert.equal(typeof att.id, 'string');
});

test('normalizeCase coerces wrong types instead of throwing', () => {
  const c = core.normalizeCase({
    title: 123, description: null, answers: [], stepResults: 'x', evidence: [1, 2], log: 'nope',
    steps: [null, { text: 5, done: 1, failed: '', note: { a: 1 } }, 'junk']
  }, categoryIds);
  assert.equal(c.title, '123');
  assert.deepEqual(c.answers, {});
  assert.deepEqual(c.evidence, ['1', '2']);
  assert.deepEqual(c.log, []);
  assert.equal(c.steps.length, 3);
  assert.equal(c.steps[1].text, '5');
  assert.equal(c.steps[1].done, true);
  assert.equal(c.steps[1].failed, false);
  assert.equal(typeof c.steps[1].note, 'string');
  assert.deepEqual(c.steps.map(s => s.id), [0, 1, 2]);
});

test('normalizeCase keeps valid fields and unknown categories become "other"', () => {
  const c = caseOf({ category: 'internet', outcome: 'resolved', notes: 'fixed', platform: 'Windows' });
  assert.equal(c.category, 'internet');
  assert.equal(c.outcome, 'resolved');
  assert.equal(c.notes, 'fixed');
  assert.equal(c.platform, 'Windows');
  assert.equal(caseOf({ category: 'made-up' }).category, 'other');
});

test('normalizeCase only keeps real image data urls, at most 6', () => {
  const good = n => ({ id: 'a' + n, name: 'pic' + n, data: PNG });
  const c = caseOf({
    attachments: [
      ...Array.from({ length: 8 }, (_, n) => good(n)),
      { id: 'x', name: 'js', data: 'javascript:alert(1)' },
      { id: 'y', name: 'html', data: 'data:text/html;base64,PHNjcmlwdD4=' },
      { id: 'z', name: 'svg', data: 'data:image/svg+xml;base64,PHN2Zz4=' },
      null, 'str'
    ]
  });
  assert.equal(c.attachments.length, 6);
  assert.ok(c.attachments.every(a => a.data === PNG));
  const only = caseOf({ attachments: [{ id: 'x', data: 'javascript:alert(1)' }, { id: 'y', data: 'data:text/html;base64,AA==' }] });
  assert.equal(only.attachments.length, 0);
});

test('mergeCases keeps the newer copy and sorts newest first', () => {
  const a = caseOf({ id: 'a', created: '2026-01-01T00:00:00Z', updated: '2026-01-02T00:00:00Z', title: 'old' });
  const b = caseOf({ id: 'b', created: '2026-03-01T00:00:00Z', updated: '2026-03-01T00:00:00Z' });
  const aNew = caseOf({ id: 'a', created: '2026-01-01T00:00:00Z', updated: '2026-02-01T00:00:00Z', title: 'new' });
  const merged = core.mergeCases([a, b], [aNew]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(c => c.id === 'a').title, 'new');
  assert.deepEqual(merged.map(c => c.id), ['b', 'a']);
  const stale = caseOf({ id: 'a', created: '2026-01-01T00:00:00Z', updated: '2025-12-01T00:00:00Z', title: 'stale' });
  assert.equal(core.mergeCases([a], [stale]).find(c => c.id === 'a').title, 'old');
});

test('mergeCases adds new cases and does not mutate its inputs', () => {
  const a = caseOf({ id: 'a' }), b = caseOf({ id: 'b' });
  const existing = [a];
  const merged = core.mergeCases(existing, [b]);
  assert.equal(merged.length, 2);
  assert.equal(existing.length, 1);
});

test('filterCases combines text, status and category filters', () => {
  const cases = [
    caseOf({ id: '1', title: 'Wi-Fi drops', category: 'internet', status: 'closed', outcome: 'resolved' }),
    caseOf({ id: '2', title: 'App crashes', category: 'software', status: 'in-progress' }),
    caseOf({ id: '3', title: 'Router lights', category: 'internet', status: 'closed', outcome: 'unresolved' })
  ];
  const ids = f => core.filterCases(cases, f).map(c => c.id);
  assert.deepEqual(ids({}), ['1', '2', '3']);
  assert.deepEqual(ids({ query: ' WI-FI ' }), ['1']);
  assert.deepEqual(ids({ status: 'open' }), ['2']);
  assert.deepEqual(ids({ status: 'resolved' }), ['1']);
  assert.deepEqual(ids({ status: 'unresolved' }), ['3']);
  assert.deepEqual(ids({ category: 'internet' }), ['1', '3']);
  assert.deepEqual(ids({ category: 'internet', status: 'unresolved', query: 'router' }), ['3']);
  assert.deepEqual(ids({ query: 'zzz' }), []);
});

test('computeStats handles empty and populated lists', () => {
  const empty = core.computeStats([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.resolutionRate, null);
  assert.equal(empty.stepCompletion, null);
  const cases = [
    caseOf({ id: '1', status: 'closed', outcome: 'resolved', steps: [{ done: true }, { done: true }] }),
    caseOf({ id: '2', status: 'closed', outcome: 'partial', category: 'software', steps: [{ done: true }, { done: false }] }),
    caseOf({ id: '3', status: 'in-progress', steps: [{ done: false }, { done: false }] }),
    caseOf({ id: '4', status: 'closed', outcome: 'unresolved', steps: [] })
  ];
  const s = core.computeStats(cases);
  assert.deepEqual([s.total, s.resolved, s.partial, s.open], [4, 1, 1, 1]);
  assert.equal(s.resolutionRate, 25);
  assert.equal(s.stepCompletion, 50);
  assert.deepEqual(s.byCategory, { internet: 3, software: 1 });
});

test('buildSteps creates fresh, fully explained steps for every branch', () => {
  for (const id of categoryIds) {
    for (const [key, br] of Object.entries(data.playbooks[id].branches)) {
      const steps = core.buildSteps(data.playbooks, id, key);
      assert.equal(steps.length, br.steps.length);
      steps.forEach((s, i) => {
        assert.equal(s.id, i);
        assert.equal(s.text, `${br.steps[i].title}: ${br.steps[i].action}`);
        assert.ok(s.detail.length > 0, `${id}:${key}:${i} has an explanation`);
        assert.equal(core.detailFor(data.playbooks, id, key, i), s.detail);
        assert.deepEqual([s.done, s.failed, s.note], [false, false, '']);
      });
    }
  }
  assert.deepEqual(core.buildSteps(data.playbooks, 'internet', 'no-such-branch'), []);
  assert.equal(core.detailFor(data.playbooks, 'nope', 'nope', 0), '');
});

test('summaryText includes the evidence, log, outcome and attachment count', () => {
  const steps = core.buildSteps(data.playbooks, 'internet', 'timing');
  const c = caseOf({
    title: 'Wi-Fi keeps dropping', description: 'Every evening', branch: 'timing', platform: 'Windows', device: 'Laptop',
    steps, stepResults: { 0: 'helped', 1: 'worse' }, evidence: ['Location', 'Time of occurrence'], evidenceVals: { 1: '8pm daily' },
    log: [{ t: '2026-01-01T20:02:00Z', n: 'dropped again' }], notes: 'Changed channel',
    attachments: [{ id: 'a', name: 'p', data: PNG }]
  });
  const text = core.summaryText(c, data);
  for (const part of ['Wi-Fi keeps dropping', 'Every evening', 'Internet / Wi-Fi', 'Windows', 'Laptop', '1. ' + steps[0].text + ' — helped',
    '2. ' + steps[1].text + ' — worse', 'Time of occurrence: 8pm daily', 'dropped again', 'Outcome notes: Changed channel', 'Attachments: 1 image']) {
    assert.ok(text.includes(part), `summary contains "${part}"`);
  }
  assert.ok(!text.includes('Location:'), 'unfilled evidence is left out');
  assert.ok(text.includes(data.playbooks.internet.branches.timing.title));
});

test('summaryText copes with a nearly empty case', () => {
  const text = core.summaryText(core.normalizeCase({ title: 'Bare' }, categoryIds), data);
  assert.ok(text.includes('No steps recorded.'));
  assert.ok(text.includes('Not specified'));
  assert.ok(text.includes('Branch: Not selected'));
});

test('esc neutralises every character that can break out of markup or attributes', () => {
  assert.equal(core.esc('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
  assert.equal(core.esc(`it's & <b>`), 'it&#39;s &amp; &lt;b&gt;');
  assert.equal(core.esc(null), '');
  assert.equal(core.esc(undefined), '');
  assert.equal(core.esc(0), '0');
  assert.ok(!/[<>"']/.test(core.esc(`<>"'`)));
});

test('reportHtml includes every section, escapes user text and embeds only real images', () => {
  const steps = core.buildSteps(data.playbooks, 'internet', 'timing');
  const evil = '<img src=x onerror=alert(1)>';
  const c = caseOf({ title: evil, description: evil, branch: 'timing', steps, stepResults: { 0: 'helped', 1: 'worse' },
    evidence: ['Location'], evidenceVals: { 0: 'Kitchen' }, log: [{ t: '2026-01-01T20:00:00Z', n: 'dropped' }], notes: 'Changed channel', outcome: 'resolved', status: 'closed' });
  const html = core.reportHtml(c, data, [{ name: 'good', data: PNG }, { name: 'bad', data: 'javascript:alert(1)' }]);
  for (const part of ['Troubleshooting report', 'Internet / Wi-Fi', 'Helped', 'Got worse', 'Not tested', 'Kitchen', 'dropped', 'Changed channel', 'Resolved', 'Photos and screenshots', steps[0].text.split(':')[0]]) {
    assert.ok(html.includes(part), `report contains "${part}"`);
  }
  assert.ok(!html.includes(evil), 'raw markup is never inserted');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal((html.match(/<img /g) || []).length, 1, 'only the valid image is embedded');
  assert.ok(!html.includes('javascript:'));
});

test('reportHtml leaves out empty sections and uses the translate hook', () => {
  const html = core.reportHtml(core.normalizeCase({ title: 'Bare' }, categoryIds), { ...data, t: s => '«' + s + '»' });
  assert.ok(!html.includes('Incident log') && !html.includes('Evidence') && !html.includes('Photos'));
  assert.ok(html.includes('«Troubleshooting report»'));
});

test('normalizeCase keeps IndexedDB-backed attachments (metadata only) when the id is safe', () => {
  const c = caseOf({ attachments: [
    { id: 'img-1', name: 'router', idb: true },
    { id: 'img-2', name: 'inline', data: PNG },
    { id: '"><x>', name: 'unsafe id', idb: true },
    { id: 'img-3', name: 'neither' },
    { id: 'img-4', name: 'object data', data: { toString: () => PNG } },
    { id: 'img-5', name: 'idb truthy string', idb: 'yes' }
  ] });
  assert.deepEqual(c.attachments.map(a => a.id), ['img-1', 'img-2']);
  assert.deepEqual(c.attachments[0], { id: 'img-1', name: 'router', idb: true });
  assert.equal('data' in c.attachments[0], false);
  assert.equal(c.attachments[1].data, PNG);
});
