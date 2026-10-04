// Sound: one Web Audio graph, three buses (flips, music, video) into a master limiter.
//
//   flip voices ─► flips bus ─┬────────────────┐
//                             └► room reverb ──┤
//   music <audio> ─► duck ─► music bus ───────┼─► master ─► limiter ─► speakers
//   video <video> ─► video bus ───────────────┘
//
// The flip sound is synthesised (no samples, no licences), modelled on a recording of the real
// wall: every flip is a dry ~0.13 s rustle — the leaf's edge riffling over the stack, a grainy
// "shhh" strongest around 1.3–2 kHz and 6–8 kHz, speeding up as the leaf falls — with small
// mechanical clicks: the latch letting go, the leaf landing, a little rebound. No ringing body.
import { COLS } from './wall.js';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// RBJ biquad, run over a whole array
function biquad(x, type, f, Q, sr) {
  const w = (2 * Math.PI * f) / sr;
  const cs = Math.cos(w);
  const al = Math.sin(w) / (2 * Q);
  let b0;
  let b1;
  let b2;
  if (type === 'bp') [b0, b1, b2] = [al, 0, -al];
  else if (type === 'hp') [b0, b1, b2] = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2];
  else [b0, b1, b2] = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2];
  const a0 = 1 + al;
  const a1 = -2 * cs;
  const a2 = 1 - al;
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

// one leaf: rustle while it falls, clicks at release and landing
function leafBuffer(ctx, seed) {
  const r = rng(seed * 7919 + 13);
  const sr = ctx.sampleRate;
  const fall = 0.12 + r() * 0.035;
  const len = Math.floor(sr * (fall + 0.05));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);

  // the riffle: noise chopped by a train of tiny grains that speeds up as the leaf falls
  const raw = new Float32Array(len);
  let next = 0;
  let gAmp = 0;
  let gT = -1;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    if (t >= next && t < fall) {
      const rate = 260 + 700 * Math.min(1, t / fall) ** 1.3;
      next = t + (0.5 + r()) / rate;
      gT = t;
      gAmp = 0.3 + r() * 0.7;
    }
    const grain = gT >= 0 ? gAmp * Math.exp(-(t - gT) / 0.0006) : 0;
    raw[i] = (r() * 2 - 1) * (0.35 + 1.1 * grain);
  }
  const lo = biquad(raw, 'bp', 1500 + r() * 350, 1.7, sr);
  const hi = biquad(raw, 'bp', 6700 + r() * 900, 1.9, sr);
  const air = biquad(raw, 'hp', 1100, 0.7, sr);
  let rustle = new Float32Array(len);
  for (let i = 0; i < len; i++) rustle[i] = lo[i] * 1.55 + hi[i] * 1.45 + air[i] * 0.18;
  rustle = biquad(rustle, 'lp', 9500, 0.7, sr);

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = t < fall ? (0.38 + 0.62 * (t / fall) ** 1.4) * (1 - Math.exp(-t / 0.004)) : Math.exp(-(t - fall) / 0.006);
    d[i] = rustle[i] * env;
  }

  // Contacts. In the recording they are dry, broadband ticks — a few dB above the rustle evenly
  // from 1 to 14 kHz, with no pitch — so they are made of noise, not ringing tones.
  const imp = new Float32Array(len);
  const impact = (t0, amp, tau) => {
    const i0 = Math.floor(t0 * sr);
    for (let i = i0; i < len; i++) {
      const t = (i - i0) / sr;
      if (t > tau * 7) break;
      imp[i] += amp * (r() * 2 - 1) * Math.min(1, t / 0.0003) * Math.exp(-t / tau);
    }
  };
  impact(0.002, 0.07, 0.001); // latch letting go
  impact(fall, 0.3, 0.0028); // landing: the edge meets the stack over a couple of milliseconds
  impact(fall + 0.0015, 0.12, 0.004);
  impact(fall + 0.011 + r() * 0.012, 0.1, 0.002); // rebound
  const ticks = biquad(biquad(imp, 'hp', 900, 0.7, sr), 'lp', 11000, 0.7, sr);
  for (let i = 0; i < len; i++) d[i] += ticks[i];

  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < len; i++) d[i] *= 0.8 / peak;
  buf.fall = fall;
  return buf;
}

// A gallery room: short pre-delay, a few early reflections, then a diffuse tail (~1.1 s) whose
// highs die away first.
function roomImpulse(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 1.6);
  const buf = ctx.createBuffer(2, len, sr);
  const r = rng(99);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = Math.floor(sr * 0.012); i < len; i++) {
      const t = i / sr;
      const k = 0.15 + 0.8 * Math.exp(-t / 0.18); // darker as it decays
      lp += k * (r() * 2 - 1 - lp);
      d[i] = lp * Math.exp((-6.9 * t) / 1.1);
    }
    for (const [t, a] of [[0.017, 0.5], [0.023, 0.35], [0.031, 0.3], [0.044, 0.22], [0.058, 0.16]]) {
      d[Math.floor(sr * (t + ch * 0.0017))] += a * (r() < 0.5 ? -1 : 1);
    }
  }
  return buf;
}

export const DUCK_MODES = {
  duck: 'Duck music under video sound',
  mix: 'Mix everything',
  exclusive: 'Pause music during video sound',
};

export class Sound {
  // opts.offline = seconds: render into an OfflineAudioContext (for making videos), with
  // opts.clock() giving the current time on the video's timeline
  constructor(opts = {}) {
    this.offline = !!opts.offline;
    this.ctx = opts.offline ? new OfflineAudioContext(2, Math.ceil(48000 * opts.offline), 48000) : new AudioContext({ latencyHint: 'interactive' });
    this.clock = opts.clock || null;
    const ctx = this.ctx;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 4;
    this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.master = ctx.createGain();
    this.master.connect(this.limiter).connect(ctx.destination);
    this.bus = {};
    for (const name of ['flips', 'music', 'video']) {
      this.bus[name] = ctx.createGain();
      this.bus[name].connect(this.master);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = roomImpulse(ctx);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35 * 0.35 * 4;
    this.bus.flips.connect(this.reverbSend).connect(this.reverb).connect(this.master);
    this.settles = [];
    this.duckNode = ctx.createGain();
    this.duckNode.connect(this.bus.music);
    this.duckMode = 'duck';
    this.leaves = Array.from({ length: 24 }, (_, i) => leafBuffer(ctx, i + 1));
    this.custom = null; // optional user flip sample
    this.pending = [];
  }

  resume() {
    return this.offline ? Promise.resolve() : this.ctx.resume();
  }

  get live() {
    return this.offline || this.ctx.state === 'running';
  }

  get time() {
    return this.clock ? this.clock() : this.ctx.currentTime;
  }

  // 0..1 slider → gain (perceptual curve)
  setVolume(bus, v) {
    const g = v * v;
    if (bus === 'room') return this.reverbSend.gain.setTargetAtTime(g * 4, this.time, 0.05);
    const node = bus === 'master' ? this.master : this.bus[bus];
    node.gain.setTargetAtTime(g, this.time, 0.03);
  }

  // a leaf starts to fall; sounds are gathered and played once per frame
  // `land`: seconds from now until the leaf hits the stack. The rustle is placed so that its
  // final slap coincides with the landing.
  leaf(c, land = 0.2) {
    this.pending.push([c, land]);
  }

  // Leaves that fall together (the wall runs on one clock) are played as a few voices, each
  // standing for a group of neighbouring leaves: louder by √n, as n uncorrelated sounds are, and
  // spread a few milliseconds apart as real leaves never drop at exactly the same instant.
  // a settling leaf knocks its stop again: [delay s, strength 0..1] per knock
  settle(c, knocks) {
    this.settles.push([c, knocks]);
  }

  flush() {
    if (this.settles.length) this.#flushSettles();
    const p = this.pending;
    if (!p.length) return;
    this.pending = [];
    if (!this.live) return;
    p.sort((a, b) => a[0] - b[0]);
    const k = Math.min(p.length, 6);
    for (let v = 0; v < k; v++) {
      const group = p.slice(Math.floor((v * p.length) / k), Math.floor(((v + 1) * p.length) / k));
      const col = group.reduce((s, g) => s + g[0], 0) / group.length;
      const land = group.reduce((s, g) => s + g[1], 0) / group.length;
      this.#voice(col, 0.38 * Math.sqrt(group.length), land, Math.random() * (p.length > 3 ? 0.022 : 0.005));
    }
  }

  #flushSettles() {
    const list = this.settles;
    this.settles = [];
    if (!this.live) return;
    // at most 4 voices a frame; each plays the landing click of a leaf sample, softly
    list.sort((a, b) => a[0] - b[0]);
    const k = Math.min(list.length, 4);
    for (let v = 0; v < k; v++) {
      const group = list.slice(Math.floor((v * list.length) / k), Math.floor(((v + 1) * list.length) / k));
      const col = group.reduce((s, g) => s + g[0], 0) / group.length;
      const ref = group[(Math.random() * group.length) | 0][1];
      for (const [t, a] of ref) this.#knock(col, 0.55 * a * Math.sqrt(group.length), t + Math.random() * 0.03);
    }
  }

  #knock(col, gain, delay) {
    if (this.custom) return;
    const ctx = this.ctx;
    const buf = this.leaves[(Math.random() * this.leaves.length) | 0];
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = 1.05 + Math.random() * 0.15;
    const g = ctx.createGain();
    g.gain.value = gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = ((col / (COLS - 1)) * 2 - 1) * 0.8;
    s.connect(g).connect(pan).connect(this.bus.flips);
    this.voices = (this.voices || 0) + 1;
    s.onended = () => {
      s.disconnect();
      pan.disconnect();
    };
    // just the landing click and rebound, not the rustle
    s.start(this.time + delay, Math.max(0, buf.fall - 0.003), 0.04);
  }

  #voice(col, gain, land, jitter) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.custom || this.leaves[(Math.random() * this.leaves.length) | 0];
    const rate = 0.94 + Math.random() * 0.12;
    s.playbackRate.value = rate;
    // a custom sample has no known landing point: it starts with the fall
    const delay = Math.max(0, land - (s.buffer.fall ? s.buffer.fall / rate : land)) + jitter;
    const g = ctx.createGain();
    g.gain.value = gain * (0.8 + Math.random() * 0.4);
    const pan = ctx.createStereoPanner();
    pan.pan.value = ((col / (COLS - 1)) * 2 - 1) * 0.8;
    s.connect(g).connect(pan).connect(this.bus.flips);
    s.onended = () => {
      s.disconnect();
      pan.disconnect();
    };
    s.start(this.time + delay);
  }

  async setCustomFlip(blob) {
    this.custom = blob ? await this.ctx.decodeAudioData(await blob.arrayBuffer()) : null;
  }

  // a media element routed into a bus (each element can be wired only once)
  attach(el, bus) {
    if (el._fwNode) return el._fwNode;
    const n = this.ctx.createMediaElementSource(el);
    n.connect(bus === 'music' ? this.duckNode : this.bus.video);
    el._fwNode = n;
    return n;
  }

  // called whenever a video with sound starts or stops being heard
  videoAudible(on, music) {
    const t = this.ctx.currentTime;
    const g = this.duckNode.gain;
    if (this.duckMode === 'duck') g.setTargetAtTime(on ? 0.25 : 1, t, on ? 0.15 : 0.6);
    else g.setTargetAtTime(1, t, 0.2);
    if (this.duckMode === 'exclusive' && music) {
      if (on && !music.paused) {
        music.pause();
        this._pausedForVideo = true;
      } else if (!on && this._pausedForVideo) {
        music.play().catch(() => {});
        this._pausedForVideo = false;
      }
    }
  }
}
