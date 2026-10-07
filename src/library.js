// The media library: images and videos for the wall, music for the background.
// Everything the user imports stays in this browser (IndexedDB). A folder deck next to index.html
// is shown too: your own local/deck.json if there is one, otherwise the demo pictures in
// demo/deck.json. "Deleting" a folder picture only hides it.
import * as THREE from '../vendor/three/three.module.min.js';
import { WALL_ASPECT } from './wall.js';

// ?test (tools/test-folder-mode.html) works in a database of its own
export const TEST = new URLSearchParams(location.search).has('test');
const DB = TEST ? 'seventh-leaf-test' : 'seventh-leaf';
const OLD_DB = 'flipwall'; // the project's working name; data saved under it is moved over once
let dbp = null;

// version 2 adds folder mode: the folders, their index, and the index's thumbnails
function openDb(name, create) {
  return new Promise((res, rej) => {
    const q = create ? indexedDB.open(name, 2) : indexedDB.open(name);
    q.onupgradeneeded = () => {
      if (!create) {
        q.transaction.abort(); // it did not exist: do not create it
        return;
      }
      const d = q.result;
      for (const s of ['items', 'music', 'folders', 'entries', 'thumbs']) {
        if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, s === 'thumbs' ? undefined : { keyPath: 'id' });
      }
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
    if (TEST || localStorage.getItem('seventhleaf.migrated')) return;
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

export function db() {
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
    // a private local/ folder only exists when running on your own computer (the Android app is
    // served from localhost too, but never carries it)
    const onThisComputer = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && !window.Capacitor;
    let dir = 'local';
    let deck = onThisComputer ? await fetch('local/deck.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
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

// ── decoding: off the main thread, at the size shown, a few at a time ─────────────────────
// Pictures are decoded from their files in a worker (decode-worker.js), straight to at most
// TEX_MAX px, and uploaded to the GPU as soon as they arrive; the bitmap is closed right after,
// so only the texture holds the pixels. Decoding a 4096 px photo through an <img> instead froze
// the wall for seconds: the browser drops an <img>'s decoded pixels and decodes the full photo
// again, on the main thread, whenever it is drawn or uploaded. At most DECODING pictures decode
// at once, so a change through a big folder cannot pile up full-size photos in memory.
const TEX_MAX = 2560;
const DECODING = 2;
let decoding = 0;
const waiting = [];
let worker = null;
let lastId = 0;
const replies = new Map();

async function decode(msg) {
  while (decoding >= DECODING) await new Promise((r) => waiting.push(r));
  decoding++;
  try {
    if (!worker) {
      worker = new Worker(new URL('./decode-worker.js', import.meta.url));
      worker.onmessage = ({ data }) => {
        const r = replies.get(data.id);
        replies.delete(data.id);
        if (data.error) r.rej(Object.assign(new Error(data.error), { part: data.part }));
        else r.res(data);
      };
    }
    return await new Promise((res, rej) => {
      const id = ++lastId;
      replies.set(id, { res, rej });
      worker.postMessage({ id, ...msg });
    });
  } finally {
    decoding--;
    waiting.shift()?.();
  }
}

async function blobOf(src) {
  if (src.file) return src.file();
  if (src.item.blob) return src.item.blob;
  const r = await fetch(src.url);
  if (!r.ok) throw new Error('Cannot load ' + src.item.name);
  return r.blob();
}

// the upright size the library knows (the thumbnail worker measures it); without one the worker
// decodes the picture whole first
const sizeOf = (item) => (item.w && item.h ? [item.w, item.h] : null);

// A texture for a bitmap from the worker, already upside down as WebGL wants it. Its pixels go to
// the GPU now and the bitmap is closed: the texture keeps only its size (nothing uploads an image
// texture again; a lost GPU context reloads the pictures from their files, see main.js).
function upload(renderer, t, bmp) {
  t.image = bmp;
  t.needsUpdate = true;
  renderer.initTexture(t);
  t.image = { width: bmp.width, height: bmp.height };
  bmp.close();
  return t;
}

function bitmapTexture(renderer) {
  const t = new THREE.Texture();
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.minFilter = THREE.LinearMipmapLinearFilter;
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
    await openVideo(src);
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = Math.round(240 / src.aspect);
    c.getContext('2d').drawImage(src.el, 0, 0, c.width, c.height);
    src.thumb = c.toDataURL('image/jpeg', 0.7);
  }
  xformFor(item, src.aspect, src.xform);
  return src;
}

// A folder item's source holds nothing at all until it comes up on the wall. Then the file is
// read (file() → File), and on release everything goes again: texture, video element, object URL.
// measured(w, h) hears the real size of a picture once it has been decoded. link(), where there is
// one, gives a URL a video can play from without reading the whole file first (the Android app).
export function folderSource(item, file, measured, link) {
  const src = { id: item.id, item, kind: item.kind, url: null, file, measured, link, xform: new THREE.Vector4(1, 1, 0, 0), texture: null, bg: null };
  if (item.w && item.h) src.aspect = item.w / item.h;
  xformFor(item, src.aspect || WALL_ASPECT, src.xform);
  return src;
}

async function openVideo(src) {
  const v = document.createElement('video');
  v.src = src.url;
  v.crossOrigin = 'anonymous';
  v.playsInline = true;
  v.preload = 'auto';
  v.loop = src.item.loop !== false;
  await new Promise((res, rej) => {
    v.onloadeddata = res;
    // the media error says why; a read that failed or stopped (a busy phone) is worth another try
    v.onerror = () => {
      const m = v.error;
      const e = new Error(`Cannot play ${src.item.name}` + (m ? ` (${m.code}${m.message ? ': ' + m.message : ''})` : ''));
      e.retry = m?.code === MediaError.MEDIA_ERR_NETWORK || m?.code === MediaError.MEDIA_ERR_ABORTED;
      rej(e);
    };
  });
  src.el = v;
  src.texture = new THREE.VideoTexture(v);
  src.texture.colorSpace = THREE.SRGBColorSpace;
  src.texture.minFilter = THREE.LinearFilter;
  src.aspect = v.videoWidth / v.videoHeight;
  src.bg = BLACK;
}

function closeVideo(v) {
  v.pause();
  v._fwNode?.disconnect(); // its route into the mixer goes with it
  v.removeAttribute('src');
  v.load();
}

export const isLoaded = (src) => !!src.texture;

// make sure a source's pixels are on the GPU (sets: drawn from their members' files; the members
// themselves never get a texture)
export function ensureSource(src, renderer) {
  if (src.texture) return Promise.resolve(src);
  if (src.loading) return src.loading;
  src.loading = (async () => {
    if (src.composite) {
      const t = bitmapTexture(renderer);
      await paintComposite(src, t, renderer);
      src.texture = t;
    } else if (src.file) {
      // read the file only now; a failure is remembered so the item can be skipped
      src.error = null;
      try {
        if (src.kind === 'video') {
          src.url = src.link ? src.link() : URL.createObjectURL(await src.file());
          await openVideo(src);
        } else await loadImage(src, renderer);
      } catch (e) {
        src.error = e;
        if (src.url) URL.revokeObjectURL(src.url);
        src.url = null;
        throw e;
      }
      xformFor(src.item, src.aspect, src.xform);
    } else await loadImage(src, renderer);
    src.loading = null;
    return src;
  })().catch((e) => {
    src.loading = null;
    throw e;
  });
  return src.loading;
}

// A picture goes to the GPU at most TEX_MAX px on its long side (or what the GPU allows), as
// imports are stored. Its blurred surround is drawn from a second, 512 px decode.
async function loadImage(src, renderer) {
  const size = sizeOf(src.item);
  const bg = [384, Math.round(384 / WALL_ASPECT)];
  const out = await decode({ kind: 'picture', blob: await blobOf(src), size, max: Math.min(renderer.capabilities.maxTextureSize, TEX_MAX), bg });
  src.bg = upload(renderer, bitmapTexture(renderer), out.bg);
  src.texture = upload(renderer, bitmapTexture(renderer), out.pic);
  src.aspect = out.w / out.h;
  xformFor(src.item, src.aspect, src.xform);
  if (!size) src.measured?.(out.w, out.h);
}

// free a source's GPU memory; it reloads the next time it is needed (imported videos stay)
export function releaseSource(src) {
  if (!src.texture || (src.el && !src.file)) return;
  src.texture.dispose();
  src.texture = null;
  if (src.bg && src.bg !== BLACK) src.bg.dispose();
  if (!src.composite) src.bg = null;
  if (src.file) {
    if (src.el) closeVideo(src.el);
    src.el = null;
    if (src.url) URL.revokeObjectURL(src.url);
    src.url = null;
  }
}

export function disposeSource(src) {
  if (src.file) return releaseSource(src);
  src.texture?.dispose();
  src.texture = null;
  if (src.bg !== BLACK) src.bg?.dispose();
  if (src.el) closeVideo(src.el);
  if (!src.item.url) URL.revokeObjectURL(src.url);
}

// ── portrait sets: three (or two) portraits side by side as one wall image ─────────────────
// With 12 columns the panels are exactly 4 (or 6) cells wide, so their edges fall on cell gaps.
export const isPortrait = (src) => src.kind === 'image' && !src.composite && src.aspect < 0.85;

const SET_W = 2400;
const SET_H = Math.round(SET_W / WALL_ASPECT);

export function makeComposite(parts, renderer) {
  const id = 'set:' + parts.map((p) => p.id).join('+');
  const src = {
    id,
    kind: 'image',
    composite: true,
    members: parts,
    aspect: SET_W / SET_H,
    xform: new THREE.Vector4(1, 1, 0, 0),
    bg: BLACK,
    item: { id, name: parts.map((p) => p.item.name).join(' · '), fit: 'cover', focus: [0.5, 0.5] },
  };
  src.texture = null; // drawn when first needed (ensureSource)
  return src;
}

// The worker draws the set from its members' files, each decoded only as large as its panel
// needs. A member that cannot be read is remembered, so the set can be skipped. redraw: the set is
// already on the wall; it is left alone if it was released meanwhile.
async function paintComposite(src, t, renderer, redraw) {
  const parts = [];
  for (const p of src.members) {
    try {
      parts.push({ blob: await blobOf(p), size: sizeOf(p.item), zoom: p.item.zoom, focus: p.item.focus });
    } catch (e) {
      if (p.file) p.error = e;
      throw e;
    }
  }
  let out;
  try {
    out = await decode({ kind: 'set', parts, W: SET_W, H: SET_H });
  } catch (e) {
    const p = src.members[e.part];
    if (p?.file) p.error = e;
    throw e;
  }
  src.members.forEach((p, k) => sizeOf(p.item) || p.measured?.(...out.sizes[k]));
  if (redraw && src.texture !== t) out.pic.close();
  else upload(renderer, t, out.pic);
}

// redraw a set on the wall after a member's framing changed; edits come quickly, so one redraw
// runs at a time and the last edit is drawn when it finishes
export function drawComposite(src, renderer) {
  if (!src.texture) return;
  if (src.redrawing) {
    src.redrawAgain = true;
    return;
  }
  src.redrawing = true;
  paintComposite(src, src.texture, renderer, true)
    .catch((e) => console.warn(e))
    .finally(() => {
      src.redrawing = false;
      if (src.redrawAgain) {
        src.redrawAgain = false;
        drawComposite(src, renderer);
      }
    });
}
