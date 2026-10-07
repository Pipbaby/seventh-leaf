// Unit tests for src/folder-android.js in Node, against a fake SeventhLeafFolders plugin and a fake
// IndexedDB. Run with `npm test` in android-app/.
import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── the page the module expects ─────────────────────────────────────────────────────────
const store = new Map();
Object.assign(globalThis, {
  window: globalThis,
  location: { search: '', hostname: 'localhost', origin: 'https://localhost', href: 'https://localhost/' },
  localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
});

// the phone's folders, as the fake plugin sees them
let phone;
let calls;
const plugin = {
  async pick({ id }) {
    calls.push(['pick', id]);
    const f = phone.next.shift();
    if (!f) throw { code: 'cancelled', message: 'No folder was chosen' };
    f.state = 'ready';
    return { id: f.id, name: f.name };
  },
  async granted({ ids }) {
    calls.push(['granted']);
    return { states: Object.fromEntries(ids.map((id) => [id, phone.folders[id]?.state ?? 'denied'])) };
  },
  async remove({ id }) {
    calls.push(['remove', id]);
    phone.folders[id].state = 'denied';
  },
  list({ id }, cb) {
    calls.push(['list', id]);
    const f = phone.folders[id];
    const files = f.files.filter((x) => !x.path.split('/').some((p) => p.startsWith('.')));
    f.cancelled = false;
    let i = 0;
    const step = () => {
      if (f.cancelled) return;
      if (f.failAt != null && i >= f.failAt) return cb(null, { code: f.failCode, message: 'gone' });
      const chunk = files.slice(i, i + 2);
      i += 2;
      cb({ files: chunk, done: i >= files.length });
      if (i < files.length) setTimeout(step, 1);
    };
    setTimeout(step, 1);
    return Promise.resolve('cb1');
  },
  async cancel({ id }) {
    calls.push(['cancel', id]);
    phone.folders[id].cancelled = true;
  },
};
window.Capacitor = { isNativePlatform: () => true, Plugins: { SeventhLeafFolders: plugin } };

// files are served at /_sl/<id>/<path>
globalThis.fetch = async (url) => {
  const m = /^https:\/\/localhost\/_sl\/([^/]+)\/(.+)$/.exec(url);
  const f = m && phone.folders[m[1]];
  const path = m && m[2].split('/').map(decodeURIComponent).join('/');
  const file = f?.state === 'ready' && f.files.find((x) => x.path === path);
  if (!file) return { ok: false, status: 404 };
  return { ok: true, status: 200, blob: async () => new Blob([path]) };
};

// the thumbnail worker: answers at once with a tiny "WebP"
let thumbsMade = 0;
let workerMessages = [];
globalThis.Worker = class {
  postMessage(msg) {
    workerMessages.push(msg);
    setTimeout(() => {
      thumbsMade++;
      this.onmessage({ data: { id: msg.id, blob: new Blob(['t']), w: 4000, h: 3000 } });
    }, 1);
  }
};

const { AndroidFolder } = await import('../../src/folder-android.js');
const { db } = await import('../../src/library.js');

const file = (path, size = 100, mtime = 1) => ({ path, size, mtime, type: 'image/jpeg' });
const settle = async (f) => {
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setTimeout(r, 5));
    const p = f.progress;
    if (!f.scanning && (p.done === p.media || f.paused)) break;
  }
  await new Promise((r) => setTimeout(r, 700)); // the index is written 600 ms after a change
};
const allKeys = async (store) => {
  const d = await db();
  return new Promise((res) => (d.transaction(store).objectStore(store).getAllKeys().onsuccess = (e) => res(e.target.result)));
};

beforeEach(async () => {
  calls = [];
  workerMessages = [];
  thumbsMade = 0;
  phone = {
    folders: {
      cam000000001: { id: 'cam000000001', name: 'Camera', files: [file('a.jpg'), file('b.jpg'), file('2024/c.jpg'), file('.thumbnails/x.jpg'), file('song.wma'), file('note.txt')] },
      pic000000002: { id: 'pic000000002', name: 'Pictures', files: [file('Screenshots/s 1.png'), file('Screenshots/s#2.png'), file('clip.mp4'), file('old.wma')] },
    },
    next: [],
  };
  // a new database each time
  const d = await db();
  await new Promise((res) => {
    const t = d.transaction(['folders', 'entries', 'thumbs'], 'readwrite');
    for (const s of ['folders', 'entries', 'thumbs']) t.objectStore(s).clear();
    t.oncomplete = res;
  });
});

// videos would need a <video>; their thumbnails are not what these tests are about
const make = () => {
  const f = new AndroidFolder('pictures', ['image', 'video']);
  f.frame = async () => ({ blob: new Blob(['v']), w: 1920, h: 1080 });
  return f;
};

test('adds several folders, skipping hidden and unsupported files', async () => {
  const f = make();
  phone.next.push(phone.folders.cam000000001, phone.folders.pic000000002);
  await f.choose();
  await f.choose();
  await settle(f);
  assert.equal(f.state, 'ready');
  assert.deepEqual(f.roots.map((r) => r.name), ['Camera', 'Pictures']);
  assert.equal(f.name, 'Camera, Pictures');
  assert.deepEqual(
    f.items().map((e) => e.path).sort(),
    ['cam000000001/2024/c.jpg', 'cam000000001/a.jpg', 'cam000000001/b.jpg', 'pic000000002/Screenshots/s 1.png', 'pic000000002/Screenshots/s#2.png', 'pic000000002/clip.mp4'],
  );
  assert.equal(f.count(f.roots[0]), 3);
  assert.equal(f.progress.done, 6);
  // tall pictures get small thumbnails on the phone
  assert.ok(workerMessages.every((m) => m.maxHeight === 384));
});

test('serves files at /_sl/<id>/<path>, with each part of the path encoded', async () => {
  const f = make();
  phone.next.push(phone.folders.pic000000002);
  await f.choose();
  await settle(f);
  const e = f.items().find((x) => x.name === 's#2');
  assert.equal(f.url(e), 'https://localhost/_sl/pic000000002/Screenshots/s%232.png');
  assert.equal(await (await f.file(e)).text(), 'Screenshots/s#2.png');
});

test('folders, index and thumbnails are still there after the app is reopened, without asking', async () => {
  const f = make();
  phone.next.push(phone.folders.cam000000001, phone.folders.pic000000002);
  await f.choose();
  await f.choose();
  await settle(f);
  const made = thumbsMade;

  calls = [];
  const g = make();
  await g.load();
  await settle(g);
  assert.ok(!calls.some(([c]) => c === 'pick'), 'no folder picker');
  assert.equal(g.state, 'ready');
  assert.deepEqual(g.roots.map((r) => r.name), ['Camera', 'Pictures']);
  assert.equal(g.items().length, 6);
  assert.equal(g.progress.done, 6);
  assert.equal(thumbsMade, made, 'no thumbnail made twice');
});

test('a scan can be cancelled and the index carries on where it was', async () => {
  const big = { id: 'big000000003', name: 'Pictures', files: Array.from({ length: 40 }, (_, i) => file(`p${i}.png`)) };
  phone.folders[big.id] = big;
  phone.next.push(big);
  const f = make();
  const chose = f.choose();
  while (!f.scanning || f.scanning.n < 6) await new Promise((r) => setTimeout(r, 1));
  f.cancel();
  await chose;
  assert.ok(calls.some(([c, id]) => c === 'cancel' && id === big.id), 'the walk was stopped');
  const part = f.entries.length;
  assert.ok(part >= 6 && part < 40, `kept what it had found (${part})`);

  // thumbnails can be paused, and are not lost when the app closes
  f.pause(true);
  await settle(f);
  const done = f.progress.done;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(f.progress.done, done, 'paused');
  assert.ok(done < part);
  const g = make();
  await g.load();
  await settle(g);
  assert.equal(g.entries.length, 40);
  assert.equal(g.progress.done, 40);
  assert.equal(thumbsMade, 40, 'each thumbnail made once');
});

test('a folder whose permission was taken back is set aside, and comes back when chosen again', async () => {
  const f = make();
  phone.next.push(phone.folders.cam000000001, phone.folders.pic000000002);
  await f.choose();
  await f.choose();
  await settle(f);

  phone.folders.cam000000001.state = 'denied';
  const g = make();
  await g.load();
  await settle(g);
  assert.equal(g.state, 'ready');
  assert.equal(g.roots[0].state, 'denied');
  assert.equal(g.items().length, 3, 'only the readable folder is shown');
  assert.equal(g.count(g.roots[0]), 3, 'its index is kept');
  assert.equal((await allKeys('entries')).length, 6);

  // all lost: nothing to show, and the panel asks to choose again
  phone.folders.pic000000002.state = 'missing';
  await g.rescan();
  assert.equal(g.state, 'lost');
  assert.equal(g.items().length, 0);

  phone.next.push(phone.folders.cam000000001);
  const made = thumbsMade;
  await g.choose(g.roots[0]);
  await settle(g);
  assert.deepEqual(calls.filter(([c]) => c === 'pick').at(-1), ['pick', 'cam000000001'], 'the picker opens at that folder');
  assert.equal(g.state, 'ready');
  assert.equal(g.items().length, 3);
  assert.equal(thumbsMade, made, 'its thumbnails were kept');
});

test('a folder that fails while being read keeps its index', async () => {
  const f = make();
  phone.next.push(phone.folders.cam000000001);
  await f.choose();
  await settle(f);
  phone.folders.cam000000001.failAt = 2;
  phone.folders.cam000000001.failCode = 'denied';
  await f.rescan();
  assert.equal(f.roots[0].state, 'denied');
  assert.equal(f.state, 'lost');
  assert.equal(f.count(f.roots[0]), 3);
  assert.equal((await allKeys('entries')).length, 3);
  assert.ok(!f.parked.some((e) => e.bad), 'nothing marked unreadable');
});

test('removing a folder drops its index and thumbnails and lets go of it', async () => {
  const f = make();
  phone.next.push(phone.folders.cam000000001, phone.folders.pic000000002);
  await f.choose();
  await f.choose();
  await settle(f);
  await f.remove(f.roots[0]);
  assert.deepEqual(calls.filter(([c]) => c === 'remove'), [['remove', 'cam000000001']]);
  assert.deepEqual(f.roots.map((r) => r.name), ['Pictures']);
  assert.equal(f.items().length, 3);
  assert.ok((await allKeys('entries')).every((k) => k.startsWith('pictures:pic000000002/')));
  assert.ok((await allKeys('thumbs')).every((k) => k.startsWith('pictures:pic000000002/')));
  await f.remove(f.roots[0]);
  assert.equal(f.state, 'none');
  assert.equal((await allKeys('entries')).length, 0);
  const g = make();
  await g.load();
  assert.equal(g.state, 'none');
});

test('closing the picker without a folder changes nothing', async () => {
  const f = make();
  await f.choose();
  assert.equal(f.state, 'none');
  assert.equal(f.roots.length, 0);
});

test('a video thumbnail that times out is tried again at the next scan, not counted as unreadable', async () => {
  const f = make();
  let slow = true;
  f.frame = async () => {
    if (slow) throw Object.assign(new Error('timed out'), { timedOut: true });
    return { blob: new Blob(['v']), w: 1920, h: 1080 };
  };
  phone.next.push(phone.folders.pic000000002);
  await f.choose();
  await settle(f);
  const clip = f.entries.find((e) => e.name === 'clip');
  assert.ok(!clip.bad && !clip.thumb, 'neither unreadable nor done');
  assert.equal(f.progress.bad, 0);
  assert.equal(f.progress.done, f.progress.media, 'the first index still finishes');

  slow = false;
  await f.rescan();
  await settle(f);
  assert.ok(f.entries.find((e) => e.name === 'clip').thumb, 'made at the next scan');
});

test('videos the first build marked unreadable are tried again once', async () => {
  const f = make();
  phone.next.push(phone.folders.pic000000002);
  await f.choose();
  await settle(f);
  const clip = f.entries.find((e) => e.name === 'clip');
  const shot = f.entries.find((e) => e.name === 's 1');
  f.markBad(clip);
  f.markBad(shot);
  await settle(f);
  store.delete('seventhleaf.retriedVideos.pictures');

  const g = make();
  await g.load();
  await settle(g);
  assert.ok(!g.entries.find((e) => e.name === 'clip').bad, 'the video is tried again');
  assert.ok(g.entries.find((e) => e.name === 's 1').bad, 'a picture stays unreadable');
  const h = make();
  await h.load();
  assert.equal(h.entries.find((e) => e.name === 'clip').bad, undefined);
  h.markBad(h.entries.find((e) => e.name === 'clip'));
  await settle(h);
  const i = make();
  await i.load();
  assert.ok(i.entries.find((e) => e.name === 'clip').bad, 'only once');
});
