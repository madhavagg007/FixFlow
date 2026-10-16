/* FixFlow core: pure logic with no DOM access.
   Loaded as a plain script in the browser (functions become globals) and
   with require() in Node, where the unit tests import it directly. */

const OUT = { resolved: 'Resolved', partial: 'Partly helped', unresolved: 'Unresolved' };

/* HTML-escapes user text before it is placed into markup. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function uid() {
  return globalThis.crypto?.randomUUID?.() || ('c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
}

function fmt(d) {
  const x = new Date(d);
  return isNaN(x) ? 'Unknown date' : x.toLocaleString();
}

/* ---- Diagnosis routing ----
   Maps a category's answers to a branch key in data/playbooks.json.
   Answers are stored by their key (for example a[0] === 'single'). Every branch of every
   category is reachable; tests/routing.test.js proves it. */
function routeBranch(category, a) {
  a = a || {};
  const R = {
    internet: () => {
      if (a[0] === 'single') return 'single';                       // other devices are fine: device-side
      const router = a[1] === 'router', signal = a[2] === 'signal', timing = a[3] === 'timing';
      const clues = router + signal + timing;
      if (clues === 3) return 'multi';
      if (clues === 0) return 'persistent';
      if (clues === 1) return router ? 'router' : signal ? 'signal' : 'timing';
      return router && signal ? 'not-timing' : router && timing ? 'not-signal' : 'signal';
    },
    device: () =>
      a[1] === 'change' ? (a[0] === 'broad' ? 'change' : 'single')
        : a[0] === 'broad' ? (a[2] === 'restart' ? 'restart' : 'broad')
        : (a[2] === 'restart' ? 'nochange' : 'persistent'),
    software: () => {
      const err = a[1] === 'error', recent = a[2] === 'recent', oneItem = a[3] === 'oneitem';
      if (err) return recent ? 'recent' : 'error';
      if (recent) return oneItem ? 'noerror' : 'recent';
      if (a[0] === 'intermittent') return 'intermittent';
      return oneItem ? 'repeat' : 'norecent';
    },
    website: () =>
      a[0] === 'browser' ? (a[1] === 'local' && a[2] === 'noerror' ? 'local' : 'browser')
        : a[1] === 'broad' ? (a[2] === 'error' ? 'broad' : 'notbrowser')
        : (a[2] === 'error' ? 'error' : 'noerror'),
    study: () =>
      a[0] === 'clear'
        ? (a[1] === 'distraction' ? (a[2] === 'recall' ? 'clear' : 'distraction') : (a[2] === 'recall' ? 'recall' : 'weakrecall'))
        : (a[1] === 'internal' && a[2] === 'recall' ? 'internal' : 'unclear'),
    household: () => a[0] === 'hazard' ? 'hazard' : a[1] === 'stop' ? 'stop' : a[2] === 'manual' ? 'safe' : 'visible',
    other: () =>
      a[1] === 'change' ? (a[0] === 'intermittent' && a[2] === 'nocompare' ? 'intermittent' : 'change')
        : a[0] === 'repeat' ? (a[2] === 'compare' ? 'compare' : 'repeat')
        : (a[2] === 'compare' ? 'nochange' : 'nocompare')
  };
  return (R[category] || (() => 'other'))();
}

/* 1-based numbers of the questions that have no answer yet. */
function missingAnswers(questions, answers) {
  return questions.map((q, i) => (!answers?.[i] ? i + 1 : null)).filter(Boolean);
}

function detailFor(playbooks, category, branch, i) {
  return playbooks[category]?.branches?.[branch]?.steps?.[i]?.detail || '';
}

function buildSteps(playbooks, category, branch) {
  return (playbooks[category]?.branches?.[branch]?.steps || []).map((s, i) => ({
    id: i, text: s.title + ': ' + s.action, detail: s.detail || '', done: false, failed: false, note: ''
  }));
}

/* ---- Case data hygiene ---- */
const ATTACHMENT_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
const SAFE_ID_RE = /^[\w-]{1,64}$/;
const isSafeId = v => typeof v === 'string' && SAFE_ID_RE.test(v);

/* Rebuilds any case-shaped object into a safe, complete case. Used on load and on import so
   old, partial or hostile data can never crash the UI or inject markup through ids. */
function normalizeCase(c, categoryIds) {
  if (!c || typeof c !== 'object') return null;
  const now = new Date().toISOString();
  const arr = x => (Array.isArray(x) ? x : []);
  const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  return {
    ...c,
    id: isSafeId(c.id) ? c.id : uid(),
    created: c.created || now,
    updated: c.updated || c.created || now,
    title: String(c.title || ''),
    description: String(c.description || ''),
    category: (categoryIds || []).includes(c.category) ? c.category : 'other',
    answers: obj(c.answers),
    stepResults: obj(c.stepResults),
    quickChecks: obj(c.quickChecks),
    evidence: arr(c.evidence).map(String),
    evidenceVals: obj(c.evidenceVals),
    attachments: arr(c.attachments)
      .filter(a => a && (typeof a.data === 'string' ? ATTACHMENT_RE.test(a.data) : a.idb === true && isSafeId(a.id)))
      .slice(0, 6)
      .map(a => {
        const base = { id: isSafeId(a.id) ? a.id : uid(), name: String(a.name || 'image').slice(0, 60) };
        return typeof a.data === 'string' ? { ...base, data: a.data } : { ...base, idb: true };
      }),
    log: arr(c.log),
    branch: String(c.branch || ''),
    status: c.status || 'open',
    steps: arr(c.steps).map((t, i) => ({
      id: i, text: String(t?.text || ''), detail: String(t?.detail || ''),
      done: !!t?.done, failed: !!t?.failed, note: String(t?.note || '')
    }))
  };
}

/* Merge imported cases into existing ones: same id keeps the newer copy; newest first. */
function mergeCases(existing, incoming) {
  const byId = new Map(existing.map(c => [c.id, c]));
  incoming.forEach(c => {
    const old = byId.get(c.id);
    if (!old || String(c.updated) > String(old.updated)) byId.set(c.id, c);
  });
  return [...byId.values()].sort((p, q) => String(q.created).localeCompare(String(p.created)));
}

function filterCases(cases, { query = '', status = 'all', category = 'all' } = {}) {
  const q = query.toLowerCase().trim();
  return cases.filter(c =>
    `${c.title} ${c.description} ${c.category} ${c.outcome || ''}`.toLowerCase().includes(q) &&
    (status === 'all' || (status === 'open' ? c.status !== 'closed' : c.outcome === status)) &&
    (category === 'all' || c.category === category)
  );
}

function computeStats(cases) {
  const total = cases.length;
  const resolved = cases.filter(c => c.outcome === 'resolved').length;
  const partial = cases.filter(c => c.outcome === 'partial').length;
  const open = cases.filter(c => c.status !== 'closed').length;
  const doneSteps = cases.reduce((n, c) => n + (c.steps || []).filter(s => s.done).length, 0);
  const allSteps = cases.reduce((n, c) => n + (c.steps || []).length, 0);
  const byCategory = {};
  cases.forEach(c => { byCategory[c.category] = (byCategory[c.category] || 0) + 1; });
  return {
    total, resolved, partial, open, byCategory,
    resolutionRate: total ? Math.round(resolved / total * 100) : null,
    stepCompletion: allSteps ? Math.round(doneSteps / allSteps * 100) : null
  };
}

/* ---- Support summary ---- */
function evidenceSummary(c) {
  const ev = c.evidence || [];
  const lines = ev.map((x, i) => (c.evidenceVals?.[i] ? `- ${x}: ${c.evidenceVals[i]}` : '')).filter(Boolean);
  const attached = (c.attachments || []).length;
  return (lines.length ? '\n\nEvidence:\n' + lines.join('\n') : '') +
    (attached ? `\n\nAttachments: ${attached} image(s) saved in FixFlow. Attach them manually when contacting support.` : '');
}

function summaryText(c, { categories, commonProblems, playbooks }) {
  const category = categories.find(k => k.id === c.category)?.name || c.category;
  const problem = (commonProblems[c.category] || []).find(x => x[0] === c.symptom)?.[1] || c.title;
  const steps = (c.steps || [])
    .map((s, i) => `${i + 1}. ${s.text} — ${c.stepResults?.[i] || 'not tested'}${s.note ? ' — ' + s.note : ''}`)
    .join('\n');
  const log = (c.log || []).length
    ? '\n\nIncident log:\n' + c.log.map(l => '- ' + fmt(l.t) + (l.n ? ' — ' + l.n : '')).join('\n')
    : '';
  return `FixFlow troubleshooting summary\n\nProblem: ${problem}\nDetails: ${c.description}\nCategory: ${category}\n` +
    `Platform: ${c.platform || 'Not specified'}\nDevice/service: ${c.device || 'Not specified'}\nUrgency: ${c.severity || 'Normal'}\n` +
    `Branch: ${playbooks[c.category]?.branches[c.branch]?.title || 'Not selected'}\n\nSteps and observations:\n${steps || 'No steps recorded.'}` +
    `${evidenceSummary(c)}${log}${c.notes ? '\n\nOutcome notes: ' + c.notes : ''}`;
}

/* ---- Printable report (used for "Save as PDF") ---- */
const RESULT_LABELS = { helped: 'Helped', same: 'No change', worse: 'Got worse' };

/* Returns the HTML of a one-case report. Every user-supplied value is escaped, and only real
   image data URLs are embedded. ctx.t is an optional translate function. */
function reportHtml(c, { categories, commonProblems, playbooks, t = s => s }, images = []) {
  const category = categories.find(k => k.id === c.category)?.name || c.category;
  const branch = playbooks[c.category]?.branches?.[c.branch]?.title || '';
  const row = (k, v) => (v ? `<tr><th>${esc(t(k))}</th><td>${esc(v)}</td></tr>` : '');
  const outcome = c.outcome ? (OUT[c.outcome] ? t(OUT[c.outcome]) : c.outcome) : (c.status === 'closed' ? t('Closed') : t('In progress'));
  const steps = (c.steps || []).map((s, i) => {
    const res = c.stepResults?.[i];
    const label = res ? t(RESULT_LABELS[res] || String(res)) : t('Not tested');
    return `<li class="rp-step"><div>${esc(s.text)}</div><div class="rp-res">${esc(label)}${s.note ? ' — ' + esc(s.note) : ''}</div></li>`;
  }).join('');
  const ev = (c.evidence || []).map((x, i) => (c.evidenceVals?.[i] ? row(x, c.evidenceVals[i]) : '')).join('');
  const log = (c.log || []).map(l => `<li>${esc(fmt(l.t))}${l.n ? ' — ' + esc(l.n) : ''}</li>`).join('');
  const pics = images.filter(im => im && ATTACHMENT_RE.test(im.data || ''))
    .map(im => `<figure><img src="${im.data}" alt="${esc(im.name)}"><figcaption>${esc(im.name)}</figcaption></figure>`).join('');
  return `<article class="rp">
<header><div class="rp-brand">FixFlow</div><h1>${esc(c.title || t('Untitled case'))}</h1>
<p class="rp-sub">${esc(t('Troubleshooting report'))} · ${esc(fmt(new Date()))}</p></header>
<table class="rp-table">${row('Category', category)}${row('Platform', c.platform)}${row('Device/service', c.device)}${row('Urgency', c.severity)}${row('Started', fmt(c.created))}${row('Route', branch)}${row('Outcome', outcome)}</table>
<h2>${esc(t('Problem'))}</h2><p>${esc(c.description)}</p>
${steps ? `<h2>${esc(t('Steps and results'))}</h2><ol class="rp-steps">${steps}</ol>` : ''}
${ev ? `<h2>${esc(t('Evidence'))}</h2><table class="rp-table">${ev}</table>` : ''}
${log ? `<h2>${esc(t('Incident log'))}</h2><ul>${log}</ul>` : ''}
${c.notes ? `<h2>${esc(t('What was learned'))}</h2><p>${esc(c.notes)}</p>` : ''}
${pics ? `<h2>${esc(t('Photos and screenshots'))}</h2><div class="rp-pics">${pics}</div>` : ''}
<footer>${esc(t('Generated by FixFlow. General guidance only.'))}</footer></article>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OUT, esc, uid, fmt, routeBranch, missingAnswers, detailFor, buildSteps,
    normalizeCase, mergeCases, filterCases, computeStats, evidenceSummary, summaryText, reportHtml, RESULT_LABELS
  };
}
