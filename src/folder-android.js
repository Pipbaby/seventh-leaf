// Folder mode inside the Android app (see docs/ANDROID.md). Folders on the phone are chosen with the
// system picker and kept by the native SeventhLeafFolders plugin, so they are still there the next
// time the app opens. A slot ('pictures' or 'music') may hold several folders, such as the camera
// folder and Pictures, added and removed one by one.
//
// Everything else works as on the desktop (folder.js): the same index in IndexedDB, the same
// thumbnails, scans and progress. The files are not copied: the app serves them to the page at
// /_sl/<folder id>/<path>, so pictures are read with fetch() and videos and music play from the URL.
import { Folder, kindOf, run, videoFrame } from './folder.js';

const native = () => window.Capacitor.Plugins.SeventhLeafFolders;
const THUMB_HEIGHT = 384; // tall pictures (screenshots) get small thumbnails too: the phone has little room

// an entry's path starts with its folder's id: "<id>/<path in the folder>"
const rootOf = (e) => e.path.slice(0, e.path.indexOf('/'));
const under = (slot, id) => IDBKeyRange.bound(slot + ':' + id + '/', slot + ':' + id + '/￿');

export class AndroidFolder extends Folder {
  constructor(slot, kinds) {
    super(slot, kinds);
    this.roots = []; // { id, name, state: 'ready' | 'denied' | 'missing' }, in the order added
    this.parked = []; // the index of folders that cannot be read now: kept for when they come back
    this.paused = false;
    this.thumbHeight = THUMB_HEIGHT;
  }

  get name() {
    return this.roots.map((r) => r.name).join(', ');
  }
  set name(v) {} // the desktop Folder sets it; here it comes from the folders

  // how many files each folder has in the index
  count(root) {
    let n = 0;
    for (const list of [this.entries, this.parked]) for (const e of list) if (!e.bad && rootOf(e) === root.id) n++;
    return n;
  }

  async load() {
    const rec = await run('folders', 'readonly', (t) => t.objectStore('folders').get(this.slot));
    if (!rec?.roots?.length) return;
    this.roots = rec.roots.map(({ id, name }) => ({ id, name, state: 'ready' }));
    this.setEntries(await run('entries', 'readonly', (t) => t.objectStore('entries').getAll(IDBKeyRange.bound(this.slot + ':', this.slot + ':￿'))));
    await this.check();
    if (this.ready) this.rescan();
  }

  // Ask the app which folders can still be read (Android can take the permission back, and a folder
  // can be moved or deleted). The index of the others is parked until they are chosen again.
  async check() {
    if (this.roots.length) {
      const { states } = await native().granted({ ids: this.roots.map((r) => r.id) });
      for (const r of this.roots) r.state = states[r.id] || 'denied';
    }
    this.split();
  }

  split() {
    const ok = new Set(this.roots.filter((r) => r.state === 'ready').map((r) => r.id));
    const all = [...this.entries, ...this.parked];
    this.parked = all.filter((e) => !ok.has(rootOf(e)));
    this.setEntries(all.filter((e) => ok.has(rootOf(e))));
    this.state = !this.roots.length ? 'none' : ok.size ? 'ready' : 'lost';
    this.emit('state');
  }

  #save() {
    const rec = { id: this.slot, name: this.name, roots: this.roots.map(({ id, name }) => ({ id, name })) };
    return run('folders', 'readwrite', (t) => t.objectStore('folders').put(rec));
  }

  // Add a folder, or choose one again whose permission was lost (again: that folder). Picking a
  // folder that is already in the list keeps its index.
  async choose(again) {
    let r;
    try {
      r = await native().pick({ slot: this.slot, id: again?.id });
    } catch (e) {
      if (e.code !== 'cancelled') console.warn(e);
      return;
    }
    const root = this.roots.find((x) => x.id === r.id);
    if (root) root.name = r.name;
    else this.roots.push({ id: r.id, name: r.name, state: 'ready' });
    await this.#save();
    await this.rescan();
  }

  reconnect() {
    return this.choose(this.roots.find((r) => r.state !== 'ready'));
  }

  // remove one folder: its index and thumbnails go, and the app no longer keeps access to it
  async remove(root) {
    await this.stopScan();
    this.roots = this.roots.filter((r) => r !== root);
    await native()
      .remove({ id: root.id })
      .catch((e) => console.warn(e));
    await run(['entries', 'thumbs'], 'readwrite', (t) => {
      t.objectStore('entries').delete(under(this.slot, root.id));
      t.objectStore('thumbs').delete(under(this.slot, root.id));
    });
    const gone = (id) => id.startsWith(this.slot + ':' + root.id + '/');
    for (const [id, u] of this.urls) if (gone(id)) (URL.revokeObjectURL(u), this.urls.delete(id));
    for (const id of this.blobs.keys()) if (gone(id)) this.blobs.delete(id);
    for (const e of this.dirty) if (gone(e.id)) this.dirty.delete(e);
    this.entries = this.entries.filter((e) => !gone(e.id));
    this.parked = this.parked.filter((e) => !gone(e.id));
    await this.#save();
    this.split();
    this.emit('entries');
  }

  async forget() {
    for (const r of [...this.roots]) await this.remove(r);
  }

  async rescan() {
    await this.stopScan();
    await this.check();
    if (!this.ready) return;
    await super.rescan();
    // a folder that failed while it was being read
    if (this.roots.some((r) => r.state !== 'ready')) {
      this.split();
      this.emit('entries');
    }
  }

  // every file of our kinds in the ready folders: { path, size, mtime }
  async *walk() {
    for (const root of this.roots) {
      if (root.state !== 'ready') continue;
      const seen = new Set();
      try {
        for await (const f of this.#list(root)) {
          const path = root.id + '/' + f.path;
          if (!kindOf(f.path, this.kinds)) continue;
          seen.add(path);
          yield { path, size: f.size, mtime: f.mtime };
        }
      } catch (e) {
        console.warn(e);
        root.state = e.code === 'missing' ? 'missing' : 'denied';
        // the rest of its index stays as it was (parked once the scan ends), not dropped as gone
        for (const x of this.entries) if (rootOf(x) === root.id && !seen.has(x.path)) yield { path: x.path, size: x.size, mtime: x.mtime };
      }
    }
  }

  // the files of one folder, as the plugin finds them, a few hundred at a time
  async *#list(root) {
    const chunks = [];
    let done = false;
    let error = null;
    let wake = null;
    native().list({ id: root.id }, (data, err) => {
      if (err) error = err;
      else {
        chunks.push(data.files);
        done = data.done;
      }
      wake?.();
    });
    try {
      for (;;) {
        while (chunks.length) yield* chunks.shift();
        if (error) throw error;
        if (done) return;
        await new Promise((r) => (wake = r));
        wake = null;
      }
    } finally {
      // the scan was cancelled: stop walking the folder
      if (!done && !error) native().cancel({ id: root.id });
    }
  }

  // where the app serves an entry's file
  url(e) {
    const i = e.path.indexOf('/');
    const rel = e.path.slice(i + 1).split('/').map(encodeURIComponent).join('/');
    return location.origin + '/_sl/' + e.path.slice(0, i) + '/' + rel;
  }

  async file(e) {
    const root = this.roots.find((r) => r.id === rootOf(e));
    if (root?.state !== 'ready') throw new DOMException(e.path + ' cannot be read now', 'NotAllowedError');
    const r = await fetch(this.url(e));
    if (!r.ok) throw new DOMException(`${e.path}: ${r.status}`, r.status === 404 ? 'NotFoundError' : 'NotAllowedError');
    return r.blob();
  }

  // a phone reads a large video slowly while it also makes picture thumbnails: give it a minute
  frame(e) {
    return videoFrame(this.url(e), this.thumbHeight, 60000);
  }

  // a file of a folder that is not readable now is not bad: it comes back with its folder
  markBad(e) {
    if (this.roots.find((r) => r.id === rootOf(e))?.state === 'ready') super.markBad(e);
  }

  // thumbnails can be paused (to save battery while the phone is busy); they carry on from where
  // they were, also after the app was closed
  pause(on) {
    this.paused = on;
    this.emit('state');
    if (!on) this.pump();
  }

  pump() {
    if (!this.paused) super.pump();
  }
}
