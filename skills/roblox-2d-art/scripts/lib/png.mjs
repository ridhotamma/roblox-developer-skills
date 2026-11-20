// PNG encode / decode with Node's zlib only. Images are { w, h, rgba: Uint8Array } (straight alpha).
import zlib from 'node:zlib';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}

// Encodes RGBA (or RGB when every pixel is opaque and opts.dropAlpha) with per-row filter choice (smaller files).
export function encode(img, opts = {}) {
  const { w, h, rgba } = img;
  let opaque = true; for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
  const ch = opaque && opts.dropAlpha !== false ? 3 : 4, stride = w * ch, raw = Buffer.alloc((stride + 1) * h);
  const line = Buffer.alloc(stride), prev = Buffer.alloc(stride), cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) line[x * ch + c] = rgba[(y * w + x) * 4 + c];
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f]; let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? line[i - ch] : 0, b = y ? prev[i] : 0, c = i >= ch && y ? prev[i - ch] : 0; let p = 0;
        if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
        else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const v = (line[i] - p) & 255; out[i] = v; score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; best = f; }
    }
    raw[y * (stride + 1)] = best; cand[best].copy(raw, y * (stride + 1) + 1); line.copy(prev);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function decode(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG file');
  let o = 8, w, h, depth, type, interlace, pal = null, trns = null; const idat = [];
  while (o < buf.length) {
    const L = buf.readUInt32BE(o), t = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + L); o += 12 + L;
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; interlace = d[12]; }
    else if (t === 'PLTE') pal = d; else if (t === 'tRNS') trns = d; else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break;
  }
  if (interlace) throw new Error('interlaced PNG');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type], bitsPP = ch * depth, bpp = Math.max(1, bitsPP >> 3), stride = Math.ceil(w * bitsPP / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = px.subarray(y * stride, (y + 1) * stride), prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = prev ? prev[x] : 0, c = prev && x >= bpp ? prev[x - bpp] : 0; let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[x] = v & 255;
    }
  }
  const out = new Uint8Array(w * h * 4);
  const sample = (y, i) => {
    if (depth === 8) return px[y * stride + i]; if (depth === 16) return px[y * stride + i * 2];
    const bit = i * depth, byte = px[y * stride + (bit >> 3)], v = (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return type === 3 ? v : Math.round(v * 255 / ((1 << depth) - 1));
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = (y * w + x) * 4; let r, g, b, al = 255;
    if (type === 3) { const k = sample(y, x); r = pal[k * 3]; g = pal[k * 3 + 1]; b = pal[k * 3 + 2]; if (trns && k < trns.length) al = trns[k]; }
    else if (type === 0) r = g = b = sample(y, x);
    else if (type === 4) { r = g = b = sample(y, x * 2); al = sample(y, x * 2 + 1); }
    else if (type === 2) { r = sample(y, x * 3); g = sample(y, x * 3 + 1); b = sample(y, x * 3 + 2); }
    else { r = sample(y, x * 4); g = sample(y, x * 4 + 1); b = sample(y, x * 4 + 2); al = sample(y, x * 4 + 3); }
    out[q] = r; out[q + 1] = g; out[q + 2] = b; out[q + 3] = al;
  }
  return { w, h, rgba: out };
}
