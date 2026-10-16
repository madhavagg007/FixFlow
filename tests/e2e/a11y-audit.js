/* Accessibility audit run inside the page by tests/e2e/run.py.
   Checks names, labels, alt text, duplicate ids, tap-target size and WCAG AA colour contrast. */
() => {
  const out = {names:[], labels:[], imgs:[], contrast:[], small:[], structure:[], ids:[]};
  const vis = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const name = e => (e.getAttribute('aria-label') || e.getAttribute('title') || (e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.textContent) || e.textContent || '').trim();
  const desc = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + (e.className || '').toString().split(' ')[0] + ' "' + name(e).slice(0, 25) + '"';
  document.querySelectorAll('button, a[href], [role=button]').forEach(e => { if (vis(e) && !name(e)) out.names.push(desc(e)); });
  document.querySelectorAll('input:not([type=hidden]), select, textarea').forEach(e => {
    if (!vis(e) && e.type !== 'file') return;
    const lab = e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.id && document.querySelector('label[for="' + e.id + '"]')) || e.closest('label');
    if (!lab) out.labels.push(desc(e) + ' placeholder=' + (e.placeholder || ''));
  });
  document.querySelectorAll('img').forEach(e => { if (!e.hasAttribute('alt')) out.imgs.push(e.src.slice(0, 40)); });
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1}; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
  const bgOf = e => { let n = e, layers = []; while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } n = n.parentElement; }
    let base = {r: 255, g: 255, b: 255}; for (let i = layers.length - 1; i >= 0; i--) { const l = layers[i]; base = {r: l.r * l.a + base.r * (1 - l.a), g: l.g * l.a + base.g * (1 - l.a), b: l.b * l.a + base.b * (1 - l.a)}; } return base; };
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode; if (!t.textContent.trim()) continue; const e = t.parentElement; if (!e || !vis(e) || seen.has(e)) continue; seen.add(e);
    if (e.closest('script,style,[hidden]')) continue; { let n = e, grad = false; while (n) { if (getComputedStyle(n).backgroundImage !== 'none') { grad = true; break; } n = n.parentElement; } if (grad) continue; }
    const s = getComputedStyle(e); if (parseFloat(s.opacity) < 1 && parseFloat(s.opacity) === 0) continue;
    const fg = parse(s.color); if (!fg) continue; const bg = bgOf(e);
    const fgm = {r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a)};
    const L1 = lum(fgm), L2 = lum(bg), ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
    const size = parseFloat(s.fontSize), bold = parseInt(s.fontWeight) >= 700, large = size >= 24 || (size >= 18.66 && bold);
    if (ratio < (large ? 3 : 4.5)) out.contrast.push(ratio.toFixed(2) + ' ' + desc(e).slice(0, 50) + ' ' + s.color + ' on ' + `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`);
  }
  document.querySelectorAll('button, a[href], input, select, textarea').forEach(e => { if (!vis(e)) return; const r = e.getBoundingClientRect(); if ((r.width < 24 || r.height < 24) && e.type !== 'file') out.small.push(desc(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); });
  out.structure.push('lang=' + (document.documentElement.lang || 'MISSING'), 'title=' + (document.title ? 'ok' : 'MISSING'), 'h1=' + document.querySelectorAll('h1').length,
    'main=' + document.querySelectorAll('main,[role=main]').length, 'nav=' + document.querySelectorAll('nav,[role=navigation]').length, 'header=' + document.querySelectorAll('header').length,
    'toast-live=' + (document.getElementById('toast')?.getAttribute('aria-live') || document.getElementById('toast')?.getAttribute('role') || 'NONE'),
    'aria-current=' + document.querySelectorAll('[aria-current]').length);
  const ids = {}; document.querySelectorAll('[id]').forEach(e => ids[e.id] = (ids[e.id] || 0) + 1); out.ids = Object.entries(ids).filter(x => x[1] > 1).map(x => x[0]);
  return out; }
