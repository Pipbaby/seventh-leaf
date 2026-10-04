// The media library: images and videos for the wall, music for the background.
// Everything the user imports stays in this browser (IndexedDB). A folder deck next to index.html
// is shown too: your own local/deck.json if there is one, otherwise the demo pictures in
// demo/deck.json. "Deleting" a folder picture only hides it.
import * as THREE from '../vendor/three/three.module.min.js';
import { WALL_ASPECT } from './wall.js';

const DB = 'seventh-leaf';
const OLD_DB = 'flipwall'; // the project's working name; data saved under it is moved over once
let dbp = null;

function openDb(name, create) {
  return new Promise((res, rej) => {
    const q = indexedDB.open(name, 1);
    q.onupgradeneeded = () => {
      if (!create) {
        q.transaction.abort(); // it did not exist: do not create it
        return;
      }
      q.result.createObjectStore('items', { keyPath: 'id' });
      q.result.createObjectStore('music', { keyPath: 'id' });
    };
    q.onsuccess = () => res(q.result);
    q.onerror = () => (create ? rej(q.error) : res(null));
  });
}

// settings saved under the old name move over before anything reads them (this runs on import)
try {
  if (!localStorage.getItem('seventhleaf.migrated')) {
    for (const k of ['settings', 'hidden', 'localMeta', 'order']) {
      const v = localStorage.getItem('flipwall.' + k);
      if (v !== null && localStorage.getItem('seventhleaf.' + k) === null) localStorage.setItem('seventhleaf.' + k, v);
    }
  }
} catch {}

// copy everything from the old database into the new one, the first time only
async function migrate(d) {
  try {
    if (localStorage.getItem('seventhleaf.migrated')) return;
    const old = await openDb(OLD_DB, false);
    if (old) {
      for (const store of ['items', 'music']) {
        if (!old.objectStoreNames.contains(store)) continue;
        const rows = await new Promise((res) => {
          const q = old.transaction(store).objectStore(store).getAll();
          q.onsuccess = () => res(q.result);
          q.onerror = () => res([]);
        });
        await new Promise((res) => {
          const t = d.transaction(store, 'readwrite');
          for (const r of rows) t.objectStore(store).put(r);
          t.oncomplete = res;
          t.onerror = res;
        });
      }
      old.close();
    }
    localStorage.setItem('seventhleaf.migrated', '1');
  } catch (e) {
    console.warn('Could not move data saved under the old name', e);
  }
}

function db() {
  if (!dbp) {
    dbp = openDb(DB, true).then(async (d) => {
      await migrate(d);
      return d;
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}

const all = (store) => tx(store, 'readonly', (s) => s.getAll());
const put = (store, v) => tx(store, 'readwrite', (s) => s.put(v));
const del = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function store(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

// ── items ───────────────────────────────────────────────────────────────────────────────
export async function listItems() {
  const hidden = new Set(store('seventhleaf.hidden', []));
  const meta = store('seventhleaf.localMeta', {});
  let local = [];
  try {
    let dir = 'local';
    let deck = await fetch('local/deck.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!deck) {
      dir = 'demo';
      deck = await fetch('demo/deck.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    }
    if (deck) {
      local = deck.items.map((it, i) => ({
        id: dir + ':' + it.file,
        kind: /\.(mp4|webm|mov|m4v)$/i.test(it.file) ? 'video' : 'image',
        name: it.name || it.file,
        url: dir + '/' + it.file,
        thumbUrl: it.thumb ? dir + '/' + it.thumb : null,
        w: it.w,
        h: it.h,
        local: true,
        order: i,
        fit: 'auto',
        focus: [0.5, 0.7],
        ...meta[dir + ':' + it.file],
      }));
    }
  } catch {}
  const own = (await all('items')).sort((a, b) => a.order - b.order);
  const order = store('seventhleaf.order', null);
  const list = [...local.filter((x) => !hidden.has(x.id)), ...own];
  if (order) list.sort((a, b) => (order.indexOf(a.id) + 1 || 1e9) - (order.indexOf(b.id) + 1 || 1e9));
  return list;
}

export function hiddenCount() {
  return store('seventhleaf.hidden', []).length;
}
export function restoreHidden() {
  save('seventhleaf.hidden', []);
}

export async function updateItem(item, patch) {
  Object.assign(item, patch);
  if (item.local) {
    const meta = store('seventhleaf.localMeta', {});
    meta[item.id] = { fit: item.fit, focus: item.focus, loop: item.loop, muted: item.muted };
    save('seventhleaf.localMeta', meta);
  } else {
    const { src, ...rest } = item;
    await put('items', rest);
  }
}

export async function deleteItem(item) {
  if (item.local) save('seventhleaf.hidden', [...store('seventhleaf.hidden', []), item.id]);
  else await del('items', item.id);
}

export function saveOrder(list) {
  save(
    'seventhleaf.order',
    list.map((x) => x.id),
  );
}

// images are stored at most 2560 px on the long side
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
  if (k === 1 && file.size < 6e6) return { blob: file, w: bmp.width, h: bmp.height };
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.92 });
  return { blob, w: c.width, h: c.height };
}

export async function importFiles(files) {
  const added = [];
  const base = Date.now();
  let i = 0;
  for (const f of files) {
    const kind = f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : null;
    if (!kind) continue;
    const item = { id: uid(), kind, name: f.name.replace(/\.[^.]+$/, ''), order: base + i++, fit: 'auto', focus: [0.5, 0.7] };
    if (kind === 'image') Object.assign(item, await shrink(f));
    else Object.assign(item, { blob: f, loop: true, muted: false });
    await put('items', item);
    added.push(item);
  }
  navigator.storage?.persist?.();
  return added;
}

// ── music ───────────────────────────────────────────────────────────────────────────────
export async function listMusic() {
  return (await all('music')).sort((a, b) => a.order - b.order);
}
export async function importMusic(files) {
  const out = [];
  let i = 0;
  for (const f of files) {
    if (!f.type.startsWith('audio/') && !/\.(mp3|m4a|aac|flac|ogg|opus|wav)$/i.test(f.name)) continue;
    const m = { id: uid(), name: f.name.replace(/\.[^.]+$/, ''), blob: f, order: Date.now() + i++ };
    await put('music', m);
    out.push(m);
  }
  navigator.storage?.persist?.();
  return out;
}
export const deleteMusic = (m) => del('music', m.id);

// a short user-supplied flip sound
export async function getFlipSample() {
  return (await tx('music', 'readonly', (s) => s.get('__flip__'))) || null;
}
export async function setFlipSample(file) {
  if (file) await put('music', { id: '__flip__', name: file.name, blob: file, order: -1 });
  else await del('music', '__flip__');
}

// ── sources: what the wall's shader samples ────────────────────────────────────────────────
const BLACK = new THREE.DataTexture(new Uint8Array([8, 8, 9, 255]), 1, 1);
BLACK.needsUpdate = true;

export function fitOf(item, aspect) {
  if (item.fit && item.fit !== 'auto') return item.fit;
  const r = aspect / WALL_ASPECT;
  return r > 0.7 && r < 1.45 ? 'cover' : 'contain';
}

// image uv = wall uv * xy + zw  (v up)
export function xformFor(item, aspect, v = new THREE.Vector4()) {
  const A = WALL_ASPECT;
  const fit = fitOf(item, aspect);
  const [fx, fy] = item.focus || [0.5, 0.5];
  const zoom = item.zoom || 1;
  if (fit === 'cover') {
    let sx = 1;
    let sy = 1;
    if (aspect > A) sx = A / aspect;
    else sy = aspect / A;
    sx /= zoom;
    sy /= zoom;
    v.set(sx, sy, (1 - sx) * fx, (1 - sy) * fy);
  } else {
    let sx = 1;
    let sy = 1;
    if (aspect > A) sy = aspect / A;
    else sx = A / aspect;
    v.set(sx, sy, -(sx - 1) / 2, -(sy - 1) / 2);
  }
  return v;
}

function blurredBackdrop(img, w, h) {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = Math.round(384 / WALL_ASPECT);
  const g = c.getContext('2d');
  const a = w / h;
  const A = c.width / c.height;
  const dw = a > A ? c.height * a : c.width;
  const dh = a > A ? c.height : c.width / a;
  g.filter = 'blur(14px) saturate(1.1)';
  g.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
  g.filter = 'none';
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A source is cheap until it is needed: images know their size from the library and load their
// pixels (and get a GPU texture) only when the wall is about to show them. Videos load at once.
export async function makeSource(item, renderer) {
  const url = item.url || URL.createObjectURL(item.blob);
  const src = { id: item.id, item, kind: item.kind, url, xform: new THREE.Vector4(1, 1, 0, 0), texture: null, bg: null };
  if (item.kind === 'image') {
    src.thumb = item.thumbUrl || url;
    if (item.w && item.h) src.aspect = item.w / item.h;
    else await ensureSource(src, renderer); // older imports without a stored size
  } else {
    const v = document.createElement('video');
    v.src = url;
    v.crossOrigin = 'anonymous';
    v.playsInline = true;
    v.preload = 'auto';
    v.loop = item.loop !== false;
    await new Promise((res, rej) => {
      v.onloadeddata = res;
      v.onerror = () => rej(new Error('Cannot play ' + item.name));
    });
    src.el = v;
    src.texture = new THREE.VideoTexture(v);
    src.texture.colorSpace = THREE.SRGBColorSpace;
    src.texture.minFilter = THREE.LinearFilter;
    src.aspect = v.videoWidth / v.videoHeight;
    src.bg = BLACK;
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = Math.round(240 / src.aspect);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    src.thumb = c.toDataURL('image/jpeg', 0.7);
  }
  xformFor(item, src.aspect, src.xform);
  return src;
}

export const isLoaded = (src) => !!src.texture;

// make sure a source's pixels are on the GPU (sets: their members first, then the drawing)
export function ensureSource(src, renderer) {
  if (src.texture) return Promise.resolve(src);
  if (src.loading) return src.loading;
  src.loading = (async () => {
    if (src.composite) {
      await Promise.all(src.members.map((m) => ensureSource(m, renderer)));
      if (!src.canvas) {
        src.canvas = document.createElement('canvas');
        src.canvas.width = 2400;
        src.canvas.height = Math.round(2400 / WALL_ASPECT);
      }
      src.texture = new THREE.CanvasTexture(src.canvas);
      src.texture.colorSpace = THREE.SRGBColorSpace;
      src.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      drawComposite(src);
    } else {
      const img = new Image();
      img.src = src.url;
      await img.decode();
      let el = img;
      const max = Math.min(renderer.capabilities.maxTextureSize, 4096);
      if (Math.max(img.width, img.height) > max) {
        const k = max / Math.max(img.width, img.height);
        el = document.createElement('canvas');
        el.width = Math.round(img.width * k);
        el.height = Math.round(img.height * k);
        el.getContext('2d').drawImage(img, 0, 0, el.width, el.height);
      }
      const t = new THREE.Texture(el);
      t.needsUpdate = true;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      t.minFilter = THREE.LinearMipmapLinearFilter;
      src.aspect = img.width / img.height;
      src.bg = blurredBackdrop(img, img.width, img.height);
      xformFor(src.item, src.aspect, src.xform);
      src.texture = t;
    }
    src.loading = null;
    return src;
  })().catch((e) => {
    src.loading = null;
    throw e;
  });
  return src.loading;
}

// free a source's GPU memory; it reloads the next time it is needed (videos stay)
export function releaseSource(src) {
  if (!src.texture || src.el) return;
  src.texture.dispose();
  src.texture = null;
  if (src.bg && src.bg !== BLACK) src.bg.dispose();
  if (!src.composite) src.bg = null;
  if (src.composite) src.canvas = null;
}

export function disposeSource(src) {
  src.texture?.dispose();
  src.texture = null;
  if (src.bg !== BLACK) src.bg?.dispose();
  if (src.el) {
    src.el.pause();
    src.el.removeAttribute('src');
    src.el.load();
  }
  if (!src.item.url) URL.revokeObjectURL(src.url);
}

// ── portrait sets: three (or two) portraits side by side as one wall image ─────────────────
// With 12 columns the panels are exactly 4 (or 6) cells wide, so their edges fall on cell gaps.
export const isPortrait = (src) => src.kind === 'image' && !src.composite && src.aspect < 0.85;

export function makeComposite(parts, renderer) {
  const W = 2400;
  const H = Math.round(W / WALL_ASPECT);
  const c = null;
  const id = 'set:' + parts.map((p) => p.id).join('+');
  const src = {
    id,
    kind: 'image',
    composite: true,
    members: parts,
    canvas: c,
    aspect: W / H,
    xform: new THREE.Vector4(1, 1, 0, 0),
    bg: BLACK,
    item: { id, name: parts.map((p) => p.item.name).join(' · '), fit: 'cover', focus: [0.5, 0.5] },
  };
  src.texture = null; // drawn when first needed (ensureSource)
  return src;
}

export function drawComposite(src) {
  const c = src.canvas;
  if (!c || !src.texture || src.members.some((m) => !m.texture)) return;
  const g = c.getContext('2d');
  const n = src.members.length;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  src.members.forEach((p, k) => {
    const img = p.texture.image;
    const iw = img.width;
    const ih = img.height;
    const x0 = Math.round((k * c.width) / n);
    const pw = Math.round(((k + 1) * c.width) / n) - x0;
    const pa = pw / c.height;
    const zoom = p.item.zoom || 1;
    const [fx, fy] = p.item.focus || [0.5, 0.7];
    let sw;
    let sh;
    if (iw / ih > pa) {
      sh = ih / zoom;
      sw = sh * pa;
    } else {
      sw = iw / zoom;
      sh = sw / pa;
    }
    g.drawImage(img, (iw - sw) * fx, (ih - sh) * (1 - fy), sw, sh, x0, 0, pw, c.height);
  });
  src.texture.needsUpdate = true;
}
