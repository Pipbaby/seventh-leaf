// Timing: every cell runs its own little queue of leaves. A change of image gives each cell
// `flips` leaves (fragments of other images, the last one the target), started after a delay
// that depends on the cell's place in the wave.
import { COLS, ROWS, Wall } from './wall.js';

export const PATTERNS = {
  'diagonal-filmed': 'Diagonal ↙ from top right (as filmed)',
  'sweep-left': 'Sweep ←',
  'sweep-right': 'Sweep →',
  'top-down': 'Top to bottom',
  diagonal: 'Diagonal',
  radial: 'Ripple from a point',
  random: 'Rain (random)',
  together: 'All at once',
};

export const DEFAULTS = {
  flips: 7, // the exhibition wall: every cell flips seven times per change
  interval: 0.37, // seconds between a cell's flips (measured from the video)
  fall: 0.26, // creep + hesitation + fall, as measured (the leaf curves above set the exact shape)
  span: 2.8, // seconds for the wave to cross the wall (measured: ~0.16 s per column and per row)
  jitter: 0.14, // the real wall is a little uneven: cells start up to a tick early or late
  clock: true, // like the real wall: all leaves drop on one shared clock (half the flip interval)
  pattern: 'diagonal-filmed',
  order: 'random', // which artwork the in-between leaves show: random | deck
};

function delayFor(pattern, c, r, o) {
  const fc = c / (COLS - 1);
  const fr = r / (ROWS - 1);
  switch (pattern) {
    case 'diagonal-filmed':
      // measured from the recording: start ≈ 0.16 s × (columns from the right + rows from the top)
      return (COLS - 1 - c + r) / (COLS + ROWS - 2);
    case 'sweep-left':
      return (1 - fc) * 0.85 + fr * 0.15; // right to left, upper rows a touch earlier
    case 'sweep-right':
      return fc * 0.85 + fr * 0.15;
    case 'top-down':
      return fr * 0.85 + Math.abs(fc - 0.5) * 0.3;
    case 'diagonal':
      return (c + r) / (COLS + ROWS - 2);
    case 'radial': {
      const ox = o?.c ?? (COLS - 1) / 2;
      const oy = o?.r ?? (ROWS - 1) / 2;
      const max = Math.hypot(Math.max(ox, COLS - 1 - ox), Math.max(oy, ROWS - 1 - oy));
      return Math.hypot(c - ox, (r - oy) * 1.0) / max;
    }
    case 'random':
      return Math.random();
    default:
      return 0;
  }
}

// ── how a leaf moves (measured frame by frame from the 60 fps recording) ─────────────────
// 1. The drive turns the leaf's hinge while its top edge is still caught behind the two stops:
//    the leaf creeps forward a few degrees (~40 ms)…
// 2. …hesitates for about a frame while it is held…
// 3. …slips off the stops with some speed and falls. From there it is a pendulum: a plate
//    ~15 cm tall swinging about its top edge under gravity (θ'' = 3g/2L · sin θ). Air drag is
//    tiny — fitting the recording gives none worth speaking of — so the leaf keeps speeding up
//    until it slaps the leaves below (~0.21 s after release).
// 4. The landed leaf then hangs and swings as a pendulum, ~1.6 Hz, dying away over seconds.
const LEAF_K = (3 * 9.81) / (2 * 0.148); // gravity term for a 14.8 cm leaf
const DRAG = 0.004;
export const SWING_HZ = Math.sqrt(LEAF_K / 2) / Math.PI / 2; // small-swing frequency hanging down: √(3g/2L)/2π ≈ 1.6 Hz

function leafCurve(seed) {
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 233280 + 49297) % 233280) / 233280);
  const creep = 0.032 + r() * 0.016; // s
  const hold = 0.01 + r() * 0.016;
  const lean = 0.07 + r() * 0.03; // rad
  const w0 = 7 + r() * 2; // rad/s at release
  const dt = 0.001;
  const th = [];
  const nC = Math.round(creep / dt);
  for (let i = 0; i < nC; i++) {
    const q = i / nC;
    th.push(lean * q * q * (3 - 2 * q));
  }
  const nH = Math.round(hold / dt);
  for (let i = 0; i < nH; i++) th.push(lean * (1 - 0.18 * Math.sin((Math.PI * i) / nH))); // held, sagging back a hair
  const release = th.length * dt;
  let a = lean;
  let w = w0;
  while (a < Math.PI) {
    for (let k = 0; k < 10; k++) {
      const acc = LEAF_K * Math.sin(a) - DRAG * w * Math.abs(w);
      w += acc * dt * 0.1;
      a += w * dt * 0.1;
    }
    th.push(Math.min(a, Math.PI));
  }
  return { th: Float32Array.from(th), release, land: th.length * dt, speed: w };
}
const CURVES = Array.from({ length: 16 }, (_, i) => leafCurve(i + 1));

export class Sequencer {
  constructor(wall, sound) {
    this.wall = wall;
    this.sound = sound;
    this.opts = { ...DEFAULTS };
    this.sources = []; // deck order
    this.state = wall.cells.map(() => ({ cur: null, queue: [], flip: null }));
    this.busyUntil = 0;
    this.lastChange = { from: null, to: null, t0: 0, t1: 0 };
  }

  get busy() {
    return this.state.some((s) => s.flip || s.queue.length);
  }

  setSources(list) {
    this.sources = list;
    const ok = new Set(list); // a large library has thousands
    // cells pointing at a removed source fall back to the first one
    for (let i = 0; i < this.state.length; i++) {
      const s = this.state[i];
      if (s.cur && !ok.has(s.cur)) s.cur = list[0] || null;
      s.queue = s.queue.filter((q) => ok.has(q.src));
      if (s.flip && (!ok.has(s.flip.from) || !ok.has(s.flip.to))) s.flip = null;
      if (!s.flip) this.#rest(i);
    }
  }

  // show a source at once, without flipping
  show(src) {
    this.state.forEach((s, i) => {
      s.cur = src;
      s.queue = [];
      s.flip = null;
      this.#rest(i);
    });
    this.lastChange = { from: src, to: src, t0: 0, t1: 0 };
  }

  #between(cur, target, n) {
    // the in-between artwork comes from the pool whose pixels are loaded (all sources if small)
    const list = this.pool?.length ? this.pool : this.sources;
    const seq = [];
    if (this.opts.order === 'deck') {
      let i = list.indexOf(cur);
      for (let k = 0; k < n - 1; k++) {
        i = (i + 1) % list.length;
        if (list[i] === target && list.length > 2) i = (i + 1) % list.length;
        seq.push(list[i]);
      }
    } else {
      let prev = cur;
      for (let k = 0; k < n - 1; k++) {
        const last = k === n - 2;
        const pool = list.filter((s) => s !== prev && !(last && s === target));
        const pick = pool.length ? pool[(Math.random() * pool.length) | 0] : prev;
        seq.push(pick);
        prev = pick;
      }
    }
    seq.push(target);
    return seq;
  }

  // change the whole wall to `target`
  change(target, origin, now) {
    const o = this.opts;
    let end = now;
    this.state.forEach((s, i) => {
      const cell = this.wall.cells[i];
      // a cell still flipping keeps going and continues from its last queued leaf
      const from = s.queue.length ? s.queue[s.queue.length - 1].src : s.flip ? s.flip.to : s.cur;
      let start = Math.max(
        now + delayFor(o.pattern, cell.c, cell.r, origin) * o.span + Math.random() * o.jitter,
        s.queue.length ? s.queue[s.queue.length - 1].at + o.interval : 0,
      );
      // on the clock, every leaf drops on a tick; otherwise each cell keeps its own loose rhythm
      const tick = o.interval / 2;
      if (o.clock) start = Math.ceil(start / tick) * tick;
      const seq = this.#between(from, target, Math.max(1, o.flips | 0));
      seq.forEach((src, k) => {
        const at = start + k * o.interval * (o.clock ? 1 : 0.94 + Math.random() * 0.12);
        s.queue.push({ src, at });
        end = Math.max(end, at + o.fall);
      });
    });
    this.lastChange = { from: this.lastChange.to, to: target, t0: now, t1: end };
    return end;
  }

  // one cell flips once (a click on the wall)
  poke(c, r, now) {
    const i = r * COLS + c;
    const s = this.state[i];
    if (s.queue.length || s.flip || this.sources.length < 2) return;
    const pool = (this.pool?.length ? this.pool : this.sources).filter((x) => x !== s.cur);
    const first = pool[(Math.random() * pool.length) | 0];
    s.queue.push({ src: first, at: now }, { src: s.cur, at: now + this.opts.interval * 1.4 });
  }

  #rest(i) {
    const s = this.state[i];
    const cell = this.wall.cells[i];
    Wall.assign(cell.top.material, s.cur);
    Wall.assign(cell.bot.material, s.cur);
    cell.top.material.uniforms.shade.value = 0;
    cell.bot.material.uniforms.shade.value = 0;
    cell.pivot.visible = false;
  }

  // A landed leaf hangs from its axle and swings as a pendulum (measured: ~1.6 Hz, still moving
  // 2 s later). It is kicked forward when it slaps the stack; swinging back it presses against
  // the leaves behind, which push back harder and knock softly. Each cell's leaf is a little
  // different. The upper leaf barely moves.
  #settle(i, now, last) {
    const s = this.state[i];
    const kick = (last ? 0.75 : 0.45) * (0.7 + Math.random() * 0.6);
    const f = SWING_HZ * (0.92 + Math.random() * 0.16);
    const w = s.wobble;
    s.wobble = {
      t: now,
      phi: w ? w.phi : 0,
      vel: (w ? w.vel : 0) - kick, // negative = the leaf's lower edge swings out towards you
      w2: (2 * Math.PI * f) ** 2,
      lin: 0.35 + Math.random() * 0.3, // still and slow damping…
      quad: 1.2, // …plus air drag, which takes the big swings down faster
      top: 0.12 + Math.random() * 0.1,
    };
  }

  #wobble(i, now) {
    const s = this.state[i];
    const w = s.wobble;
    const cell = this.wall.cells[i];
    let dt = Math.min(0.05, now - w.t);
    w.t = now;
    while (dt > 0) {
      const h = Math.min(dt, 0.004);
      dt -= h;
      let acc = -w.w2 * w.phi - w.lin * w.vel - w.quad * w.vel * Math.abs(w.vel);
      if (w.phi > 0) acc -= 3 * w.w2 * w.phi; // the stack behind is stiffer than open air
      const before = w.phi;
      w.vel += acc * h;
      w.phi += w.vel * h;
      if (before <= 0 && w.phi > 0 && w.vel > 0.35 && this.sound) this.sound.settle(cell.c, [[0, Math.min(1, w.vel / 1.2)]]);
    }
    cell.bot.rotation.x = cell.botRest + w.phi;
    cell.top.rotation.x = cell.topRest + w.phi * w.top;
    if (Math.abs(w.phi) < 0.0015 && Math.abs(w.vel) < 0.01) {
      cell.top.rotation.x = cell.topRest;
      cell.bot.rotation.x = cell.botRest;
      s.wobble = null;
    }
  }

  update(now) {
    const o = this.opts;
    for (let i = 0; i < this.state.length; i++) {
      const s = this.state[i];
      const cell = this.wall.cells[i];
      if (s.wobble) this.#wobble(i, now);
      // after a stall (hidden tab), skip leaves that are long overdue instead of replaying them
      while (!s.flip && s.queue.length > 1 && now > s.queue[1].at + 0.5) s.cur = s.queue.shift().src;
      if (!s.flip && s.queue.length && now >= s.queue[0].at) {
        const { src } = s.queue.shift();
        const curve = CURVES[(Math.random() * CURVES.length) | 0];
        // a faster rhythm squeezes the motion so a leaf always lands before the next one goes
        const scale = Math.min(1, (o.interval * 0.92) / curve.land);
        s.flip = { from: s.cur, to: src, t0: now, curve, scale, dur: curve.land * scale };
        Wall.assign(cell.top.material, src);
        Wall.assign(cell.bot.material, s.cur);
        Wall.assign(cell.front.material, s.cur);
        Wall.assign(cell.back.material, src);
        cell.pivot.visible = true;
        this.sound?.leaf(cell.c, s.flip.dur);
      }
      if (!s.flip) continue;
      const p = (now - s.flip.t0) / s.flip.dur;
      if (p >= 1) {
        s.cur = s.flip.to;
        s.flip = null;
        this.#rest(i);
        this.#settle(i, now, !s.queue.length);
        continue;
      }
      const th = s.flip.curve.th;
      const a = th[Math.min(th.length - 1, Math.floor((p * s.flip.dur) / s.flip.scale / 0.001))];
      cell.pivot.rotation.x = a;
      // the leaf darkens the half it is passing over
      cell.top.material.uniforms.shade.value = a < Math.PI / 2 ? 0.35 * (1 - a / (Math.PI / 2)) : 0;
      cell.bot.material.uniforms.shade.value = 0.5 * Math.max(0, Math.sin(a)) * (a > Math.PI / 2 ? 1 : a / (Math.PI / 2));
    }
    this.sound?.flush();
    // projection mode: the projector cuts to the new image while the wave passes
    const L = this.lastChange;
    const mix = L.t1 > L.t0 ? Math.min(1, Math.max(0, (now - L.t0) / (L.t1 - L.t0))) : 1;
    const eased = Math.min(1, Math.max(0, (mix - 0.35) / 0.3));
    this.wall.setProjection(L.from || L.to, L.to, eased);
  }
}
