const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { root } = require('./helpers');

const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');
const sw = read('sw.js');
const manifest = JSON.parse(read('manifest.webmanifest'));

const localRefs = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map(m => m[1]).filter(u => !/^(https?:|data:)/.test(u));

test('every local file index.html loads exists', () => {
  assert.ok(localRefs.length >= 8);
  for (const ref of localRefs) assert.ok(fs.existsSync(path.join(root, ref)), `${ref} exists`);
});

test('the service worker caches every file the page needs', () => {
  const shell = [...sw.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
  for (const ref of localRefs) {
    assert.ok(shell.includes(ref), `sw.js SHELL is missing ${ref}`);
  }
  for (const file of shell) assert.ok(fs.existsSync(path.join(root, file)), `SHELL entry ${file} exists`);
});

test('manifest is installable', () => {
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.name && manifest.short_name && manifest.start_url);
  const sizes = manifest.icons.map(i => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root, icon.src)), `${icon.src} exists`);
});

test('scripts load in dependency order', () => {
  const order = [...html.matchAll(/<script src="js\/([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(order, ['data.js', 'core.js', 'imagedb.js', 'state.js', 'ui.js', 'events.js', 'pwa.js', 'main.js']);
});
