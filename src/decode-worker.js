// Pictures for the wall, made off the main thread. A picture is decoded straight to the size it is
// shown at, with its blurred surround; a portrait set is drawn from its members, each decoded only
// as large as its panel needs. Bitmaps come back upside down, the way a WebGL texture wants them
// (WebGL does not flip bitmaps on upload), and are transferred, not copied.
//   { id, kind: 'picture', blob, size, max, bg: [w, h] } → { id, pic, w, h, bg }
//   { id, kind: 'set', parts: [{ blob, size, zoom, focus }], W, H } → { id, pic, sizes }
// size is [w, h] upright when known (the thumbnail worker measures it); without one the picture
// is decoded whole first. A failure answers { id, error, part }.

const fitTo = (w, h, k) => ({ resizeWidth: Math.max(1, Math.round(w * k)), resizeHeight: Math.max(1, Math.round(h * k)), resizeQuality: 'high' });

async function decodeAt(blob, size, scale, opts = {}) {
  if (size) return { bmp: await createImageBitmap(blob, { ...opts, ...fitTo(size[0], size[1], scale(size[0], size[1])) }), w: size[0], h: size[1] };
  const full = await createImageBitmap(blob, opts);
  const [w, h] = [full.width, full.height];
  const k = scale(w, h);
  if (k >= 1) return { bmp: full, w, h };
  const bmp = await createImageBitmap(full, fitTo(w, h, k));
  full.close();
  return { bmp, w, h };
}

const flipped = (c) => createImageBitmap(c, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });

async function picture({ blob, size, max, bg: [bw, bh] }) {
  const pic = await decodeAt(blob, size, (w, h) => Math.min(1, max / Math.max(w, h)), { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  try {
    const small = await decodeAt(blob, [pic.w, pic.h], (w, h) => Math.min(1, 512 / Math.max(w, h)));
    const c = new OffscreenCanvas(bw, bh);
    const g = c.getContext('2d');
    const a = pic.w / pic.h;
    const A = bw / bh;
    const dw = a > A ? bh * a : bw;
    const dh = a > A ? bh : bw / a;
    g.filter = 'blur(14px) saturate(1.1)';
    g.drawImage(small.bmp, (bw - dw) / 2, (bh - dh) / 2, dw, dh);
    small.bmp.close();
    g.filter = 'none';
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, 0, bw, bh);
    return { pic: pic.bmp, w: pic.w, h: pic.h, bg: await flipped(c) };
  } catch (e) {
    pic.bmp.close();
    throw e;
  }
}

async function set({ parts, W, H }) {
  const n = parts.length;
  const panels = parts.map((p, k) => {
    const x0 = Math.round((k * W) / n);
    return { ...p, x0, pw: Math.round(((k + 1) * W) / n) - x0 };
  });
  // each portrait covers its panel at its zoom
  const got = await Promise.allSettled(panels.map((p) => decodeAt(p.blob, p.size, (w, h) => Math.min(1, Math.max(p.pw / w, H / h) * (p.zoom || 1)))));
  const bad = got.findIndex((r) => r.status === 'rejected');
  if (bad >= 0) {
    for (const r of got) r.value?.bmp.close();
    throw Object.assign(got[bad].reason, { part: bad });
  }
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  panels.forEach(({ x0, pw, zoom = 1, focus }, k) => {
    const img = got[k].value.bmp;
    const iw = img.width;
    const ih = img.height;
    const pa = pw / H;
    const [fx, fy] = focus || [0.5, 0.7];
    let sw;
    let sh;
    if (iw / ih > pa) {
      sh = ih / zoom;
      sw = sh * pa;
    } else {
      sw = iw / zoom;
      sh = sw / pa;
    }
    g.drawImage(img, (iw - sw) * fx, (ih - sh) * (1 - fy), sw, sh, x0, 0, pw, H);
    img.close();
  });
  return { pic: await flipped(c), sizes: got.map((r) => [r.value.w, r.value.h]) };
}

onmessage = async ({ data }) => {
  try {
    const out = await (data.kind === 'set' ? set(data) : picture(data));
    postMessage({ id: data.id, ...out }, [out.pic, out.bg].filter(Boolean));
  } catch (e) {
    postMessage({ id: data.id, error: String(e), part: e?.part ?? -1 });
  }
};
