import { Wall, COLS, ROWS } from './wall.js';
import { Sequencer, PATTERNS, DEFAULTS } from './sequencer.js';
import { Sound, DUCK_MODES } from './audio.js';
import * as lib from './library.js';
import { t, setLang, onLang, LANGS } from './i18n.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#wall');
const wall = new Wall(canvas);
let sound = null;
const seq = new Sequencer(wall, null);

// ── settings ────────────────────────────────────────────────────────────────────────────
const SETTINGS = 'seventhleaf.settings';
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

// ── library → sources ───────────────────────────────────────────────────────────────────
let items = [];
let singles = []; // one source per library item, in library order
let sources = []; // what the wall shows: singles, or portrait sets when that option is on
const sets = new Map(); // portrait-set sources, by member ids
let index = 0; // the image the wall is showing / going to
let nextAt = Infinity;

async function loadLibrary() {
  items = await lib.listItems();
  const old = new Map(singles.map((s) => [s.id, s]));
  const fresh = [];
  for (const it of items) {
    let s = old.get(it.id);
    if (!s) {
      try {
        s = await lib.makeSource(it, wall.renderer);
      } catch (e) {
        console.warn(e);
        continue;
      }
    }
    s.item = it;
    lib.xformFor(it, s.aspect, s.xform);
    fresh.push(s);
    old.delete(it.id);
  }
  singles = fresh;
  rebuildDeck();
  for (const s of old.values()) lib.disposeSource(s);
  renderLibrary();
  updateTitle();
}

// The wall's deck. With the three-portrait layout on, portraits are taken three at a time in
// library order (two at a time when that is what is left) and shown side by side; a set stands
// where its first member is. Landscape images, videos and a lone last portrait stay as they are.
function rebuildDeck() {
  const current = sources[index];
  const keep = current?.members?.[0] || current;
  let deck = singles;
  if (settings.triptych) {
    const portraits = singles.filter(lib.isPortrait);
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
      const key = g.map((p) => p.id).join('+');
      let set = sets.get(key);
      if (!set) {
        set = lib.makeComposite(g, wall.renderer);
        sets.set(key, set);
      } else {
        set.members = g;
        set.item.name = g.map((p) => p.item.name).join(' · ');
      }
      lead.set(g[0], set);
      g.forEach((p) => inSet.add(p));
    }
    deck = [];
    for (const s of singles) {
      if (lead.has(s)) deck.push(lead.get(s));
      else if (!inSet.has(s)) deck.push(s);
    }
  }
  // forget sets no longer in use
  for (const [k, set] of sets) {
    if (!deck.includes(set)) {
      lib.releaseSource(set);
      sets.delete(k);
    }
  }
  sources = deck;
  seq.setSources(sources);
  index = Math.max(0, sources.findIndex((s) => s === keep || s.members?.includes(keep)));
  if (sources.length && !seq.state.some((c) => c.cur)) {
    const first = sources[index];
    lib.ensureSource(first, wall.renderer).then(() => {
      if (!seq.state.some((c) => c.cur)) seq.show(first);
    });
  }
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
let prefetched = null;

function wrap(i) {
  return ((i % sources.length) + sources.length) % sources.length;
}

function poolFor(target) {
  const n = Math.min(sources.length, POOL);
  const pool = [target];
  const add = (x) => x && !pool.includes(x) && pool.length < n && pool.push(x);
  for (const c of seq.state) add(c.cur);
  if (settings.order === 'deck') {
    for (let k = 1; k < sources.length && pool.length < n; k++) add(sources[wrap(sources.indexOf(target) + k)]);
  } else {
    const rest = sources.filter((x) => !pool.includes(x));
    // prefer pictures already loaded, then a random choice, so every change shows new fragments
    rest.sort((a, b) => (lib.isLoaded(b) - lib.isLoaded(a)) * 0.5 + (Math.random() - 0.5));
    rest.forEach(add);
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
  return keep;
}

function evict() {
  const keep = inUse();
  const all = [...singles, ...sets.values()];
  let loaded = all.filter(lib.isLoaded);
  if (loaded.length <= LOADED_MAX) return;
  for (const s of loaded.sort((a, b) => (a.used || 0) - (b.used || 0))) {
    if (loaded.length <= LOADED_MAX) break;
    if (keep.has(s) || s.el) continue;
    lib.releaseSource(s);
    loaded = loaded.filter((x) => x !== s);
  }
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
async function go(i, origin) {
  if (!sources.length) return;
  index = wrap(i);
  const target = sources[index];
  const token = ++goToken;
  updateTitle();
  const pool = poolFor(target);
  await ensure(pool);
  if (token !== goToken) return; // a newer change was asked for meanwhile
  seq.pool = pool;
  const end = seq.change(target, origin, now());
  scheduleNext(end);
  updateTitle();
  syncVideos(true);
  // the next picture loads in the background while this one shows
  prefetched = settings.shuffle ? null : sources[wrap(index + 1)];
  if (prefetched) ensure([prefetched]);
  evict();
}

function next(origin) {
  if (settings.shuffle && sources.length > 2) {
    let j;
    do j = (Math.random() * sources.length) | 0;
    while (j === index);
    go(j, origin);
  } else go(index + 1, origin);
}

function scheduleNext(end) {
  if (!settings.auto) {
    nextAt = Infinity;
    return;
  }
  let hold = settings.hold;
  const s = sources[index];
  if (s?.el && settings.waitVideo && Number.isFinite(s.el.duration)) hold = Math.max(hold, s.el.duration - 0.5);
  nextAt = end + hold;
}

function updateTitle() {
  const s = sources[index];
  $('#title').textContent = s ? s.item.name : t('lib.empty');
  $('#count').textContent = sources.length ? `${index + 1} / ${sources.length}` : '';
  $('#auto').textContent = settings.auto ? '❚❚' : '▶';
  $('#auto').title = settings.auto ? t('bar.pause') : t('bar.play');
  document.querySelectorAll('.thumb').forEach((t) => t.classList.toggle('on', contains(s, { id: t.dataset.id })));
}

// videos: play those visible on the wall; only the one being shown is heard
function syncVideos(restart) {
  const used = new Set();
  for (const c of seq.state) {
    if (c.cur) used.add(c.cur);
    if (c.flip) used.add(c.flip.to);
    for (const q of c.queue) used.add(q.src);
  }
  const target = sources[index];
  let audible = false;
  for (const s of sources) {
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
const music = { list: [], i: 0, el: new Audio(), url: null };
music.el.preload = 'auto';
music.el.addEventListener('ended', () => musicNext());

async function loadMusic() {
  music.list = await lib.listMusic();
  music.list = music.list.filter((m) => m.id !== '__flip__');
  renderMusic();
}

function musicPlay(i) {
  if (!music.list.length) return;
  music.i = ((i % music.list.length) + music.list.length) % music.list.length;
  if (music.url) URL.revokeObjectURL(music.url);
  music.url = URL.createObjectURL(music.list[music.i].blob);
  music.el.src = music.url;
  if (sound) sound.attach(music.el, 'music');
  music.el.play().catch(() => {});
  renderMusic();
}
function musicNext() {
  if (!music.list.length) return;
  musicPlay(settings.musicShuffle && music.list.length > 1 ? (music.i + 1 + ((Math.random() * (music.list.length - 1)) | 0)) % music.list.length : music.i + 1);
}
function musicToggle() {
  if (!music.el.src) return musicPlay(0);
  if (music.el.paused) music.el.play().catch(() => {});
  else music.el.pause();
}
music.el.addEventListener('play', renderMusic);
music.el.addEventListener('pause', renderMusic);

// ── UI: library ─────────────────────────────────────────────────────────────────────────
let selected = null;

function renderLibrary() {
  const grid = $('#grid');
  grid.innerHTML = '';
  for (const s of singles) {
    const card = document.createElement('div'); // not `t`: that name is the translator
    card.className = 'thumb' + (contains(sources[index], s.item) ? ' on' : '') + (s.item.id === selected ? ' sel' : '');
    card.dataset.id = s.id;
    card.draggable = true;
    card.innerHTML = `<img alt="" loading="lazy" decoding="async"><span class="kind">${s.kind === 'video' ? '▶' : ''}</span><button class="x" title="${t('lib.delete')}">×</button><span class="nm"></span>`;
    card.querySelector('img').src = s.thumb;
    card.querySelector('.nm').textContent = s.item.name;
    card.onclick = (e) => {
      if (e.target.classList.contains('x')) return;
      selected = s.item.id;
      go(sources.findIndex((x) => contains(x, s.item)));
      renderLibrary();
    };
    card.querySelector('.x').onclick = async () => {
      if (!confirm(t('lib.confirmDelete', { name: s.item.name }) + (s.item.local ? '\n' + t('lib.confirmLocal') : ''))) return;
      await lib.deleteItem(s.item);
      if (selected === s.item.id) selected = null;
      await loadLibrary();
    };
    // drag to reorder
    card.ondragstart = (e) => e.dataTransfer.setData('text/seventh-leaf', s.id);
    card.ondragover = (e) => e.dataTransfer.types.includes('text/seventh-leaf') && e.preventDefault();
    card.ondrop = (e) => {
      const id = e.dataTransfer.getData('text/seventh-leaf');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      const from = singles.findIndex((x) => x.id === id);
      const to = singles.indexOf(s);
      const [m] = singles.splice(from, 1);
      singles.splice(to, 0, m);
      lib.saveOrder(singles.map((x) => x.item));
      rebuildDeck();
      renderLibrary();
      updateTitle();
    };
    grid.append(card);
  }
  const h = lib.hiddenCount();
  $('#restore').hidden = !h;
  $('#restore').textContent = t('lib.restore', { n: h });
  renderEditor();
}

function renderEditor() {
  const ed = $('#editor');
  const s = singles.find((x) => x.item.id === selected);
  ed.hidden = !s;
  if (!s) return;
  const set = sources.find((x) => x.members?.includes(s));
  const it = s.item;
  $('#ed-name').textContent = it.name;
  $('#ed-fit').value = it.fit || 'auto';
  $('#ed-fx').value = it.focus?.[0] ?? 0.5;
  $('#ed-fy').value = it.focus?.[1] ?? 0.7;
  $('#ed-zoom').value = it.zoom || 1;
  const cover = !!set || lib.fitOf(it, s.aspect) === 'cover';
  $('#ed-cover').hidden = !cover;
  $('#ed-fit-row').hidden = !!set;
  $('#ed-set').hidden = !set;
  $('#ed-video').hidden = s.kind !== 'video';
  $('#ed-loop').checked = it.loop !== false;
  $('#ed-mute').checked = !!it.muted;
}

async function editSelected(patch) {
  const s = singles.find((x) => x.item.id === selected);
  if (!s) return;
  await lib.updateItem(s.item, patch);
  lib.xformFor(s.item, s.aspect, s.xform);
  for (const set of sources) {
    if (!set.members?.includes(s) || !lib.isLoaded(set)) continue;
    await ensure(set.members);
    lib.drawComposite(set);
  }
  if (s.el) s.el.loop = s.item.loop !== false;
  // re-apply to every cell showing it
  seq.setSources(sources);
  syncVideos(false);
  renderEditor();
}

$('#ed-fit').onchange = (e) => editSelected({ fit: e.target.value });
$('#ed-fx').oninput = (e) => editSelected({ focus: [+e.target.value, +$('#ed-fy').value] });
$('#ed-fy').oninput = (e) => editSelected({ focus: [+$('#ed-fx').value, +e.target.value] });
$('#ed-zoom').oninput = (e) => editSelected({ zoom: +e.target.value });
$('#ed-loop').onchange = (e) => editSelected({ loop: e.target.checked });
$('#ed-mute').onchange = (e) => editSelected({ muted: e.target.checked });
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
function renderMusic() {
  const ul = $('#music');
  ul.innerHTML = '';
  music.list.forEach((m, i) => {
    const li = document.createElement('li');
    li.className = i === music.i && music.el.src ? 'on' : '';
    li.innerHTML = '<span></span><button class="x" title="Delete">×</button>';
    li.querySelector('span').textContent = m.name;
    li.querySelector('span').onclick = () => musicPlay(i);
    li.querySelector('.x').onclick = async () => {
      if (!confirm(t('sound.confirmDelete', { name: m.name }))) return;
      if (i === music.i) {
        music.el.pause();
        music.el.removeAttribute('src');
      }
      await lib.deleteMusic(m);
      await loadMusic();
    };
    ul.append(li);
  });
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
  if (sources.length > 1) next();
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
  if (t >= nextAt && sound) next();
  if ((videoTick += dt) > 0.5) {
    videoTick = 0;
    syncVideos(false);
    if (!seq.busy) evict();
  }
  wall.render(dt);
  requestAnimationFrame(frame);
}

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
      const i = sources.indexOf(src);
      if (i >= 0) index = i;
      updateTitle();
    },
    get time() {
      return virtualTime;
    },
  };
}
updateTitle();
if (!CAPTURE) requestAnimationFrame(frame);
window.seventhLeaf = { wall, seq, lib, get sets() { return sets; }, get singles() { return singles; }, get sound() { return sound; }, get sources() { return sources; }, go, next, settings };
