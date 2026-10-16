#!/usr/bin/env node
/* Generates js/data.js (what the browser loads) from data/playbooks.json (the source of truth).
   Edit the JSON, then run: npm run build:data */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'playbooks.json');
const OUT = path.join(ROOT, 'js', 'data.js');

function render() {
  const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  for (const key of ['categories', 'commonProblems', 'playbooks']) {
    if (!data[key]) throw new Error(`data/playbooks.json is missing "${key}"`);
  }
  return (
    '/* GENERATED FILE: do not edit by hand.\n' +
    '   Source: data/playbooks.json   Regenerate: npm run build:data */\n' +
    'const FIXFLOW_DATA = ' + JSON.stringify(data) + ';\n' +
    'const { categories, commonProblems, playbooks } = FIXFLOW_DATA;\n'
  );
}

module.exports = { render, OUT };

if (require.main === module) {
  fs.writeFileSync(OUT, render());
  console.log('Wrote', path.relative(ROOT, OUT));
}
