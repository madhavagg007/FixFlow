#!/usr/bin/env node
/* Builds dist/fixflow-single.html: the whole app in ONE file (CSS and JS inlined, no service worker).
   Handy for sharing, previews and opening straight from disk. Run: npm run build:single */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'fixflow-single.html');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function render() {
  let html = read('index.html');
  html = html.replace(/<link rel="manifest"[^>]*>\n?/, '').replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '');
  html = html.replace('<link rel="stylesheet" href="css/styles.css">', () => `<style>\n${read('css/styles.css')}</style>`);
  html = html.replace(/<script src="js\/([^"]+)"><\/script>\n?/g, (tag, file) => {
    if (file === 'pwa.js') return '';                                   // install/offline need a real origin
    const code = read('js/' + file);
    if (code.includes('</script')) throw new Error(`${file} contains "</script" and cannot be inlined`);
    return `<script>\n${code}</script>\n`;
  });
  return html;
}

module.exports = { render, OUT };

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, render());
  console.log('Wrote', path.relative(ROOT, OUT), `(${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}
