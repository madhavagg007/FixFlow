#!/usr/bin/env python3
"""Browser end-to-end tests for FixFlow (real Chromium via Playwright).

Run:  python3 tests/e2e/run.py
Setup: pip install playwright && playwright install chromium
It serves the project on a free local port, so nothing else needs to be running.
"""
import json, re, socket, struct, subprocess, sys, tempfile, time, zlib
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
VERSION = re.search(r"const VERSION = '([^']+)'", (ROOT / 'sw.js').read_text()).group(1)
CACHE = 'fixflow-' + VERSION

def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); return s.getsockname()[1]

def tiny_png(path):
    w = h = 64
    raw = b''.join(b'\x00' + b''.join(bytes([(x * 4) % 256, (y * 4) % 256, 180]) for x in range(w)) for y in range(h))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) +
                     chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))

def noise_png(path, w=1000, h=1000):
    import os
    raw = b''.join(b'\x00' + os.urandom(w * 3) for _ in range(h))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 1)) + chunk(b'IEND', b''))

def reload_home(page):
    """Reload on the home screen (deep links like #/history would otherwise reopen that screen)."""
    page.evaluate("history.replaceState(null, '', location.pathname + location.search)")
    page.reload(); page.wait_for_selector('text=Real problems')

failures, js_errors = [], []

def check(name, ok, detail=''):
    print(('PASS  ' if ok else 'FAIL  ') + name + ('' if ok else f'   -> {detail}'))
    if not ok: failures.append(name)

def main():
    port = free_port()
    server = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'],
                              cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    base = f'http://127.0.0.1:{port}/'
    tmp = Path(tempfile.mkdtemp()); img = tmp / 'test.png'; tiny_png(img)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={'width': 1100, 'height': 800}, service_workers='allow')
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: js_errors.append(str(e)))
            pg.on('console', lambda m: js_errors.append('console: ' + m.text) if m.type == 'error' else None)
            pg.goto(base); pg.wait_for_selector('text=Real problems')

            # ---- PWA ----
            pg.evaluate('navigator.serviceWorker.ready.then(() => 1)')
            reload_home(pg)
            check('service worker controls the page', pg.evaluate('!!navigator.serviceWorker.controller'))
            check('versioned cache created', pg.evaluate('caches.keys()') == [CACHE], pg.evaluate('caches.keys()'))
            cached = pg.evaluate(f"caches.open('{CACHE}').then(c => c.keys()).then(r => r.map(x => new URL(x.url).pathname))")
            shell = re.findall(r"'\./([^']*)'", re.search(r'const SHELL = \[(.*?)\];', (ROOT / 'sw.js').read_text(), re.S).group(1))
            missing = [f for f in shell if '/' + f not in cached and f != '']
            check('whole app shell is cached', not missing, missing)
            man = pg.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
            check('manifest icons load', all(pg.evaluate(f"fetch('{i['src']}').then(r => r.status)") == 200 for i in man['icons']))
            ctx.set_offline(True)
            pg.reload(); pg.wait_for_selector('text=Real problems', timeout=8000)
            check('loads while offline', True)
            check('offline badge shows', pg.evaluate("!document.getElementById('netBadge').hidden"))
            pg.evaluate("startSpecific('internet', commonProblems.internet[0][0])")
            pg.fill('#problemDesc', 'Wi-Fi drops every evening'); pg.evaluate('nextDiagnosis()')
            check('a case can be started offline', 'Step 2' in pg.inner_text('#caseStage'))
            ctx.set_offline(False)
            pg.evaluate('localStorage.clear()'); reload_home(pg)
            check('offline badge hides when back online', pg.evaluate("document.getElementById('netBadge').hidden"))

            # ---- every category x every answer combination, in the real app ----
            res = pg.evaluate("""() => {
              const out = {combos: 0, bad: [], noDetail: [], branches: {}};
              for (const cat of categories.map(c => c.id)) {
                const qs = playbooks[cat].questions, seen = new Set();
                for (let m = 0; m < (1 << qs.length); m++) {
                  startSpecific(cat, commonProblems[cat][0][0]);
                  current.title = 'T'; current.description = 'D';
                  qs.forEach((q, i) => current.answers[i] = (m >> i & 1) ? q.yes : q.no);
                  renderDiagnosisQuestions(); buildPlan(); out.combos++;
                  const failed = document.getElementById('caseBody').innerHTML.includes('could not build');
                  if (failed || !current.branch || !current.steps.length) out.bad.push(cat + ':' + m);
                  seen.add(current.branch);
                  current.steps.forEach((s, i) => { if (!(s.detail || detailFor(playbooks, cat, current.branch, i))) out.noDetail.push(cat + ':' + current.branch + ':' + i); });
                }
                out.branches[cat] = [seen.size, Object.keys(playbooks[cat].branches).length];
              }
              return out; }""")
            check(f"all {res['combos']} category/answer combinations build a plan", not res['bad'], res['bad'][:5])
            check('every plan step is explained', not res['noDetail'], res['noDetail'][:5])
            check('every branch is reachable in the browser', all(a == b for a, b in res['branches'].values()), res['branches'])

            # ---- a realistic case, end to end ----
            pg.evaluate('localStorage.clear()'); reload_home(pg)
            pg.evaluate("startSpecific('internet', commonProblems.internet[0][0])")
            pg.fill('#problemTitle', 'Wi-Fi keeps dropping'); pg.fill('#problemDesc', 'Drops every evening around 8pm on all devices.')
            pg.evaluate('nextDiagnosis()')
            pg.evaluate("setAnswer(0,'multi'); setAnswer(1,'persistent'); setAnswer(2,'not-signal'); setAnswer(3,'timing')")
            pg.click('[data-action="build-plan"]'); pg.wait_for_selector('text=Why this route')
            check('plan is built from a real click', pg.evaluate('current.branch') == 'timing', pg.evaluate('current.branch'))
            inputs = pg.locator('.ev-grid input')
            check('evidence fields render', inputs.count() >= 3, inputs.count())
            inputs.nth(0).fill('Router model X'); inputs.nth(0).blur()
            check('evidence is saved', pg.evaluate('current.evidenceVals[0]') == 'Router model X')
            pg.set_input_files('#attachFile', str(img)); pg.wait_for_selector('.thumb img')
            check('photo is stored in IndexedDB, not in localStorage',
                  pg.evaluate("current.attachments.length === 1 && current.attachments[0].idb === true && !('data' in current.attachments[0])")
                  and pg.evaluate("imageDB.get(current.attachments[0].id).then(b => !!b && b.type === 'image/jpeg' && b.size > 0)"))
            pg.wait_for_function("[...document.querySelectorAll('.thumb img')].some(i => i.src.startsWith('data:image/jpeg'))")
            check('thumbnail loads from IndexedDB', True)
            pg.evaluate("current.log = [{t: new Date().toISOString(), n: 'dropped at 8:02pm'}]; saveCurrent(); renderPlan(playbooks[current.category].branches[current.branch])")
            summary = pg.evaluate('buildSupportSummary()')
            check('support summary has evidence, log and attachments', all(x in summary for x in ['Router model X', 'dropped at 8:02pm', 'Attachments: 1']), summary[:300])
            pg.evaluate("current.status = 'closed'; current.outcome = 'resolved'; current.notes = 'Changed channel'; saveCurrent()")
            reload_home(pg)
            check('case survives a reload', pg.evaluate('JSON.parse(localStorage.getItem(KEY)).cases.length') == 1)

            pg.evaluate("go('history'); histStatus = 'unresolved'; renderHistory()")
            check('status filter hides a resolved case', 'Wi-Fi keeps dropping' not in pg.inner_text('#historyResults'))
            pg.evaluate("histStatus = 'resolved'; renderHistory()")
            check('status filter shows a resolved case', 'Wi-Fi keeps dropping' in pg.inner_text('#historyResults'))
            pg.evaluate("histStatus = 'all'; renderHistory()")

            # ---- backup import (merge, hostile ids) ----
            backup = tmp / 'backup.json'
            backup.write_text(json.dumps({'version': 2, 'cases': [
                {'id': '"><img src=x onerror=window.__pwned=1>', 'title': 'Evil id', 'description': 'x', 'category': 'internet'},
                {'id': 'imported-1', 'title': 'Imported case', 'description': 'y', 'category': 'nonsense'}]}))
            pg.evaluate("go('analytics')"); pg.set_input_files('#importFile', str(backup)); pg.wait_for_timeout(300)
            titles = pg.evaluate('state.cases.map(c => c.title)')
            check('import merges with existing cases', sorted(titles) == ['Evil id', 'Imported case', 'Wi-Fi keeps dropping'], titles)
            pg.evaluate("go('history'); renderHistory()")
            check('hostile id cannot inject markup', pg.evaluate('!window.__pwned') and pg.locator('#historyResults img[src="x"]').count() == 0)
            check('unknown category becomes "other"', pg.evaluate("state.cases.find(c => c.title === 'Imported case').category") == 'other')



            # ---- navigation: Back/forward, deep links, titles, focus, skip link, draft autosave ----
            pg.evaluate('localStorage.clear()'); pg.goto(base); pg.wait_for_selector('text=Real problems')
            V = "document.querySelector('.view.active')?.id"
            pg.evaluate("go('diagnose')"); pg.evaluate("go('history')")
            check('page title follows the screen', 'History' in pg.title(), pg.title())
            check('focus moves to the new screen heading', pg.evaluate("document.activeElement.tagName.startsWith('H')"), pg.evaluate('document.activeElement.tagName'))
            pg.go_back(); check('Back goes to the previous screen', pg.evaluate(V) == 'diagnose', pg.evaluate(V))
            pg.go_back(); check('Back again reaches home', pg.evaluate(V) == 'home', pg.evaluate(V))
            pg.go_forward(); check('Forward returns to diagnose', pg.evaluate(V) == 'diagnose', pg.evaluate(V))
            pg.goto(base + '#/history'); pg.wait_for_selector('text=Real problems', state='attached')
            check('deep link opens the History screen', pg.evaluate(V) == 'history', pg.evaluate(V))
            pg.goto(base); pg.wait_for_selector('text=Real problems')
            pg.keyboard.press('Tab')
            check('first Tab stop is the skip link', pg.evaluate("document.activeElement.classList.contains('skip')"))
            pg.keyboard.press('Enter')
            check('skip link focuses the content without changing screen', pg.evaluate("document.activeElement.id") == 'main' and pg.evaluate(V) == 'home')
            pg.evaluate("startSpecific('internet', commonProblems.internet[0][0])")
            pg.fill('#problemTitle', 'Draft survives reload'); pg.fill('#problemDesc', 'Typed, never clicked next.')
            reload_home(pg)
            check('typed draft is saved even if you reload immediately', pg.evaluate("state.cases.some(c => c.title === 'Draft survives reload')"))
            check('resume banner offers the draft', 'Draft survives reload' in pg.inner_text('#resumeBanner'))
            pg.click('#resumeBanner button:has-text("Resume")')
            check('resuming restores the typed text', pg.input_value('#problemTitle') == 'Draft survives reload' and pg.input_value('#problemDesc') == 'Typed, never clicked next.')
            pg.evaluate("go('home')"); pg.evaluate('localStorage.clear()'); reload_home(pg)


            # ---- edit details after the plan is built; undo delete ----
            pg.evaluate("startSpecific('internet', commonProblems.internet[0][0]); current.title = 'Typo titel'; current.description = 'Old description'; current.answers = {0: 'multi', 1: 'persistent', 2: 'not-signal', 3: 'timing'}; buildPlan()")
            pg.click('button:has-text("Edit title")'); pg.wait_for_selector('#dlg[open]')
            pg.fill('#dlgInput', 'Fixed title'); pg.click('#dlg button[value=ok]'); pg.wait_for_selector('#dlg[open]')
            pg.fill('#dlgInput', 'New description'); pg.click('#dlg button[value=ok]'); pg.wait_for_timeout(200)
            check('title and description can be edited after the plan is built', pg.evaluate("current.title") == 'Fixed title' and 'New description' in pg.inner_text('#caseBody'))
            check('edited details are saved', pg.evaluate("state.cases.some(c => c.title === 'Fixed title' && c.description === 'New description')"))
            pg.evaluate("go('history')"); pg.click('#historyResults button[aria-label="Delete case"]'); pg.wait_for_selector('#dlg[open]'); pg.click('#dlg button[value=ok]'); pg.wait_for_timeout(200)
            check('deleting removes the case', pg.evaluate('state.cases.length') == 0)
            check('an Undo button appears', pg.locator('#toast .toast-action').is_visible())
            pg.click('#toast .toast-action'); pg.wait_for_timeout(200)
            check('Undo restores the case', pg.evaluate("state.cases.length") == 1 and pg.evaluate("state.cases[0].title") == 'Fixed title')
            check('the restored case is saved', pg.evaluate("JSON.parse(localStorage.getItem(KEY)).cases.length") == 1)
            pg.evaluate("go('home')"); pg.evaluate('localStorage.clear()'); reload_home(pg)


            # ---- PDF report: real PDF generated by Chromium from the print layout ----
            pg.evaluate("startSpecific('internet', commonProblems.internet[0][0]); current.title = 'Report test case'; current.description = 'Wi-Fi drops each evening.'; current.answers = {0: 'multi', 1: 'persistent', 2: 'not-signal', 3: 'timing'}; buildPlan(); current.stepResults = {0: 'helped', 1: 'worse'}; current.steps[0].note = 'restarted router'; current.evidenceVals = {0: 'Router model X'}; current.log = [{t: new Date().toISOString(), n: 'dropped at 8pm'}]; current.notes = 'Changed the channel'; current.attachments = [{id: 'r1', name: 'router.png', data: 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='}]; saveCurrent()")
            pg.evaluate("renderReport()") ; pg.wait_for_selector('#printReport .rp', state='attached')
            check('report button is on the plan screen', pg.locator('button:has-text("Save as PDF")').count() >= 1)
            pdf_path = tmp / 'report.pdf'
            pg.emulate_media(media='print'); pg.pdf(path=str(pdf_path), print_background=True); pg.emulate_media(media='screen')
            pdf = pdf_path.read_bytes()
            check('print layout produces a real PDF', pdf[:5] == b'%PDF-' and len(pdf) > 3000, len(pdf))
            txt = subprocess.run(['pdftotext', '-layout', str(pdf_path), '-'], capture_output=True, text=True).stdout if subprocess.run(['which', 'pdftotext'], capture_output=True).returncode == 0 else ''
            if txt:
                check('PDF contains the case content', all(x in txt for x in ['Report test case', 'Troubleshooting report', 'Router model X', 'dropped at 8pm', 'Changed the channel', 'Helped', 'Got worse']), txt[:300])
                check('PDF does not contain the app chrome', 'Start diagnosing' not in txt and 'Quick access' not in txt)
            else:
                print('SKIP  PDF text checks (pdftotext not installed)')
            pg.evaluate("document.getElementById('printReport').remove(); go('home'); localStorage.clear()"); reload_home(pg)


            # ---- photos in IndexedDB: size limits, migration, backup round-trip, cleanup, fallback ----
            pg.evaluate('localStorage.clear()'); reload_home(pg)
            pg.evaluate("startSpecific('internet', commonProblems.internet[0][0]); current.title = 'Photo case'; current.description = 'D'; current.answers = {0: 'multi', 1: 'persistent', 2: 'not-signal', 3: 'timing'}; buildPlan()")
            big = []
            for n in range(7):
                f = tmp / f'noise{n}.png'; noise_png(f); big.append(str(f))
            pg.set_input_files('#attachFile', big); pg.wait_for_function("current.attachments.length === 6 || document.querySelectorAll('.thumb').length >= 6", timeout=60000)
            pg.wait_for_timeout(500)
            sizes = pg.evaluate("(async () => { const out = []; for (const a of current.attachments) { const b = await imageDB.get(a.id); out.push(b ? b.size : 0); } return out; })()")
            check('six large photos are stored (7th is refused)', pg.evaluate('current.attachments.length') == 6 and all(s > 50000 for s in sizes), sizes)
            check('photos no longer fill localStorage', pg.evaluate('localStorage.getItem(KEY).length') < 20000 and sum(sizes) > 1_000_000, (pg.evaluate('localStorage.getItem(KEY).length'), sum(sizes)))
            # legacy migration: a case that still holds an inline photo
            PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
            pg.evaluate("""(png) => { const s = JSON.parse(localStorage.getItem(KEY)); s.cases = [Object.assign({}, s.cases[0], {id: 'legacy-1', title: 'Legacy case', attachments: [{id: 'old-img', name: 'old.png', data: png}]})]; localStorage.setItem(KEY, JSON.stringify(s)); }""", PNG1)
            reload_home(pg)
            pg.wait_for_function("state.cases[0] && state.cases[0].attachments[0] && state.cases[0].attachments[0].idb === true", timeout=10000)
            check('legacy inline photos migrate into IndexedDB', pg.evaluate("!('data' in state.cases[0].attachments[0])") and 'base64' not in pg.evaluate('localStorage.getItem(KEY)'))
            check('migrated photo is readable', pg.evaluate("imageDB.get('old-img').then(b => !!b && b.size > 0)"))
            # backup round-trip: export embeds the photo, import restores it into IndexedDB
            exported = pg.evaluate('buildExportJson()')
            check('backup file embeds photos as data URLs', 'data:image/png;base64,' in exported and '"idb"' not in exported)
            bk = tmp / 'photo-backup.json'; bk.write_text(exported)
            pg.evaluate("imageDB.remove('old-img')"); pg.evaluate("localStorage.clear()"); reload_home(pg)
            pg.evaluate("go('analytics')"); pg.set_input_files('#importFile', str(bk)); pg.wait_for_timeout(600)
            check('importing a backup puts the photos back into IndexedDB',
                  pg.evaluate("state.cases.length === 1 && state.cases[0].attachments[0].idb === true") and pg.evaluate("imageDB.get('old-img').then(b => !!b && b.size > 0)"))
            # cleanup: deleting a case frees its photo, but Undo keeps it
            pg.evaluate("go('history'); renderHistory()")
            pg.click('#historyResults button[aria-label="Delete case"]'); pg.wait_for_selector('#dlg[open]'); pg.click('#dlg button[value=ok]'); pg.wait_for_timeout(200)
            pg.evaluate("purgeOrphanImages()"); pg.wait_for_timeout(200)
            check('photo of a just-deleted case is kept while Undo is possible', pg.evaluate("imageDB.get('old-img').then(b => !!b)"))
            pg.click('#toast .toast-action'); pg.wait_for_timeout(200); pg.evaluate("purgeOrphanImages()"); pg.wait_for_timeout(200)
            check('Undo keeps the photo', pg.evaluate("state.cases.length === 1") and pg.evaluate("imageDB.get('old-img').then(b => !!b)"))
            pg.evaluate("state.cases = []; lastDeleted = null; save(); purgeOrphanImages()"); pg.wait_for_timeout(300)
            check('orphaned photos are removed', pg.evaluate("imageDB.keys().then(k => k.length)") == 0, pg.evaluate("imageDB.keys()"))
            # fallback: no IndexedDB at all
            ctx2 = browser.new_context(viewport={'width': 1100, 'height': 800}); ctx2.add_init_script("Object.defineProperty(window, 'indexedDB', {value: undefined, configurable: true})")
            fb = ctx2.new_page(); fb.on('pageerror', lambda e: js_errors.append('fallback: ' + str(e)))
            fb.goto(base); fb.wait_for_selector('text=Real problems')
            fb.evaluate("startSpecific('internet', commonProblems.internet[0][0]); current.title = 'No IDB'; current.description = 'D'; current.answers = {0: 'multi', 1: 'persistent', 2: 'not-signal', 3: 'timing'}; buildPlan()")
            fb.set_input_files('#attachFile', str(img)); fb.wait_for_function("current.attachments.length === 1", timeout=10000)
            check('without IndexedDB photos fall back to inline storage', fb.evaluate("typeof current.attachments[0].data === 'string' && current.attachments[0].data.startsWith('data:image/jpeg')"))
            fb.wait_for_selector('.thumb img'); check('fallback thumbnail renders', fb.evaluate("document.querySelector('.thumb img').src.startsWith('data:image/jpeg')"))
            ctx2.close()
            pg.evaluate('localStorage.clear()'); reload_home(pg)

            # ---- security: hostile backup rendered through every screen ----
            pg.evaluate('localStorage.clear()'); reload_home(pg)
            P = '"><img src=x onerror="window.__x=(window.__x||0)+1"><svg onload="window.__x=(window.__x||0)+1"><script>window.__x=99</script>'
            hostile = {'version': 2, 'cases': [{
                'id': 'safe-id', 'title': P, 'description': P, 'device': P, 'platform': P, 'severity': P, 'status': P, 'outcome': P,
                'notes': P, 'symptom': P, 'branch': P, 'category': P, 'evidence': [P, P], 'evidenceVals': {'0': P, '1': P},
                'log': [{'t': P, 'n': P}], 'answers': {'0': P}, 'stepResults': {'0': P},
                'steps': [{'text': P, 'detail': P, 'note': P}],
                'attachments': [{'id': 'a1', 'name': P, 'data': 'data:image/png;base64,iVBORw0KGgo='}]}]}
            hb = tmp / 'hostile.json'; hb.write_text(json.dumps(hostile))
            pg.evaluate("go('analytics')"); pg.set_input_files('#importFile', str(hb)); pg.wait_for_timeout(300)
            for view in ['home', 'diagnose', 'history', 'analytics']:
                pg.evaluate(f"go('{view}'); renderHome(); renderHistory(); renderAnalytics()")
            pg.evaluate("openCase('safe-id')")
            for fn in ["renderPlan(playbooks[current.category].branches[Object.keys(playbooks[current.category].branches)[0]])", 'finishCase()', 'renderDiagnosisQuestions()']:
                try: pg.evaluate(fn)
                except Exception: pass
            pg.evaluate("current.steps.length && (current.steps[0].note = current.steps[0].note)")
            pg.wait_for_timeout(300)
            check('hostile backup executes no script on any screen', pg.evaluate('!window.__x'), pg.evaluate('window.__x'))
            check('hostile backup creates no injected elements', pg.locator('img[src="x"], svg[onload]').count() == 0)


            # ---- accessibility: names, labels, contrast (light + dark), keyboard, dialog ----
            AUDIT = (ROOT / 'tests' / 'e2e' / 'a11y-audit.js').read_text()
            pg.evaluate('localStorage.clear()'); reload_home(pg)
            pg.evaluate("startSpecific('internet', commonProblems.internet[0][0]); current.title = 'Wi-Fi keeps dropping'; current.description = 'Drops every evening.'; current.answers = {0: 'multi', 1: 'persistent', 2: 'not-signal', 3: 'timing'}; buildPlan(); current.steps[0].done = true; saveCurrent()")
            views = {'home': "go('home'); renderHome()", 'diagnose': "go('diagnose')", 'define': "startCase('internet'); renderStage1()",
                     'questions': "startSpecific('internet', commonProblems.internet[0][0]); current.title = 't'; current.description = 'd'; renderDiagnosisQuestions()",
                     'plan': 'openCase(state.cases[0].id)', 'outcome': 'openCase(state.cases[0].id); finishCase()',
                     'history': "go('history'); renderHistory()", 'insights': "go('analytics'); renderAnalytics()"}
            problems = {'names': set(), 'labels': set(), 'imgs': set(), 'contrast': set(), 'small': set(), 'ids': set()}
            for theme in ['light', 'dark']:
                pg.evaluate("document.documentElement.classList.%s('dark')" % ('add' if theme == 'dark' else 'remove'))
                for name, js in views.items():
                    pg.evaluate(js); r = pg.evaluate(AUDIT)
                    for k in problems:
                        for item in r[k]: problems[k].add(f'{theme}:{name}: {item}')
            for k, label in [('names', 'every button and link has an accessible name'), ('labels', 'every form field has a label'), ('imgs', 'every image has alt text'),
                             ('contrast', 'text contrast meets WCAG AA in light and dark themes'), ('small', 'tap targets are at least 24px'), ('ids', 'no duplicate element ids')]:
                check(label, not problems[k], sorted(problems[k])[:3])
            pg.evaluate("document.documentElement.classList.remove('dark'); go('home')")
            check('current page is marked with aria-current', pg.evaluate("document.querySelectorAll('nav [aria-current=page]').length") == 1)
            pg.keyboard.press('Tab'); bad = []
            for _ in range(14):
                info = pg.evaluate("() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); return {t: e.tagName + ' ' + (e.textContent || '').trim().slice(0, 18), ok: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'}; }")
                if info and not info['ok']: bad.append(info['t'])
                pg.keyboard.press('Tab')
            check('keyboard focus is always visible', not bad, bad)
            pg.evaluate("(() => { dlg('Test dialog', {text: true}); return 1; })()"); pg.wait_for_timeout(120)
            check('dialog takes focus when opened', pg.evaluate("document.getElementById('dlg').open && document.getElementById('dlg').contains(document.activeElement)"))
            pg.keyboard.press('Escape'); pg.wait_for_timeout(120)
            check('Escape closes the dialog', pg.evaluate("!document.getElementById('dlg').open"))

            # ---- mobile layout ----
            m = ctx.new_page(); m.set_viewport_size({'width': 390, 'height': 780})
            m.goto(base); m.wait_for_selector('text=Real problems')
            m.evaluate('localStorage.clear()'); m.reload(); m.wait_for_selector('text=Real problems')
            # ---- layout: very long unbroken text must not stretch the page on a phone ----
            LONG = 'https://example.com/' + 'a' * 120 + ' ERROR_CODE_' + 'X' * 80
            m.evaluate("""(L) => { localStorage.clear(); startSpecific('internet', commonProblems.internet[0][0]);
                current.title = L; current.description = L; current.device = L;
                current.answers = {0: 'multi', 1: 'persistent', 2: 'not-signal', 3: 'timing'}; buildPlan();
                current.evidenceVals = {0: L}; current.log = [{t: new Date().toISOString(), n: L}];
                current.steps[0].note = L; current.notes = L; current.status = 'closed'; current.outcome = 'partial'; saveCurrent(); }""", LONG)
            wide = []
            for view in ['home', 'history', 'analytics']:
                m.evaluate(f"go('{view}'); renderHome(); renderHistory(); renderAnalytics()")
                if m.evaluate('document.documentElement.scrollWidth') > 391: wide.append(view)
            m.evaluate('openCase(state.cases[0].id)')
            if m.evaluate('document.documentElement.scrollWidth') > 391: wide.append('plan')
            check('long unbroken text never stretches any screen on a phone', not wide, wide)
            check('no sideways scrolling on a phone', m.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
            check('no JavaScript errors during the whole run', not js_errors, js_errors[:5])
            browser.close()
    finally:
        server.terminate()
    print('\n' + ('ALL E2E CHECKS PASSED' if not failures else f'{len(failures)} FAILED: {failures}'))
    return 1 if failures else 0

if __name__ == '__main__':
    sys.exit(main())
