// Folder mode: pictures, videos and music read straight from a folder on this computer, for
// libraries far too large to import. The browser keeps only a small index of the folder (path,
// size, date, kind, size in pixels and a ~256 px thumbnail). The files themselves are read when
// they are needed and are never copied.
//
// Chromium remembers the folder: the handle from showDirectoryPicker() is saved, and on a later
// visit a click asks for permission again. Other browsers choose a folder through
// <input webkitdirectory>, and its files can be read only until the page is closed.
import { db } from './library.js';

const EXT = {
  image: /\.(jpe?g|png|webp|gif|avif|bmp)$/i,
  video: /\.(mp4|webm|mov|m4v)$/i,
  audio: /\.(mp3|m4a|aac|flac|ogg|opus|wav)$/i,
};
export const canRemember = typeof window.showDirectoryPicker === 'function';
const THUMBS_AT_ONCE = 3;
const URLS_KEPT = 400; // thumbnail object URLs kept for the grid
const EDITS = ['fit', 'focus', 'zoom', 'loop', 'muted']; // kept when a file changes

const kindOf = (name, kinds) => kinds.find((k) => EXT[k].test(name)) || null;
// hidden files and folders (and macOS's ._ files) are skipped
const visible = (path) => !path.split('/').some((p) => p.startsWith('.'));
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byPath = (a, b) => collator.compare(a.path, b.path);
const range = (slot) => IDBKeyRange.bound(slot + ':', slot + ':￿');

// one IndexedDB transaction over one or more stores
async function run(stores, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(stores, mode);
    const out = fn(t);
    t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

// let the page draw and respond between chunks of work
const woken = [];
const channel = new MessageChannel();
channel.port1.onmessage = () => woken.shift()?.();
const breathe = () =>
  globalThis.scheduler?.yield
    ? scheduler.yield()
    : new Promise((r) => {
        woken.push(r);
        channel.port2.postMessage(0);
      });
const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 400 }) : setTimeout(r, 30)));

export class Folder {
  // slot: 'pictures' or 'music'; kinds: which files belong in it
  constructor(slot, kinds) {
    this.slot = slot;
    this.kinds = kinds;
    this.name = '';
    this.handle = null; // a remembered FileSystemDirectoryHandle (Chromium)
    this.files = null; // or the File objects from <input webkitdirectory>, by path (this visit only)
    this.handles = new Map(); // file handles found while scanning, by path
    this.entries = []; // the index, in path order
    this.byId = new Map();
    this.state = 'none'; // none | ready | reconnect | again | missing | denied
    this.scanning = null; // { n, cancelled } while a scan runs
    this.listeners = [];
    this.dirty = new Set(); // entries and thumbnails waiting to be written
    this.blobs = new Map();
    this.urls = new Map(); // thumbnail object URLs, most recently used last
    this.wanted = []; // entries in view in the grid: their thumbnails come first
    this.cursor = { image: 0, video: 0 };
    this.busy = new Set();
    this.inflight = 0;
    this.videoBusy = false;
    this.jobs = new Map();
  }

  // f(what, entry): 'state' | 'scan' | 'entries' | 'thumb' | 'size' | 'bad'
  on(f) {
    this.listeners.push(f);
  }
  #emit(what, e) {
    for (const f of this.listeners) f(what, e);
  }

  get ready() {
    return this.state === 'ready';
  }

  // what can be shown or played: the index without the files that could not be read
  items() {
    return this.entries.filter((e) => !e.bad);
  }

  get progress() {
    let media = 0;
    let done = 0;
    let bad = 0;
    for (const e of this.entries) {
      if (e.bad) bad++;
      if (e.kind === 'audio') continue;
      media++;
      if (e.thumb || e.bad) done++;
    }
    return { files: this.entries.length, media, done, bad };
  }

  #setEntries(list) {
    this.entries = list.sort(byPath);
    this.byId = new Map(list.map((e) => [e.id, e]));
    this.cursor = { image: 0, video: 0 };
  }

  // the folder remembered from an earlier visit, and its index
  async load() {
    const rec = await run('folders', 'readonly', (t) => t.objectStore('folders').get(this.slot));
    if (!rec) return;
    this.name = rec.name;
    this.handle = rec.handle || null;
    this.#setEntries(await run('entries', 'readonly', (t) => t.objectStore('entries').getAll(range(this.slot))));
    if (this.handle) {
      let p = 'prompt';
      try {
        p = await this.handle.queryPermission({ mode: 'read' });
      } catch {}
      this.state = p === 'granted' ? 'ready' : 'reconnect';
    } else this.state = 'again';
    this.#emit('state');
    if (this.ready) this.rescan();
  }

  // Call from a click: browsers open a folder picker only in answer to one.
  choose() {
    if (canRemember) {
      return showDirectoryPicker({ id: 'seventh-leaf-' + this.slot, mode: 'read' }).then(
        (h) => this.connect(h),
        (e) => e.name !== 'AbortError' && console.warn(e),
      );
    }
    return new Promise((res) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, webkitdirectory: true });
      input.onchange = () => res(this.connectFiles([...input.files]));
      input.oncancel = () => res();
      input.click();
    });
  }

  // use a directory handle (from the picker, or any other FileSystemDirectoryHandle)
  async connect(handle) {
    await this.#stopScan();
    this.handle = handle;
    this.files = null;
    this.handles = new Map();
    this.name = handle.name;
    await run('folders', 'readwrite', (t) => t.objectStore('folders').put({ id: this.slot, name: this.name, handle }));
    this.state = 'ready';
    this.#emit('state');
    await this.rescan();
  }

  // use the files of a folder chosen with <input webkitdirectory>
  async connectFiles(files) {
    if (!files.length) return;
    await this.#stopScan();
    this.handle = null;
    this.handles = new Map();
    this.name = files[0].webkitRelativePath.split('/')[0] || '';
    this.files = new Map(files.map((f) => [f.webkitRelativePath.split('/').slice(1).join('/') || f.name, f]));
    await run('folders', 'readwrite', (t) => t.objectStore('folders').put({ id: this.slot, name: this.name }));
    this.state = 'ready';
    this.#emit('state');
    await this.rescan();
  }

  // Call from a click, like choose()
  async reconnect() {
    let p = 'denied';
    try {
      p = await this.handle.requestPermission({ mode: 'read' });
    } catch (e) {
      console.warn(e);
    }
    this.state = p === 'granted' ? 'ready' : 'denied';
    this.#emit('state');
    if (this.ready) await this.rescan();
  }

  // drop the folder and its index
  async forget() {
    await this.#stopScan();
    await run(['folders', 'entries', 'thumbs'], 'readwrite', (t) => {
      t.objectStore('folders').delete(this.slot);
      t.objectStore('entries').delete(range(this.slot));
      t.objectStore('thumbs').delete(range(this.slot));
    });
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    this.dirty.clear();
    this.blobs.clear();
    this.handle = null;
    this.files = null;
    this.handles = new Map();
    this.name = '';
    this.#setEntries([]);
    this.state = 'none';
    this.#emit('state');
  }

  cancel() {
    if (this.scanning) this.scanning.cancelled = true;
  }

  async #stopScan() {
    this.cancel();
    await this.scanDone;
  }

  // Walk the folder in the background and bring the index up to date: entries whose path, size and
  // date are unchanged are kept (with their thumbnails), new files are added, missing ones dropped.
  async rescan() {
    if (!this.ready) return;
    await this.#stopScan();
    const job = { n: 0, cancelled: false, t0: performance.now() };
    this.scanning = job;
    this.#emit('scan');
    this.scanDone = this.#scan(job).finally(() => {
      this.scanning = null;
      this.lastScan = { files: job.n, ms: performance.now() - job.t0, cancelled: job.cancelled };
      this.#emit('scan');
    });
    return this.scanDone;
  }

  async #scan(job) {
    const old = new Map(this.entries.map((e) => [e.path, e]));
    const seen = new Set();
    const next = [];
    const put = [];
    const drop = []; // ids whose thumbnails go
    let t = performance.now();
    try {
      for await (const f of this.#walk()) {
        if (job.cancelled) break;
        job.n++;
        seen.add(f.path);
        const e = old.get(f.path);
        if (e && e.size === f.size && e.mtime === f.mtime) next.push(e);
        else {
          const name = f.path.slice(f.path.lastIndexOf('/') + 1);
          const n = { id: this.slot + ':' + f.path, folder: this.slot, path: f.path, name: name.replace(/\.[^.]+$/, ''), kind: kindOf(name, this.kinds), size: f.size, mtime: f.mtime };
          if (f.bad) n.bad = true;
          if (e) {
            for (const k of EDITS) if (k in e) n[k] = e[k];
            drop.push(e.id);
          }
          put.push(n);
          next.push(n);
        }
        if (performance.now() - t > 12) {
          this.#emit('scan');
          await breathe();
          t = performance.now();
        }
      }
    } catch (e) {
      // the folder has gone, or the permission to read it
      console.warn(e);
      this.state = e.name === 'NotFoundError' ? 'missing' : 'denied';
      this.#emit('state');
      return;
    }
    // a cancelled scan only adds what it found; it does not know what is missing
    const gone = [];
    for (const e of this.entries) {
      if (seen.has(e.path)) continue;
      if (job.cancelled) next.push(e);
      else gone.push(e.id);
    }
    drop.push(...gone);
    for (let i = 0; i < Math.max(put.length, drop.length); i += 500) {
      await run(['entries', 'thumbs'], 'readwrite', (tr) => {
        for (const id of drop.slice(i, i + 500)) tr.objectStore('thumbs').delete(id);
        for (const id of gone.slice(i, i + 500)) tr.objectStore('entries').delete(id);
        for (const n of put.slice(i, i + 500)) tr.objectStore('entries').put(n);
      });
      await breathe();
    }
    for (const id of drop) {
      const u = this.urls.get(id);
      if (u) URL.revokeObjectURL(u);
      this.urls.delete(id);
    }
    this.#setEntries(next);
    this.#emit('entries');
    this.#pump();
  }

  // every file of our kinds in the folder and its subfolders: { path, size, mtime }
  async *#walk() {
    if (this.files) {
      for (const [path, f] of this.files) if (visible(path) && kindOf(path, this.kinds)) yield { path, size: f.size, mtime: f.lastModified };
      return;
    }
    const dirs = [[this.handle, '']];
    while (dirs.length) {
      const [dir, prefix] = dirs.pop();
      const found = [];
      for await (const [name, h] of dir.entries()) {
        if (name.startsWith('.')) continue;
        if (h.kind === 'directory') dirs.push([h, prefix + name + '/']);
        else if (kindOf(name, this.kinds)) found.push([prefix + name, h]);
      }
      // sizes and dates a few dozen files at a time: much faster than one by one
      for (let i = 0; i < found.length; i += 32) {
        const chunk = found.slice(i, i + 32);
        const files = await Promise.all(chunk.map(([, h]) => h.getFile().catch(() => null)));
        for (let k = 0; k < chunk.length; k++) {
          const [path, h] = chunk[k];
          const f = files[k];
          this.handles.set(path, h);
          yield f ? { path, size: f.size, mtime: f.lastModified } : { path, size: -1, mtime: 0, bad: true };
        }
      }
    }
  }

  // the File for an entry, read from the folder now
  async file(e) {
    if (this.files) {
      const f = this.files.get(e.path);
      if (!f) throw new DOMException(e.path + ' is not in the folder', 'NotFoundError');
      return f;
    }
    if (!this.handle) throw new DOMException('No folder', 'NotFoundError');
    let h = this.handles.get(e.path);
    if (!h) {
      const parts = e.path.split('/');
      let d = this.handle;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
      h = await d.getFileHandle(parts.at(-1));
      this.handles.set(e.path, h);
    }
    return h.getFile();
  }

  // ── what the app learns about entries ──────────────────────────────────────────────────
  save(e) {
    this.dirty.add(e);
    this.#later();
  }

  setSize(e, w, h) {
    e.w = w;
    e.h = h;
    this.save(e);
    this.#emit('size', e);
  }

  // a file that cannot be read or decoded is skipped from now on, and counted
  markBad(e) {
    if (e.bad) return;
    e.bad = true;
    this.save(e);
    this.#emit('bad', e);
  }

  #later() {
    if (!this.flushT) this.flushT = setTimeout(() => this.#flush(), 600);
  }

  async #flush() {
    this.flushT = 0;
    const rows = [...this.dirty].filter((e) => this.byId.get(e.id) === e); // not replaced by a rescan
    const blobs = [...this.blobs];
    this.dirty.clear();
    await run(['entries', 'thumbs'], 'readwrite', (t) => {
      for (const e of rows) t.objectStore('entries').put(e);
      for (const [id, b] of blobs) t.objectStore('thumbs').put(b, id);
    }).catch((e) => console.warn(e));
    for (const [id, b] of blobs) if (this.blobs.get(id) === b) this.blobs.delete(id);
  }

  // ── thumbnails ─────────────────────────────────────────────────────────────────────────
  // A worker makes the pictures' thumbnails, a few at a time; videos get a frame near 1 s, one at
  // a time, when the page is idle. What the grid shows comes first, then the rest of the index.
  want(list) {
    this.wanted = list;
    this.#pump();
  }

  #needs(e) {
    return !e.thumb && !e.bad && !this.busy.has(e.id);
  }

  #next(kind) {
    for (const e of this.wanted) if (e.kind === kind && this.byId.get(e.id) === e && this.#needs(e)) return e;
    const list = this.entries;
    let i = this.cursor[kind];
    // entries before the cursor are done (or being done), so it only moves forward
    while (i < list.length && (list[i].kind !== kind || list[i].thumb || list[i].bad)) i++;
    this.cursor[kind] = i;
    for (; i < list.length; i++) if (list[i].kind === kind && this.#needs(list[i])) return list[i];
    return null;
  }

  #pump() {
    if (!this.ready || !this.kinds.includes('image')) return;
    while (!this.noWorker && this.inflight < THUMBS_AT_ONCE) {
      const e = this.#next('image');
      if (!e) break;
      this.#thumb(e);
    }
    if (!this.videoBusy) {
      const v = this.#next('video');
      if (v) this.#videoThumb(v);
    }
  }

  async #thumb(e) {
    this.busy.add(e.id);
    this.inflight++;
    let r;
    try {
      r = await this.#work(e.id, await this.file(e));
    } catch (err) {
      r = { error: String(err) };
    }
    this.busy.delete(e.id);
    this.inflight--;
    if (r.fatal) this.noWorker = true; // this browser cannot draw in a worker: no picture thumbnails
    else this.#done(e, r);
    this.#pump();
  }

  #work(id, file) {
    if (!this.worker) {
      this.worker = new Worker(new URL('./thumb-worker.js', import.meta.url));
      this.worker.onmessage = ({ data }) => {
        this.jobs.get(data.id)?.(data);
        this.jobs.delete(data.id);
      };
      this.worker.onerror = (e) => {
        console.warn('Thumbnail worker failed', e);
        for (const res of this.jobs.values()) res({ fatal: true });
        this.jobs.clear();
      };
    }
    return new Promise((res) => {
      this.jobs.set(id, res);
      this.worker.postMessage({ id, file });
    });
  }

  async #videoThumb(e) {
    this.videoBusy = true;
    this.busy.add(e.id);
    await idle();
    let r;
    try {
      r = await videoFrame(await this.file(e));
    } catch (err) {
      r = { error: String(err) };
    }
    this.videoBusy = false;
    this.busy.delete(e.id);
    this.#done(e, r);
    this.#pump();
  }

  #done(e, r) {
    if (this.byId.get(e.id) !== e) return; // the file changed or went meanwhile
    if (r.error) {
      console.warn('Cannot read', e.path, r.error);
      return this.markBad(e);
    }
    e.w = r.w;
    e.h = r.h;
    e.thumb = true;
    this.blobs.set(e.id, r.blob);
    this.save(e);
    this.#emit('thumb', e);
  }

  // an object URL for an entry's thumbnail (null if it has none yet)
  async thumbUrl(e) {
    if (!e.thumb) return null;
    let u = this.urls.get(e.id);
    if (!u) {
      const blob = this.blobs.get(e.id) || (await run('thumbs', 'readonly', (t) => t.objectStore('thumbs').get(e.id)));
      if (!blob) return null;
      u = this.urls.get(e.id) || URL.createObjectURL(blob);
    }
    this.urls.delete(e.id);
    this.urls.set(e.id, u);
    if (this.urls.size > URLS_KEPT) {
      const [id, old] = this.urls.entries().next().value;
      URL.revokeObjectURL(old);
      this.urls.delete(id);
    }
    return u;
  }
}

// a frame near 1 s into a video, 256 px wide, and the video's size
async function videoFrame(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await event(v, 'loadedmetadata');
    v.currentTime = Math.min(1, (v.duration || 0) / 2);
    await event(v, 'seeked');
    if (!v.videoWidth) throw new Error('no picture');
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = Math.max(1, Math.round((256 * v.videoHeight) / v.videoWidth));
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.75));
    return { blob, w: v.videoWidth, h: v.videoHeight };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

function event(el, name, ms = 10000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timed out')), ms);
    el.addEventListener(name, () => (clearTimeout(t), res()), { once: true });
    el.addEventListener('error', () => (clearTimeout(t), rej(new Error('cannot decode'))), { once: true });
  });
}
