'use strict';
// Generates assets/icon.png (256px) and assets/icon.ico — a simple clock face.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 256;
const SS = 3; // supersampling per axis

function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function inRoundRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), N - r), cy = Math.min(Math.max(y, r), N - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

function sample(x, y) {
  if (!inRoundRect(x, y, 56)) return [0, 0, 0, 0];
  const t = y / N;
  let c = [47 + 20 * t, 111 - 25 * t, 237 - 20 * t]; // blue gradient background
  const d = Math.hypot(x - 128, y - 132);
  const ring = d <= 82 && d >= 66;
  const hands = segDist(x, y, 128, 132, 128, 82) <= 6 || segDist(x, y, 128, 132, 164, 150) <= 6;
  const nub = x >= 112 && x <= 144 && y >= 32 && y <= 46;
  if (ring || hands || nub) c = [255, 255, 255];
  return [c[0], c[1], c[2], 255];
}

const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const [pr, pg, pb, pa] = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
      r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
    }
    const o = y * (N * 4 + 1) + 1 + x * 4;
    raw[o] = a ? Math.round(r / a) : 0;
    raw[o + 1] = a ? Math.round(g / a) : 0;
    raw[o + 2] = a ? Math.round(b / a) : 0;
    raw[o + 3] = Math.round(a / (SS * SS));
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);

const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 0; ico[7] = 0; // 0 = 256px
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), png);
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([ico, png]));
console.log('icon written');
