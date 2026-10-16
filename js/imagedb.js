/* Photo storage in IndexedDB. localStorage keeps only small metadata ({id, name, idb: true});
   the image bytes live here, so photos no longer compete for localStorage's ~5 MB limit.
   If IndexedDB is unavailable (some private modes), attachments fall back to inline data URLs. */
const imageDB = (() => {
  const DB_NAME = 'fixflow-images', STORE = 'images';
  let opening = null;

  function open() {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
        let req;
        try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return reject(e); }
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return opening;
  }

  function run(mode, work) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = tx.onabort = () => reject(tx.error);
    }));
  }

  return {
    isAvailable: () => open().then(() => true, () => false),
    put: (id, blob) => run('readwrite', s => s.put(blob, id)),
    get: id => run('readonly', s => s.get(id)),
    remove: id => run('readwrite', s => s.delete(id)),
    keys: () => run('readonly', s => s.getAllKeys())
  };
})();

function dataUrlToBlob(url) {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(url || '');
  if (!m) return null;
  const bin = atob(m[2]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/* data: URLs (not blob: URLs) so images also render under strict content-security policies. */
const imageSrcCache = new Map();
async function imageSrc(att) {
  if (att.data) return att.data;
  if (imageSrcCache.has(att.id)) return imageSrcCache.get(att.id);
  const blob = await imageDB.get(att.id).catch(() => null);
  if (!blob) return '';
  const url = await blobToDataUrl(blob);
  imageSrcCache.set(att.id, url);
  return url;
}

/* Fills <img data-att="id"> thumbnails from IndexedDB after a screen renders. */
async function hydrateImages(root = document) {
  for (const img of root.querySelectorAll('img[data-att]:not([data-loaded])')) {
    const att = (current?.attachments || []).find(a => a.id === img.dataset.att);
    if (!att) continue;
    img.dataset.loaded = '1';
    const src = await imageSrc(att);
    if (src) img.src = src; else img.alt += ' (image missing)';
  }
}

/* Moves legacy inline photos (data URLs inside cases) into IndexedDB. Returns true if any moved. */
async function moveInlineImagesToDb(cases) {
  if (!(await imageDB.isAvailable())) return false;
  let changed = false;
  for (const c of cases) {
    for (const a of c.attachments || []) {
      if (!a.data) continue;
      const blob = dataUrlToBlob(a.data);
      if (!blob) continue;
      try { await imageDB.put(a.id, blob); delete a.data; a.idb = true; changed = true; } catch (e) { /* keep inline */ }
    }
  }
  return changed;
}

/* Deletes stored photos that no case (or case still undoable / open) refers to. */
async function purgeOrphanImages() {
  if (!(await imageDB.isAvailable())) return;
  const keep = new Set();
  const add = c => (c?.attachments || []).forEach(a => keep.add(a.id));
  state.cases.forEach(add); add(current); add(lastDeleted?.c);
  for (const key of await imageDB.keys()) {
    if (!keep.has(key)) { await imageDB.remove(key); imageSrcCache.delete(key); }
  }
}

new MutationObserver(() => hydrateImages()).observe(document.getElementById('caseBody'), { childList: true, subtree: true });
