import { Wall, COLS, ROWS, WALL_ASPECT } from './wall.js';
import { Sequencer, PATTERNS, DEFAULTS } from './sequencer.js';
import { Sound, DUCK_MODES } from './audio.js';
import * as lib from './library.js';
import { t, setLang, onLang, getLang, LANGS } from './i18n.js';
import { Folder, canRemember } from './folder.js';
import { VirtualList } from './virtual.js';

const $ = (s) => document.querySelector(s);
// inside the Android app only: its back gesture and other native glue
const native = !!window.Capacitor?.isNativePlatform();
if (native) import('./android.js');
const canvas = $('#wall');
const wall = new Wall(canvas);
let sound = null;
const seq = new Sequencer(wall, null);

// ── settings ────────────────────────────────────────────────────────────────────────────
const SETTINGS = 'seventhleaf.settings' + (lib.TEST ? '.test' : '');
const settings = {
  ...DEFAULTS,
  hold: 8,
  auto: true,
  shuffle: false,
  waitVideo: true,
  mode: 'printed',
  view: 'front',
  vol: { master: 0.85, flips: 0.8, music: 0.6, video: 0.8, room: 0.45 },
  duck: 'duck',
  musicShuffle: false,
  libMode: 'import', // the wall's pictures: imported | folder
  musicMode: 'import',
  triptych: true,
  details: true,
  lang: 'en',
  v: 4,
};
try {
  const s = JSON.parse(localStorage.getItem(SETTINGS));
  // timings and the wave were re-measured in v3: drop older saved ones
  // settings saved before the timings were measured (no version, or v < 3) lose those timings
  if (s && (s.v || 0) < 3) for (const k of ['interval', 'span', 'jitter', 'pattern']) delete s[k];
  if (s && s.v !== 4) for (const k of ['fall', 'v']) delete s[k];
  if (s) Object.assign(settings, s, { vol: { ...settings.vol, ...s.vol } });
} catch {}
const persist = () => {
  try {
    localStorage.setItem(SETTINGS, JSON.stringify(settings));
  } catch {}
};
Object.assign(seq.opts, pick(settings, Object.keys(DEFAULTS)));
wall.setMode(settings.mode);
wall.setView(settings.view);

function pick(o, keys) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}

// ── library → deck ──────────────────────────────────────────────────────────────────────
// The library is a list of items: the imported ones (with the demo or local/ pictures), or the
// index of a picture folder, which may hold many thousands. The wall's deck is made of the same
// items, a portrait set being an array of two or three. A source (what the wall's shader samples)
// is made for a folder item only when it comes up; imported items get theirs at once, as before.
// In the Android app the folders are on the phone, and a slot can hold several (folder-android.js).
const FolderKind = native ? (await import('./folder-android.js')).AndroidFolder : Folder;
const folders = { pictures: new FolderKind('pictures', ['image', 'video']), music: new FolderKind('music', ['audio']) };
let items = [];
let deck = [];
let posOf = new Map(); // item id → its place in the deck
const live = new Map(); // the sources made so far, by id
let index = 0; // the image the wall is showing / going to
let nextAt = Infinity;
let fromFolder = false; // the deck is a picture folder's

const usePictureFolder = () => settings.libMode === 'folder' && folders.pictures.ready && folders.pictures.items().length > 0;

let loadToken = 0;
async function loadLibrary() {
  const token = ++loadToken;
  const folder = usePictureFolder();
  const list = [];
  if (folder) list.push(...folders.pictures.items());
  else {
    for (const it of await lib.listItems()) {
      let s = live.get(it.id);
      if (!s) {
        try {
          s = await lib.makeSource(it, wall.renderer);
        } catch (e) {
          console.warn(e);
          continue;
        }
        live.set(it.id, s);
      }
      s.item = it;
      lib.xformFor(it, s.aspect, s.xform);
      list.push(it);
    }
  }
  if (token !== loadToken) return;
  const switched = folder !== fromFolder;
  fromFolder = folder;
  items = list;
  // a switch between imported pictures and a folder flips the wall over to the new deck
  rebuildDeck(switched && !sound);
  renderLibrary();
  updateTitle();
  if (switched && sound && deck.length) go(0);
}

// The wall's deck. With the three-portrait layout on, portraits are taken three at a time in
// library order (two at a time when that is what is left) and shown side by side; a set stands
// where its first member is. Landscape images, videos and a lone last portrait stay as they are.
// A folder picture counts as a portrait once its size is known (from its thumbnail).
function rebuildDeck(fresh) {
  const cur = deck[index];
  const keep = Array.isArray(cur) ? cur[0] : cur;
  deck = items.slice();
  if (settings.triptych) {
    const portraits = items.filter(portrait);
    const groups = [];
    for (let i = 0; i < portraits.length; i += 3) groups.push(portraits.slice(i, i + 3));
    if (groups.length > 1 && groups.at(-1).length === 1) {
      // 4 left → 2 + 2 rather than 3 + 1
      const last = groups.pop();
      const prev = groups.pop();
      groups.push(prev.slice(0, 2), [prev[2], ...last]);
    }
    const lead = new Map();
    const inSet = new Set();
    for (const g of groups) {
      if (g.length < 2) continue;
      lead.set(g[0], g);
      g.forEach((p) => inSet.add(p));
    }
    deck = [];
    for (const it of items) {
      if (lead.has(it)) deck.push(lead.get(it));
      else if (!inSet.has(it)) deck.push(it);
    }
  }
  posOf = new Map();
  deck.forEach((e, i) => {
    for (const it of [].concat(e)) posOf.set(it.id, i);
  });
  index = posOf.get(keep?.id) ?? 0;
  // sources whose items have left the library go; the others stay valid for cells showing them
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const [k, s] of live) {
    if ((s.members || [s]).every((m) => byId.get(m.item.id) === m.item)) continue;
    if (s.composite) lib.releaseSource(s);
    else lib.disposeSource(s);
    live.delete(k);
  }
  resetCells();
  if (deck.length && (fresh || !seq.state.some((c) => c.cur))) {
    const first = current();
    lib.ensureSource(first, wall.renderer).then(
      () => (fresh || !seq.state.some((c) => c.cur)) && seq.show(first),
      (e) => console.warn(e),
    );
  }
}

function portrait(it) {
  const s = live.get(it.id);
  if (s?.aspect) return lib.isPortrait(s);
  return it.kind === 'image' && it.w / it.h < 0.85;
}

const keyOf = (e) => (Array.isArray(e) ? 'set:' + e.map((it) => it.id).join('+') : e.id);

// the source for a deck entry, made when it first comes up
function srcOf(e) {
  if (!e) return null;
  let s = live.get(keyOf(e));
  if (s) return s;
  if (Array.isArray(e)) s = lib.makeComposite(e.map(srcOf), wall.renderer);
  else {
    const f = folders[e.folder];
    s = lib.folderSource(e, () => f.file(e), (w, h) => f.setSize(e, w, h), f.url && (() => f.url(e)));
  }
  live.set(s.id, s);
  return s;
}
const current = () => (deck.length ? srcOf(deck[index]) : null);
// whether a source is (still) one of the deck's: not a stale set, nor a portrait shown in a set
const inDeck = (s) => {
  const e = deck[posOf.get(s.members ? s.members[0].item.id : s.id)];
  return !!e && keyOf(e) === s.id;
};

// the cells may show any source that is still valid; one whose source has gone shows the current
function resetCells() {
  const cur = current();
  seq.setSources(cur ? [cur, ...[...live.values()].filter((s) => s !== cur)] : [...live.values()]);
}

const contains = (src, item) => !!src && (src.item.id === item.id || !!src.members?.some((m) => m.item.id === item.id));

// ── changing images ─────────────────────────────────────────────────────────────────────
// ?capture: a script steps a virtual clock frame by frame (for rendering videos)
const CAPTURE = new URLSearchParams(location.search).has('capture');
let virtualTime = 0;
const now = () => (CAPTURE ? virtualTime : performance.now() / 1000);

// ── pixels on demand ────────────────────────────────────────────────────────────────────
// A large library cannot sit on the GPU all at once. Before a change, the target and a pool of
// other pictures for the in-between leaves are loaded; afterwards anything not on the wall, in the
// pool or about to come next is released again (keeping at most LOADED_MAX).
const POOL = 10;
const LOADED_MAX = 18;
const SMALL = 200; // a deck this small is looked at whole; a larger one is sampled
let prefetched = null;

function wrap(i) {
  return ((i % deck.length) + deck.length) % deck.length;
}

function poolFor(target) {
  const n = Math.min(deck.length, POOL);
  const pool = [target];
  let videos = 0;
  const add = (x) => {
    if (!x || pool.includes(x) || pool.length >= n) return;
    // folder videos open only when they come up: at most two new ones as in-between leaves
    if (x.file && x.kind === 'video' && !lib.isLoaded(x) && videos++ >= 2) return;
    pool.push(x);
  };
  for (const c of seq.state) add(c.cur);
  if (settings.order === 'deck') {
    for (let k = 1; k < deck.length && k <= POOL * 3 && pool.length < n; k++) add(srcOf(deck[wrap(index + k)]));
  } else if (deck.length <= SMALL) {
    const rest = deck.map(srcOf).filter((x) => !pool.includes(x));
    // prefer pictures already loaded, then a random choice, so every change shows new fragments
    rest.sort((a, b) => (lib.isLoaded(b) - lib.isLoaded(a)) * 0.5 + (Math.random() - 0.5));
    rest.forEach(add);
  } else {
    // half from the pictures already loaded, half new ones from anywhere in the deck
    const loaded = [...live.values()].filter((s) => lib.isLoaded(s) && inDeck(s));
    for (let k = 0; pool.length < n && k < POOL * 6; k++) {
      if (loaded.length && Math.random() < 0.5) add(loaded.splice((Math.random() * loaded.length) | 0, 1)[0]);
      else add(srcOf(deck[(Math.random() * deck.length) | 0]));
    }
  }
  return pool;
}

function inUse() {
  const keep = new Set(seq.pool || []);
  for (const c of seq.state) {
    if (c.cur) keep.add(c.cur);
    if (c.flip) {
      keep.add(c.flip.from);
      keep.add(c.flip.to);
    }
    for (const q of c.queue) keep.add(q.src);
  }
  if (seq.lastChange.from) keep.add(seq.lastChange.from);
  if (prefetched) keep.add(prefetched);
  for (const s of pending) keep.add(s); // loading for a change that has not started yet
  return keep;
}

function evict() {
  const keep = inUse();
  let loaded = [...live.values()].filter(lib.isLoaded);
  for (const s of loaded.sort((a, b) => (a.used || 0) - (b.used || 0))) {
    if (loaded.length <= LOADED_MAX) break;
    if (keep.has(s) || (s.el && !s.file)) continue;
    lib.releaseSource(s);
    loaded = loaded.filter((x) => x !== s);
  }
  forgetIdle(keep);
}

// Sets, and folder items' sources, that are neither loaded nor in use are forgotten: they are
// made again when they come up, so a long slideshow through a big folder does not pile them up.
function forgetIdle(keep) {
  const idle = (s) => !lib.isLoaded(s) && !s.loading && !keep.has(s);
  const members = new Set();
  for (const [k, s] of live) {
    if (!s.composite) continue;
    if (idle(s)) live.delete(k);
    else s.members.forEach((m) => members.add(m));
  }
  for (const [k, s] of live) if (s.file && idle(s) && !members.has(s)) live.delete(k);
}

function ensure(list) {
  const t = now();
  return Promise.all(
    list.map((s) => {
      s.used = t;
      return lib.ensureSource(s, wall.renderer).catch((e) => console.warn(e));
    }),
  );
}

let goToken = 0;
let pending = [];
async function go(i, origin, skips = 0) {
  if (!deck.length) return scheduleNext(now());
  index = wrap(i);
  const target = current();
  const token = ++goToken;
  updateTitle();
  let pool = poolFor(target);
  pending = pool;
  await ensure(pool);
  if (token !== goToken) return; // a newer change was asked for meanwhile
  pending = [];
  // folder files that cannot be read are skipped (and counted); the next picture is tried instead.
  // One whose read failed or stopped (MEDIA_ERR_NETWORK, a busy phone) is skipped now but not
  // counted: it comes up again later.
  const failed = pool.filter((s) => !lib.isLoaded(s) && (s.members || [s]).some((m) => m.error));
  if (failed.length) {
    for (const s of failed) for (const m of s.members || [s]) if (m.error && !m.error.retry) folders[m.item.folder]?.markBad(m.item);
    if (failed.includes(target)) {
      if (skips < 20) return go(pickNext(), origin, skips + 1);
      return scheduleNext(now()); // try again after the usual hold
    }
    pool = pool.filter((s) => !failed.includes(s));
  }
  seq.pool = pool;
  const end = seq.change(target, origin, now());
  scheduleNext(end);
  updateTitle();
  syncVideos(true);
  // the next picture loads in the background while this one shows
  prefetched = settings.shuffle ? null : srcOf(deck[wrap(index + 1)]);
  if (prefetched) ensure([prefetched]);
  evict();
}

function pickNext() {
  if (!settings.shuffle || deck.length <= 2) return index + 1;
  let j;
  do j = (Math.random() * deck.length) | 0;
  while (j === index);
  return j;
}
function next(origin) {
  go(pickNext(), origin);
}

function scheduleNext(end) {
  if (!settings.auto) {
    nextAt = Infinity;
    return;
  }
  let hold = settings.hold;
  const s = current();
  if (s?.el && settings.waitVideo && Number.isFinite(s.el.duration)) hold = Math.max(hold, s.el.duration - 0.5);
  nextAt = end + hold;
}

function updateTitle() {
  const s = current();
  $('#title').textContent = s ? s.item.name : t('lib.empty');
  $('#count').textContent = deck.length ? `${index + 1} / ${deck.length}` : '';
  $('#auto').textContent = settings.auto ? '❚❚' : '▶';
  $('#auto').title = settings.auto ? t('bar.pause') : t('bar.play');
  document.querySelectorAll('.thumb').forEach((el) => el.classList.toggle('on', contains(s, { id: el.dataset.id })));
}

// videos: play those visible on the wall; only the one being shown is heard
function syncVideos(restart) {
  const used = new Set();
  for (const c of seq.state) {
    if (c.cur) used.add(c.cur);
    if (c.flip) used.add(c.flip.to);
    for (const q of c.queue) used.add(q.src);
  }
  const target = current();
  let audible = false;
  for (const s of live.values()) {
    if (!s.el) continue;
    const isTarget = s === target;
    if (used.has(s) || isTarget) {
      if (sound) sound.attach(s.el, 'video');
      if (restart && isTarget) s.el.currentTime = 0;
      s.el.loop = s.item.loop !== false;
      s.el.muted = !isTarget || !!s.item.muted || !sound;
      if (s.el.paused) s.el.play().catch(() => {});
      if (isTarget && !s.el.muted) audible = true;
    } else if (!s.el.paused) s.el.pause();
  }
  if (sound && audible !== videoAudible) {
    videoAudible = audible;
    sound.videoAudible(audible, music.el);
  }
}
let videoAudible = false;

// ── music ───────────────────────────────────────────────────────────────────────────────
// Added music lives in the browser. A music folder is read a track at a time: only the track that
// is playing has an object URL.
const music = { list: [], i: 0, el: new Audio(), url: null, fails: 0 };
music.el.preload = 'auto';
music.el.addEventListener('ended', () => musicNext());
music.el.addEventListener('playing', () => (music.fails = 0));
music.el.addEventListener('error', () => music.el.getAttribute('src') && musicFailed(music.list[music.i]));

async function loadMusic() {
  const folder = settings.musicMode === 'folder' && folders.music.ready && folders.music.items().length > 0;
  const was = music.list[music.i];
  const list = folder ? folders.music.items() : (await lib.listMusic()).filter((m) => m.id !== '__flip__');
  music.list = list;
  // keep the place of the track playing; if it has gone, carry on with the new list
  const at = was ? list.findIndex((m) => m.id === was.id) : -1;
  if (at >= 0) music.i = at;
  else if (music.el.getAttribute('src')) {
    const playing = !music.el.paused;
    music.el.pause();
    music.el.removeAttribute('src');
    music.i = 0;
    if (playing) musicPlay(0);
  }
  renderMusic();
}

let musicToken = 0;
async function musicPlay(i) {
  if (!music.list.length) return;
  music.i = ((i % music.list.length) + music.list.length) % music.list.length;
  const m = music.list[music.i];
  const token = ++musicToken;
  // the Android app plays a folder's track from where it serves the file
  let url = !m.blob && folders.music.url ? folders.music.url(m) : null;
  if (!url) {
    let blob = m.blob;
    if (!blob) {
      try {
        blob = await folders.music.file(m);
      } catch (e) {
        console.warn(e);
        if (token === musicToken) musicFailed(m);
        return;
      }
      if (token !== musicToken) return;
    }
    url = URL.createObjectURL(blob);
  }
  if (music.url) URL.revokeObjectURL(music.url);
  music.url = url;
  music.el.src = music.url;
  if (sound) sound.attach(music.el, 'music');
  music.el.play().catch(() => {});
  renderMusic();
}
function musicNext() {
  if (!music.list.length) return;
  musicPlay(settings.musicShuffle && music.list.length > 1 ? (music.i + 1 + ((Math.random() * (music.list.length - 1)) | 0)) % music.list.length : music.i + 1);
}
// a folder track that cannot be read or played is skipped from now on, and counted
function musicFailed(m) {
  if (!m?.folder) return;
  folders.music.markBad(m);
  if (++music.fails < Math.min(20, music.list.length)) musicNext();
}
function musicToggle() {
  if (!music.el.src) return musicPlay(0);
  if (music.el.paused) music.el.play().catch(() => {});
  else music.el.pause();
}
music.el.addEventListener('play', renderMusic);
music.el.addEventListener('pause', renderMusic);

// ── UI: library ─────────────────────────────────────────────────────────────────────────
// The grid is virtual: only the thumbnails in view exist in the page.
let selected = null;
let shown = []; // the items in the grid: the library, or what the search finds
const num = (n) => n.toLocaleString(getLang() === 'zh' ? 'zh-CN' : getLang());

const grid = new VirtualList($('#grid'), $('#p-lib'), {
  columns: 3,
  gap: 6,
  height: (w) => w,
  make: makeCard,
  render: (i, card) => fillCard(card, shown[i]),
  // folder thumbnails in view are made first
  onrange: (from, to) => fromFolder && folders.pictures.want(shown.slice(from, to).filter((it) => !it.thumb)),
});

function makeCard() {
  const card = document.createElement('div'); // not `t`: that name is the translator
  card.innerHTML = `<img alt="" decoding="async"><span class="kind"></span><button class="x">×</button><span class="nm"></span>`;
  card.onclick = (e) => {
    const it = card.item;
    if (e.target.classList.contains('x')) return;
    selected = it.id;
    go(posOf.get(it.id) ?? index);
    renderLibrary();
  };
  card.querySelector('.x').onclick = async () => {
    const it = card.item;
    if (!confirm(t('lib.confirmDelete', { name: it.name }) + (it.local ? '\n' + t('lib.confirmLocal') : ''))) return;
    await lib.deleteItem(it);
    if (selected === it.id) selected = null;
    await loadLibrary();
  };
  // drag to reorder (imported pictures; a folder keeps the order of its file names)
  card.ondragstart = (e) => e.dataTransfer.setData('text/seventh-leaf', card.item.id);
  card.ondragover = (e) => e.dataTransfer.types.includes('text/seventh-leaf') && e.preventDefault();
  card.ondrop = (e) => {
    const id = e.dataTransfer.getData('text/seventh-leaf');
    if (!id || card.item.folder) return;
    e.preventDefault();
    e.stopPropagation();
    const from = items.findIndex((x) => x.id === id);
    const to = items.indexOf(card.item);
    if (from < 0 || to < 0) return;
    const [m] = items.splice(from, 1);
    items.splice(to, 0, m);
    lib.saveOrder(items);
    rebuildDeck();
    renderLibrary();
    updateTitle();
  };
  return card;
}

function fillCard(card, it) {
  const img = card.querySelector('img');
  if (card.item !== it || !img.getAttribute('src')) {
    img.removeAttribute('src');
    if (it.folder) folders.pictures.thumbUrl(it).then((u) => u && card.item === it && (img.src = u));
    else if (live.get(it.id)?.thumb) img.src = live.get(it.id).thumb;
  }
  card.item = it;
  card.dataset.id = it.id;
  card.className = 'thumb' + (contains(current(), it) ? ' on' : '') + (it.id === selected ? ' sel' : '');
  card.draggable = !it.folder && !$('#lib-search').value;
  card.querySelector('.kind').textContent = it.kind === 'video' ? '▶' : '';
  card.querySelector('.x').hidden = !!it.folder;
  card.querySelector('.x').title = t('lib.delete');
  card.querySelector('.nm').textContent = it.name;
}

function renderLibrary() {
  const q = $('#lib-search').value.trim().toLowerCase();
  shown = q ? items.filter((it) => (it.path || it.name).toLowerCase().includes(q)) : items;
  grid.setCount(shown.length);
  $('#lib-count').textContent = q ? t('lib.found', { n: num(shown.length), total: num(items.length) }) : t('lib.count', { n: num(items.length) });
  const h = fromFolder ? 0 : lib.hiddenCount();
  $('#restore').hidden = !h;
  $('#restore').textContent = t('lib.restore', { n: h });
  renderEditor();
}
$('#lib-search').oninput = () => renderLibrary();

function renderEditor() {
  const ed = $('#editor');
  const it = selected && items.find((x) => x.id === selected);
  ed.hidden = !it;
  if (!it) return;
  const s = srcOf(it);
  const set = Array.isArray(deck[posOf.get(it.id)]);
  $('#ed-name').textContent = it.name;
  $('#ed-fit').value = it.fit || 'auto';
  $('#ed-fx').value = it.focus?.[0] ?? 0.5;
  $('#ed-fy').value = it.focus?.[1] ?? 0.7;
  $('#ed-zoom').value = it.zoom || 1;
  const cover = set || lib.fitOf(it, s.aspect) === 'cover';
  $('#ed-cover').hidden = !cover;
  $('#ed-fit-row').hidden = set;
  $('#ed-set').hidden = !set;
  $('#ed-video').hidden = it.kind !== 'video';
  $('#ed-loop').checked = it.loop !== false;
  $('#ed-mute').checked = !!it.muted;
}

async function editSelected(patch) {
  const it = items.find((x) => x.id === selected);
  if (!it) return;
  const s = srcOf(it);
  if (it.folder) {
    Object.assign(it, patch);
    folders[it.folder].save(it);
  } else await lib.updateItem(it, patch);
  lib.xformFor(it, s.aspect || WALL_ASPECT, s.xform);
  for (const set of live.values()) {
    if (set.members?.includes(s) && lib.isLoaded(set)) lib.drawComposite(set, wall.renderer);
  }
  if (s.el) s.el.loop = it.loop !== false;
  // re-apply to every cell showing it
  resetCells();
  syncVideos(false);
  renderEditor();
}

$('#ed-fit').onchange = (e) => editSelected({ fit: e.target.value });
$('#ed-fx').oninput = (e) => editSelected({ focus: [+e.target.value, +$('#ed-fy').value] });
$('#ed-fy').oninput = (e) => editSelected({ focus: [+$('#ed-fx').value, +e.target.value] });
$('#ed-zoom').oninput = (e) => editSelected({ zoom: +e.target.value });
$('#ed-loop').onchange = (e) => editSelected({ loop: e.target.checked });
$('#ed-mute').onchange = (e) => editSelected({ muted: e.target.checked });
$('#ed-close').onclick = () => {
  selected = null;
  renderLibrary();
};
$('#restore').onclick = async () => {
  lib.restoreHidden();
  await loadLibrary();
};

async function importAny(files) {
  files = [...files];
  const media = files.filter((f) => /^(image|video)\//.test(f.type));
  const audio = files.filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|flac|ogg|opus|wav)$/i.test(f.name));
  if (media.length) {
    toast(t('lib.importing', { n: media.length }));
    await lib.importFiles(media);
    await loadLibrary();
  }
  if (audio.length) {
    await lib.importMusic(audio);
    await loadMusic();
    if (music.el.paused && !music.el.src) musicPlay(music.list.length - audio.length);
  }
  if (media.length || audio.length) toast(t('lib.imported'));
}
$('#import').onchange = (e) => importAny(e.target.files).then(() => (e.target.value = ''));
$('#music-add').onchange = (e) => importAny(e.target.files).then(() => (e.target.value = ''));
addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('Files')) {
    e.preventDefault();
    document.body.classList.add('dropping');
  }
});
addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dropping');
});
addEventListener('drop', (e) => {
  document.body.classList.remove('dropping');
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  importAny(e.dataTransfer.files);
});

// ── UI: music ───────────────────────────────────────────────────────────────────────────
const tracks = new VirtualList($('#music'), $('#p-sound'), {
  height: () => 26,
  make() {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><button class="x" title="Delete">×</button>';
    li.querySelector('span').onclick = () => musicPlay(li.i);
    li.querySelector('.x').onclick = async () => {
      const m = music.list[li.i];
      if (!confirm(t('sound.confirmDelete', { name: m.name }))) return;
      if (li.i === music.i) {
        music.el.pause();
        music.el.removeAttribute('src');
      }
      await lib.deleteMusic(m);
      await loadMusic();
    };
    return li;
  },
  render(i, li) {
    const m = music.list[i];
    li.i = i;
    li.className = i === music.i && music.el.src ? 'on' : '';
    li.querySelector('span').textContent = m.name;
    li.querySelector('.x').hidden = !!m.folder;
  },
});

function renderMusic() {
  tracks.setCount(music.list.length);
  $('#music-empty').hidden = music.list.length > 0;
  $('#music-play').textContent = music.el.paused ? '▶' : '❚❚';
  $('#now-music').textContent = !music.el.paused && music.list[music.i] ? '♪ ' + music.list[music.i].name : '';
}
$('#music-play').onclick = () => musicToggle();
$('#music-next').onclick = () => musicNext();
$('#music-shuffle').checked = settings.musicShuffle;
$('#music-shuffle').onchange = (e) => {
  settings.musicShuffle = e.target.checked;
  persist();
};

$('#flip-file').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  await lib.setFlipSample(f);
  await sound?.setCustomFlip(f);
  flipName = f.name;
  renderFlipSrc();
  e.target.value = '';
};
$('#flip-reset').onclick = async () => {
  await lib.setFlipSample(null);
  await sound?.setCustomFlip(null);
  flipName = null;
  renderFlipSrc();
};

// ── UI: folders ─────────────────────────────────────────────────────────────────────────
// Each folder has a panel (from the #folder-ui template): choose, reconnect, rescan, progress,
// the files that could not be read, and what to do when the folder cannot be opened.
const panels = { pictures: $('#lib-folder'), music: $('#music-folder') };
const timers = new Map();
function soon(f, ms = 1500) {
  if (!timers.has(f)) timers.set(f, setTimeout(() => (timers.delete(f), f()), ms));
}
const refreshDeck = () => {
  rebuildDeck();
  renderEditor();
  updateTitle();
};

function renderFolder(f) {
  const box = panels[f.slot];
  const q = (c) => box.querySelector(c);
  const p = f.progress;
  const vars = { name: f.name };
  // sentences are joined with a space in English, without one in Chinese and Japanese
  const fallback = settings[f.slot === 'music' ? 'musicMode' : 'libMode'] === 'folder' ? (getLang() === 'en' ? ' ' : '') + t('folder.fallback.' + f.slot) : '';
  const lost = ['again', 'missing', 'denied', 'lost'].includes(f.state);
  const roots = f.roots; // the Android app: a slot holds several folders, listed one by one
  q('.f-intro').hidden = f.state !== 'none';
  q('.f-intro').textContent = t('folder.intro.' + f.slot + (native ? '.phone' : ''));
  q('.f-head').hidden = f.state === 'none' || !!roots;
  renderRoots(f, q('.f-roots'));
  q('.f-name').textContent = '📁 ' + f.name;
  q('.f-count').textContent = t(f.slot === 'music' ? 'sound.tracks' : 'lib.count', { n: num(p.files - p.bad) });
  q('.f-choose').textContent = t(roots ? 'folder.add' : lost ? 'folder.chooseAgain' : f.state === 'none' ? 'folder.choose' : 'folder.change');
  q('.f-reconnect').hidden = f.state !== 'reconnect';
  q('.f-rescan').hidden = !f.ready || !!f.scanning;
  let status = '';
  if (f.state === 'lost') status = fallback.trim(); // each folder's row says why
  else if (f.state === 'reconnect') status = t('folder.reconnectHint', vars) + fallback;
  else if (lost) status = t('folder.' + f.state, vars) + fallback;
  else if (f.ready && !f.scanning && !p.files) status = t('folder.empty.' + f.slot);
  q('.f-status').hidden = !status;
  q('.f-status').textContent = status;
  q('.f-scan').hidden = !f.scanning && !(f.ready && p.done < p.media);
  q('.f-progress').textContent = f.scanning ? t('folder.scanning', { n: num(f.scanning.n) }) : t('folder.thumbs', { done: num(p.done), total: num(p.media) });
  q('.f-cancel').hidden = !f.scanning;
  q('.f-pause').hidden = !f.pause || !!f.scanning;
  q('.f-pause').textContent = t(f.paused ? 'folder.resume' : 'folder.pause');
  q('.f-bad').hidden = !p.bad;
  q('.f-bad').textContent = t('folder.bad', { n: num(p.bad) });
  q('.f-note').hidden = canRemember || native || f.state === 'none';
  q('.f-note').textContent = t('folder.noMemory');
  q('.f-forget').hidden = f.state === 'none' || !!roots;
}

// the Android app's folders: name, files, remove, and choose again when it can no longer be read.
// Built again only when something in it changes, so a tap is not lost to a repaint. Its class names
// differ from the panel's own, which renderFolder() finds with querySelector().
function renderRoots(f, ul) {
  const rows = (f.roots || []).map((r) => ({ r, n: f.count(r) }));
  const key = getLang() + JSON.stringify(rows.map(({ r, n }) => [r.id, r.name, r.state, n]));
  ul.hidden = !rows.length;
  if (ul.dataset.key === key) return;
  ul.dataset.key = key;
  ul.replaceChildren(
    ...rows.map(({ r, n }) => {
      const li = document.createElement('li');
      li.innerHTML = `<div class="row f-root"><b class="f-rname"></b><span class="hint f-rcount"></span><button class="x"></button></div>`;
      li.querySelector('.f-rname').textContent = '📁 ' + r.name;
      li.querySelector('.f-rcount').textContent = t(f.slot === 'music' ? 'sound.tracks' : 'lib.count', { n: num(n) });
      const x = li.querySelector('.x');
      x.textContent = '×';
      x.title = t('folder.remove');
      x.onclick = () => confirm(t('folder.confirmRemove', { name: r.name })) && f.remove(r);
      if (r.state !== 'ready') {
        const why = Object.assign(document.createElement('p'), { className: 'hint f-why' });
        why.textContent = t(r.state === 'missing' ? 'folder.missing' : 'folder.revoked', { name: r.name });
        const again = Object.assign(document.createElement('button'), { textContent: t('folder.chooseAgain') });
        again.onclick = () => f.choose(r);
        li.append(why, again);
      }
      return li;
    }),
  );
}

const painting = new Set();
function paintFolder(f) {
  if (painting.has(f)) return;
  painting.add(f);
  requestAnimationFrame(() => {
    painting.delete(f);
    renderFolder(f);
  });
}

for (const f of Object.values(folders)) {
  const box = panels[f.slot];
  box.append($('#folder-ui').content.cloneNode(true));
  box.querySelector('.f-choose').onclick = () => f.choose();
  box.querySelector('.f-reconnect').onclick = () => f.reconnect();
  box.querySelector('.f-rescan').onclick = () => f.rescan();
  box.querySelector('.f-cancel').onclick = () => f.cancel();
  box.querySelector('.f-pause').onclick = () => f.pause(!f.paused);
  box.querySelector('.f-forget').onclick = () => confirm(t('folder.confirmForget', { name: f.name })) && f.forget();
  const reload = f.slot === 'music' ? loadMusic : loadLibrary;
  f.on((what, e) => {
    paintFolder(f);
    if (what === 'state' || what === 'entries') reload();
    else if (what === 'bad') soon(reload);
    else if (f.slot === 'pictures' && (what === 'thumb' || what === 'size')) {
      for (const card of $('#grid').children) if (card.item === e) fillCard(card, e);
      // a picture's size decides whether it joins a portrait set
      // not too often: regrouping reloads pictures on the wall, and sizes arrive many per second
      if (fromFolder && settings.triptych && e.kind === 'image' && (what === 'size' || portrait(e))) soon(refreshDeck, 6000);
    }
  });
}

// imported pictures or a folder; added music or a music folder
for (const [seg, key, reload] of [['#lib-mode', 'libMode', () => loadLibrary()], ['#music-mode', 'musicMode', () => loadMusic()]]) {
  const show = () => {
    for (const b of $(seg).querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === settings[key]);
    for (const el of document.querySelectorAll(`[data-show="${key}"]`)) el.hidden = el.dataset.when !== settings[key];
    Object.values(folders).forEach(renderFolder);
  };
  for (const b of $(seg).querySelectorAll('button')) {
    b.onclick = () => {
      settings[key] = b.dataset.mode;
      persist();
      show();
      reload();
    };
  }
  show();
}

// ── UI: controls ────────────────────────────────────────────────────────────────────────
function bindRange(id, key, fmt, apply) {
  const el = $(id);
  const out = $(id + '-v');
  el.value = settings[key];
  const show = () => out && (out.textContent = fmt(+el.value));
  show();
  el.oninput = () => {
    settings[key] = +el.value;
    show();
    apply?.(+el.value);
    persist();
  };
}
const syncSeq = () => Object.assign(seq.opts, pick(settings, Object.keys(DEFAULTS)));
bindRange('#flips', 'flips', (v) => `${v}×`, syncSeq);
bindRange('#interval', 'interval', (v) => `${v.toFixed(2)} s`, syncSeq);
bindRange('#span', 'span', (v) => `${v.toFixed(1)} s`, syncSeq);
bindRange('#hold', 'hold', (v) => `${v} s`, () => scheduleNext(seq.lastChange.t1));

const patSel = $('#pattern');
for (const k of Object.keys(PATTERNS)) patSel.add(new Option(t('pattern.' + k), k));
patSel.value = settings.pattern;
patSel.onchange = () => {
  settings.pattern = patSel.value;
  syncSeq();
  persist();
};
$('#order').value = settings.order;
$('#order').onchange = (e) => {
  settings.order = e.target.value;
  syncSeq();
  persist();
};
$('#mode').value = settings.mode;
$('#mode').onchange = (e) => {
  settings.mode = e.target.value;
  wall.setMode(settings.mode);
  persist();
};
$('#view').value = settings.view;
$('#view').onchange = (e) => {
  settings.view = e.target.value;
  wall.setView(settings.view);
  persist();
};
$('#shuffle').checked = settings.shuffle;
$('#shuffle').onchange = (e) => {
  settings.shuffle = e.target.checked;
  persist();
};
$('#triptych').checked = settings.triptych;
$('#triptych').onchange = (e) => {
  settings.triptych = e.target.checked;
  persist();
  rebuildDeck();
  go(index);
  renderLibrary();
};
$('#details').checked = settings.details;
wall.setDetails(settings.details);
$('#details').onchange = (e) => {
  settings.details = e.target.checked;
  wall.setDetails(settings.details);
  persist();
};
$('#clock').checked = settings.clock;
$('#clock').onchange = (e) => {
  settings.clock = e.target.checked;
  syncSeq();
  persist();
};
$('#wait-video').checked = settings.waitVideo;
$('#wait-video').onchange = (e) => {
  settings.waitVideo = e.target.checked;
  persist();
};

for (const bus of ['master', 'flips', 'room', 'music', 'video']) {
  const el = $('#vol-' + bus);
  const out = $('#vol-' + bus + '-v');
  el.value = settings.vol[bus];
  const show = () => (out.textContent = Math.round(el.value * 100) + '%');
  show();
  el.oninput = () => {
    settings.vol[bus] = +el.value;
    show();
    sound?.setVolume(bus, +el.value);
    persist();
  };
}
const duckSel = $('#duck');
for (const k of Object.keys(DUCK_MODES)) duckSel.add(new Option(t('duck.' + k), k));
duckSel.value = settings.duck;
duckSel.onchange = () => {
  settings.duck = duckSel.value;
  if (sound) {
    sound.duckMode = settings.duck;
    sound.videoAudible(videoAudible, music.el);
  }
  persist();
};

$('#prev').onclick = () => go(index - 1);
$('#next').onclick = () => next();
$('#auto').onclick = () => toggleAuto();
function toggleAuto() {
  settings.auto = !settings.auto;
  persist();
  scheduleNext(Math.max(now(), seq.lastChange.t1));
  updateTitle();
}

document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.page').forEach((p) => (p.hidden = p.id !== b.dataset.page));
  };
});
function layout() {
  const open = document.body.classList.contains('panel-open') && !document.body.classList.contains('bare');
  const narrow = innerWidth <= 700;
  wall.setInset(open && !narrow ? 336 : 0, (open && narrow ? innerHeight * 0.6 + 16 : 0) + (document.body.classList.contains('bare') ? 0 : 48));
}
$('#panel-toggle').onclick = () => {
  document.body.classList.toggle('panel-open');
  layout();
};
addEventListener('resize', layout);
layout();

// pictures keep their pixels only on the GPU: if it was reset, they load again from their files
canvas.addEventListener('webglcontextrestored', () => {
  for (const s of live.values()) if (s.kind === 'image') lib.releaseSource(s);
  if (deck.length) go(index);
});

// ── wall interaction: drag to look around, click a cell to flip it, shift-click for a ripple
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (drag.moved > 4) wall.orbit(dx, dy);
});
canvas.addEventListener('pointerup', (e) => {
  const d = drag;
  drag = null;
  if (!d || d.moved > 4) return;
  const cell = wall.pick(e.clientX, e.clientY);
  if (!cell) return;
  if (e.shiftKey) {
    const p = settings.pattern;
    seq.opts.pattern = 'radial';
    next(cell);
    seq.opts.pattern = p;
  } else seq.poke(cell.c, cell.r, now());
});
canvas.addEventListener('dblclick', () => wall.setView(settings.view));
canvas.addEventListener('wheel', (e) => wall.zoom(Math.exp(e.deltaY * 0.001)), { passive: true });

addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.key === 'ArrowRight') next();
  else if (e.key === 'ArrowLeft') go(index - 1);
  else if (e.key === ' ') {
    e.preventDefault();
    toggleAuto();
  } else if (e.key === 'h' || e.key === 'H') {
    document.body.classList.toggle('bare');
    layout();
  }
  else if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  } else if (/^[1-7]$/.test(e.key)) {
    patSel.value = Object.keys(PATTERNS)[+e.key - 1];
    patSel.onchange();
    toast(t('pattern.' + patSel.value));
  } else if (e.key === 'm' || e.key === 'M') musicToggle();
});

// ── language ────────────────────────────────────────────────────────────────────────────
let flipName = null; // a user flip sample, if any
function renderFlipSrc() {
  $('#flip-src').textContent = flipName || t('sound.builtin');
}
onLang(() => {
  for (const o of patSel.options) o.textContent = t('pattern.' + o.value);
  for (const o of duckSel.options) o.textContent = t('duck.' + o.value);
  renderFlipSrc();
  updateTitle();
  renderLibrary();
  Object.values(folders).forEach(renderFolder);
});
document.querySelectorAll('#lang button').forEach((b) => {
  b.onclick = () => {
    settings.lang = b.dataset.lang;
    persist();
    setLang(settings.lang);
  };
});
setLang(LANGS[settings.lang] ? settings.lang : 'en');

let toastT = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 1800);
}

// ── start: audio needs a gesture ────────────────────────────────────────────────────────
async function start() {
  $('#start').remove();
  sound = new Sound();
  seq.sound = sound;
  sound.duckMode = settings.duck;
  for (const [bus, v] of Object.entries(settings.vol)) sound.setVolume(bus, v);
  await sound.resume();
  const f = await lib.getFlipSample();
  if (f) {
    await sound.setCustomFlip(f.blob);
    flipName = f.name;
    renderFlipSrc();
  }
  // a page that hosts Seventh Leaf (?embedded) may already be playing music of its own
  let hostPlaying = false;
  try {
    hostPlaying = new URLSearchParams(location.search).has('embedded') && !!window.parent?.museumMusicPlaying?.();
  } catch {}
  if (music.list.length && !hostPlaying) musicPlay(0);
  // first change right away, so the wall introduces itself
  if (deck.length > 1) next();
  else syncVideos(true);
}
$('#start').onclick = start;

// ── loop ────────────────────────────────────────────────────────────────────────────────
let last = now();
let videoTick = 0;
function frame() {
  const t = now();
  const dt = Math.min(0.1, t - last);
  last = t;
  seq.update(t);
  // once: preparing a change can take longer than a frame, and asking again every frame would
  // abandon each change before it could start (go() schedules the one after)
  if (t >= nextAt && sound) {
    nextAt = Infinity;
    next();
  }
  if ((videoTick += dt) > 0.5) {
    videoTick = 0;
    syncVideos(false);
    if (!seq.busy) evict();
  }
  wall.render(dt);
  requestAnimationFrame(frame);
}

// a folder remembered from an earlier visit is opened first, so the wall starts with it
await Promise.all(Object.values(folders).map((f) => f.load().catch((e) => console.warn(e))));
await Promise.all([loadLibrary(), loadMusic()]);
if (CAPTURE) {
  window.seventhLeafCapture = {
    // sets up offline sound for `seconds` of video
    begin(seconds) {
      $('#start')?.remove();
      sound = new Sound({ offline: seconds, clock: () => virtualTime });
      seq.sound = sound;
      for (const [bus, v] of Object.entries(settings.vol)) sound.setVolume(bus, v);
      sound.setVolume('master', 1);
    },
    async step(dt) {
      virtualTime += dt;
      seq.update(virtualTime);
      wall.render(dt);
    },
    // the flip sounds of the whole capture as 16-bit stereo WAV, base64
    async audio() {
      const buf = await sound.ctx.startRendering();
      const n = buf.length;
      const out = new DataView(new ArrayBuffer(44 + n * 4));
      const w = (o, str) => [...str].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF');
      out.setUint32(4, 36 + n * 4, true);
      w(8, 'WAVEfmt ');
      out.setUint32(16, 16, true);
      out.setUint16(20, 1, true);
      out.setUint16(22, 2, true);
      out.setUint32(24, buf.sampleRate, true);
      out.setUint32(28, buf.sampleRate * 4, true);
      out.setUint16(32, 4, true);
      out.setUint16(34, 16, true);
      w(36, 'data');
      out.setUint32(40, n * 4, true);
      const L = buf.getChannelData(0);
      const Rr = buf.getChannelData(1);
      for (let i = 0; i < n; i++) {
        out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
        out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, Rr[i])) * 32767, true);
      }
      const bytes = new Uint8Array(out.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(bin);
    },
    ensure: (list) => ensure(list),
    // a scripted change: keep the app's own idea of the current picture in step
    setCurrent(src) {
      const i = posOf.get(src.members ? src.members[0].item.id : src.id);
      if (i !== undefined) index = i;
      updateTitle();
    },
    get time() {
      return virtualTime;
    },
  };
}
updateTitle();
if (!CAPTURE) requestAnimationFrame(frame);
window.seventhLeaf = {
  wall,
  seq,
  lib,
  folders,
  music,
  get sound() { return sound; },
  get items() { return items; },
  get deck() { return deck; },
  get live() { return live; },
  get index() { return index; },
  grid,
  // what the wall can show, as sources (made on demand: for small decks and debugging)
  get sources() { return deck.map(srcOf); },
  loadLibrary,
  loadMusic,
  musicPlay,
  musicNext,
  evict,
  go,
  next,
  settings,
};
