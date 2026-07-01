// Generates tileable placeholder terrain textures (diffuse/normal_dx/roughness/ao)
// with a hand-rolled PNG encoder (no image libs available). Clearly-labeled
// placeholders — the user replaces these with real packs later.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = process.argv[2];
const SIZE = 128;

// --- minimal RGBA PNG encoder -------------------------------------------------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- tileable value noise (integer lattice wraps at PERIOD) -------------------
function hash(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1442695040;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const smooth = (t) => t * t * (3 - 2 * t);
function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const wrap = (v) => ((v % period) + period) % period;
  const x0 = wrap(xi), x1 = wrap(xi + 1), y0 = wrap(yi), y1 = wrap(yi + 1);
  const v00 = hash(x0, y0, seed), v10 = hash(x1, y0, seed);
  const v01 = hash(x0, y1, seed), v11 = hash(x1, y1, seed);
  const sx = smooth(xf), sy = smooth(yf);
  return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
}
function fbm(x, y, baseFreq, seed) {
  let sum = 0, amp = 0.5, freq = baseFreq, norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise((x / SIZE) * freq, (y / SIZE) * freq, freq, seed + o * 17);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Per-material look: base rgb, color variation amount, roughness center, bumpiness
const MATERIALS = {
  grass:    { rgb: [0.28, 0.42, 0.16], vary: 0.30, rough: 0.85, bump: 0.6, freq: 10 },
  rock:     { rgb: [0.48, 0.46, 0.43], vary: 0.35, rough: 0.72, bump: 1.0, freq: 7 },
  sand:     { rgb: [0.78, 0.68, 0.47], vary: 0.18, rough: 0.90, bump: 0.35, freq: 14 },
  snow:     { rgb: [0.90, 0.93, 0.97], vary: 0.10, rough: 0.35, bump: 0.3, freq: 9 },
  mud:      { rgb: [0.34, 0.26, 0.18], vary: 0.28, rough: 0.60, bump: 0.7, freq: 8 },
  volcanic: { rgb: [0.16, 0.13, 0.13], vary: 0.40, rough: 0.55, bump: 1.1, freq: 8 },
  alien:    { rgb: [0.34, 0.20, 0.44], vary: 0.35, rough: 0.50, bump: 0.9, freq: 10 },
};

function genDiffuse(m) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const n = fbm(x, y, m.freq, 1);
    const n2 = fbm(x, y, m.freq * 2.3, 5);
    const shade = 1 + (n - 0.5) * 2 * m.vary + (n2 - 0.5) * m.vary * 0.5;
    const i = (y * SIZE + x) * 4;
    buf[i] = clamp01(m.rgb[0] * shade) * 255;
    buf[i + 1] = clamp01(m.rgb[1] * shade) * 255;
    buf[i + 2] = clamp01(m.rgb[2] * shade) * 255;
    buf[i + 3] = 255;
  }
  return buf;
}
function genNormalDX(m) {
  // Derive a tangent-space DirectX normal from a bump height field's gradient.
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const heightAt = (x, y) => fbm(x, y, m.freq, 3) * m.bump;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const hL = heightAt((x - 1 + SIZE) % SIZE, y);
    const hR = heightAt((x + 1) % SIZE, y);
    const hD = heightAt(x, (y - 1 + SIZE) % SIZE);
    const hU = heightAt(x, (y + 1) % SIZE);
    const dx = (hL - hR) * 2.0;
    const dy = (hD - hU) * 2.0; // DirectX: +Y down -> green flipped vs OpenGL
    const len = Math.hypot(dx, dy, 1);
    const i = (y * SIZE + x) * 4;
    buf[i] = ((dx / len) * 0.5 + 0.5) * 255;
    buf[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
    buf[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
    buf[i + 3] = 255;
  }
  return buf;
}
function genRoughness(m) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const n = fbm(x, y, m.freq * 1.5, 7);
    const r = clamp01(m.rough + (n - 0.5) * 0.3);
    const i = (y * SIZE + x) * 4;
    buf[i] = buf[i + 1] = buf[i + 2] = r * 255; buf[i + 3] = 255;
  }
  return buf;
}
function genAO(m) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const n = fbm(x, y, m.freq, 3);      // reuse bump field -> crevices darker
    const ao = clamp01(0.75 + n * 0.25);
    const i = (y * SIZE + x) * 4;
    buf[i] = buf[i + 1] = buf[i + 2] = ao * 255; buf[i + 3] = 255;
  }
  return buf;
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'materials.json'), 'utf8'));
const SLOT_GEN = { diffuse: genDiffuse, normalDX: genNormalDX, roughness: genRoughness, ao: genAO };

for (const mat of manifest.materials) {
  const spec = MATERIALS[mat.id];
  if (!spec) continue;
  const baseDir = path.join(ROOT, mat.folder, 'base');
  fs.mkdirSync(baseDir, { recursive: true });
  for (const [slot, gen] of Object.entries(SLOT_GEN)) {
    const filename = mat.maps[slot];
    if (!filename) continue;
    // Encoder emits PNG bytes, but we keep the manifest filename (often .jpg);
    // browsers/three sniff image type by content magic bytes, not extension, so
    // a PNG-content file named .jpg decodes fine. Keeps the manifest unchanged.
    const png = encodePNG(gen(spec), SIZE, SIZE);
    fs.writeFileSync(path.join(baseDir, filename), png);
  }
  console.log('generated', mat.id);
}
console.log('done');
