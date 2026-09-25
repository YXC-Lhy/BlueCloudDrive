/**
 * 生成 img/background.png（主页装饰横幅）
 * 纯 Node 实现的最小 PNG 编码器，不依赖任何第三方库。
 *   node _test/make-background.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const W = 1600;
const H = 420;

const table = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// 简易云雾：几个柔和的白色圆斑
const blobs = [
  { x: 0.22, y: 0.68, r: 0.30, a: 0.55 },
  { x: 0.38, y: 0.55, r: 0.22, a: 0.45 },
  { x: 0.62, y: 0.72, r: 0.34, a: 0.35 },
  { x: 0.82, y: 0.42, r: 0.26, a: 0.28 },
];

const raw = Buffer.alloc(H * (W * 3 + 1));
let p = 0;
for (let y = 0; y < H; y++) {
  raw[p++] = 0; // filter: none
  const fy = y / H;
  for (let x = 0; x < W; x++) {
    const fx = x / W;
    // 对角渐变：#eaf3ff -> #cfe3fb
    const t = Math.min(1, Math.max(0, fx * 0.65 + fy * 0.35));
    let r = 234 + (207 - 234) * t;
    let g = 243 + (227 - 243) * t;
    let b = 255 + (251 - 255) * t;
    // 云雾
    for (const bl of blobs) {
      const dx = (fx - bl.x) / bl.r;
      const dy = (fy - bl.y) / (bl.r * 1.6);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1) {
        const k = Math.pow(1 - d, 2) * bl.a;
        r += (255 - r) * k;
        g += (255 - g) * k;
        b += (255 - b) * k;
      }
    }
    // 右上角淡淡的品牌色
    const gx = fx - 1.05;
    const gy = fy + 0.05;
    const gd = Math.sqrt(gx * gx + gy * gy);
    if (gd < 0.9) {
      const k = Math.pow(1 - gd / 0.9, 2) * 0.35;
      r += (64 - r) * k;
      g += (158 - g) * k;
      b += (255 - b) * k;
    }
    raw[p++] = Math.round(Math.min(255, Math.max(0, r)));
    raw[p++] = Math.round(Math.min(255, Math.max(0, g)));
    raw[p++] = Math.round(Math.min(255, Math.max(0, b)));
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type: truecolor
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.resolve(import.meta.dirname, '..', 'img', 'background.png');
fs.writeFileSync(out, png);
console.log(`已生成 ${out}（${W}x${H}，${(png.length / 1024).toFixed(1)} KB）`);
