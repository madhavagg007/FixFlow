const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { render, OUT } = require('../scripts/build-data.js');
const { data } = require('./helpers');

test('js/data.js is up to date with data/playbooks.json (run: npm run build:data)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), render());
});

test('js/data.js defines the globals the app expects', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(OUT, 'utf8') + '\nthis.out = { categories, commonProblems, playbooks };', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.out.categories)), data.categories);
  assert.deepEqual(Object.keys(ctx.out.playbooks), Object.keys(data.playbooks));
});

test('dist/fixflow-single.html is up to date (run: npm run build:single)', () => {
  const bundle = require('../scripts/bundle.js');
  assert.equal(fs.readFileSync(bundle.OUT, 'utf8'), bundle.render());
});

test('the single-file build is self-contained', () => {
  const html = require('../scripts/bundle.js').render();
  assert.ok(!/<script src=/.test(html), 'no external scripts');
  assert.ok(!/rel="stylesheet"/.test(html), 'no external stylesheet');
  assert.ok(!/rel="manifest"/.test(html), 'no manifest link without a service worker');
  assert.ok(html.includes('function routeBranch'), 'core logic inlined');
  assert.ok(html.includes('const FIXFLOW_DATA'), 'data inlined');
});
