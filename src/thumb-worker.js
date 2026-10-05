// Folder mode's thumbnails, made off the main thread: the picture is decoded straight to ~256 px
// (createImageBitmap with resizeWidth, so a large photo is never held at full size here) and saved
// as a small WebP. Its real size in pixels comes from the file's header where the format allows.
const WIDTH = 256;

onmessage = async ({ data: { id, file } }) => {
  if (typeof OffscreenCanvas === 'undefined') return postMessage({ id, fatal: true });
  try {
    const bmp = await createImageBitmap(file, { resizeWidth: WIDTH, resizeQuality: 'medium' });
    let size = headerSize(new Uint8Array(await file.slice(0, 1 << 18).arrayBuffer()));
    // the decoded picture is upright (EXIF orientation applied); a header gives the size as stored
    if (size && size[0] !== size[1] && size[0] > size[1] !== bmp.width > bmp.height) size = [size[1], size[0]];
    const [w, h] = size || [bmp.width, bmp.height];
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.75 });
    postMessage({ id, blob, w, h });
  } catch (e) {
    postMessage({ id, error: String(e) });
  }
};

// width and height as written in a JPEG, PNG, GIF, WebP or BMP header (null for anything else)
function headerSize(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const str = (o, n) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length < 30) return null;
  if (b[0] === 0x89 && str(1, 3) === 'PNG') return [dv.getUint32(16), dv.getUint32(20)];
  if (str(0, 3) === 'GIF') return [dv.getUint16(6, true), dv.getUint16(8, true)];
  if (str(0, 2) === 'BM') return [Math.abs(dv.getInt32(18, true)), Math.abs(dv.getInt32(22, true))];
  if (str(0, 4) === 'RIFF' && str(8, 4) === 'WEBP') {
    const chunk = str(12, 4);
    if (chunk === 'VP8 ') return [dv.getUint16(26, true) & 0x3fff, dv.getUint16(28, true) & 0x3fff];
    if (chunk === 'VP8L') {
      const v = dv.getUint32(21, true);
      return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1];
    }
    if (chunk === 'VP8X') return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    // walk the segments to the first frame header (SOF0–SOF15, except DHT/JPG/DAC)
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null;
      const m = b[o + 1];
      if (m === 0xff) {
        o++;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [dv.getUint16(o + 7), dv.getUint16(o + 5)];
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) o += 2;
      else o += 2 + dv.getUint16(o + 2);
    }
  }
  return null;
}
