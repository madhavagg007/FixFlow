const test = require('node:test');
const assert = require('node:assert/strict');
const { data, categoryIds } = require('./helpers');

const nonEmpty = v => typeof v === 'string' && v.trim().length > 0;

test('every category has a playbook and a list of common problems', () => {
  assert.ok(categoryIds.length >= 6);
  assert.equal(new Set(categoryIds).size, categoryIds.length, 'category ids are unique');
  for (const id of categoryIds) {
    assert.ok(data.playbooks[id], `playbook for ${id}`);
    assert.ok(Array.isArray(data.commonProblems[id]) && data.commonProblems[id].length > 0, `common problems for ${id}`);
  }
  for (const c of data.categories) {
    assert.ok(nonEmpty(c.name) && nonEmpty(c.icon) && nonEmpty(c.depth), `category ${c.id} has name, icon and depth`);
  }
});

test('common problems and symptoms are [id, title, description] with unique ids', () => {
  for (const id of categoryIds) {
    for (const list of [data.commonProblems[id], data.playbooks[id].symptoms]) {
      const ids = new Set();
      for (const row of list) {
        assert.equal(row.length, 3, `${id}: row has 3 parts`);
        assert.ok(row.every(nonEmpty), `${id}: no empty parts in ${row[0]}`);
        assert.ok(!ids.has(row[0]), `${id}: duplicate id ${row[0]}`);
        ids.add(row[0]);
      }
    }
  }
});

test('questions are well formed', () => {
  for (const id of categoryIds) {
    const qs = data.playbooks[id].questions;
    assert.ok(qs.length >= 3 && qs.length <= 4, `${id}: 3-4 questions`);
    for (const q of qs) {
      assert.ok(nonEmpty(q.q) && nonEmpty(q.yes) && nonEmpty(q.no), `${id}: question fields`);
      assert.notEqual(q.yes, q.no, `${id}: yes and no keys differ in "${q.q}"`);
      assert.ok(nonEmpty(q.yl) && nonEmpty(q.nl), `${id}: both answer buttons have a label in "${q.q}"`);
    }
  }
});

test('every branch has a title and at least 3 complete steps', () => {
  for (const id of categoryIds) {
    const { branches } = data.playbooks[id];
    assert.ok(Object.keys(branches).length >= 4, `${id}: enough branches`);
    for (const [key, br] of Object.entries(branches)) {
      assert.ok(nonEmpty(br.title), `${id}:${key} title`);
      assert.ok(br.steps.length >= 3, `${id}:${key} has at least 3 steps`);
      br.steps.forEach((s, i) => {
        assert.ok(nonEmpty(s.title), `${id}:${key} step ${i + 1} title`);
        assert.ok(nonEmpty(s.action), `${id}:${key} step ${i + 1} action`);
        assert.ok(nonEmpty(s.detail), `${id}:${key} step ${i + 1} explanation`);
      });
    }
  }
});

test('every playbook lists evidence to collect', () => {
  for (const id of categoryIds) {
    const ev = data.playbooks[id].evidence;
    assert.ok(Array.isArray(ev) && ev.length >= 3 && ev.every(nonEmpty), `${id}: evidence`);
  }
});

test('household playbook never tells people to open or repair hazardous items', () => {
  const text = JSON.stringify(data.playbooks.household.branches.hazard).toLowerCase();
  assert.ok(/do not (touch|open)/.test(text), 'hazard branch says not to touch or open the item');
  assert.ok(/emergency|licensed|qualified|professional/.test(text), 'hazard branch points to a professional or emergency help');
});
