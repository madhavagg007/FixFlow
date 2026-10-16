const test = require('node:test');
const assert = require('node:assert/strict');
const { data, core, allAnswerSets, categoryIds } = require('./helpers');

test('every answer combination routes to a branch that exists', () => {
  for (const id of categoryIds) {
    for (const answers of allAnswerSets(id)) {
      const branch = core.routeBranch(id, answers);
      assert.ok(data.playbooks[id].branches[branch], `${id} ${JSON.stringify(answers)} -> "${branch}" is not a branch`);
    }
  }
});

test('every branch of every category can be reached', () => {
  for (const id of categoryIds) {
    const reached = new Set(allAnswerSets(id).map(a => core.routeBranch(id, a)));
    const unreachable = Object.keys(data.playbooks[id].branches).filter(b => !reached.has(b));
    assert.deepEqual(unreachable, [], `${id}: unreachable branches`);
  }
});

test('routing is deterministic', () => {
  for (const id of categoryIds) {
    for (const answers of allAnswerSets(id)) {
      assert.equal(core.routeBranch(id, answers), core.routeBranch(id, { ...answers }));
    }
  }
});

test('household: a possible hazard always wins', () => {
  for (const answers of allAnswerSets('household').filter(a => a[0] === 'hazard')) {
    assert.equal(core.routeBranch('household', answers), 'hazard');
  }
});

test('household: no hazard but unsafe to inspect means stop', () => {
  assert.equal(core.routeBranch('household', { 0: 'safe', 1: 'stop', 2: 'manual' }), 'stop');
});

const scenarios = [
  ['internet', { 0: 'single', 1: 'router', 2: 'signal', 3: 'timing' }, 'single', 'only one device affected is a device problem'],
  ['internet', { 0: 'multi', 1: 'persistent', 2: 'not-signal', 3: 'not-timing' }, 'persistent', 'no clues at all'],
  ['internet', { 0: 'multi', 1: 'router', 2: 'signal', 3: 'timing' }, 'multi', 'every clue points to the network'],
  ['internet', { 0: 'multi', 1: 'router', 2: 'signal', 3: 'not-timing' }, 'not-timing', 'router and location clues but no time pattern'],
  ['software', { 0: 'repeat', 1: 'error', 2: 'recent', 3: 'everywhere' }, 'recent', 'error after a change starts from the change'],
  ['software', { 0: 'intermittent', 1: 'noerror', 2: 'norecent', 3: 'everywhere' }, 'intermittent', 'no error, no change, comes and goes'],
  ['website', { 0: 'browser', 1: 'local', 2: 'noerror' }, 'local', 'works in another browser, local only, no error'],
  ['study', { 0: 'unclear', 1: 'distraction', 2: 'recall' }, 'unclear', 'an unclear task is fixed first'],
  ['device', { 0: 'broad', 1: 'change', 2: 'persistent' }, 'change', 'system-wide after a change']
];
for (const [category, answers, expected, why] of scenarios) {
  test(`${category}: ${why}`, () => assert.equal(core.routeBranch(category, answers), expected));
}

test('unknown categories and missing answers fall back safely', () => {
  assert.equal(core.routeBranch('nonsense', {}), 'other');
  assert.doesNotThrow(() => core.routeBranch('internet'));
  for (const id of categoryIds) assert.doesNotThrow(() => core.routeBranch(id, {}));
});

test('missingAnswers reports unanswered question numbers', () => {
  const qs = data.playbooks.internet.questions;
  assert.deepEqual(core.missingAnswers(qs, {}), [1, 2, 3, 4]);
  assert.deepEqual(core.missingAnswers(qs, { 0: 'multi', 2: 'signal' }), [2, 4]);
  assert.deepEqual(core.missingAnswers(qs, { 0: 'a', 1: 'b', 2: 'c', 3: 'd' }), []);
  assert.deepEqual(core.missingAnswers(qs, undefined), [1, 2, 3, 4]);
});
