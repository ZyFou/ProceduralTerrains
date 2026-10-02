// ============================================================================
// Visual-regression comparison between two harness runs.
//
//   node tools/perf-harness/compare.mjs <baselineLabel> <candidateLabel> [--diff]
//
// Per capture: MAE (% of full range, all RGB channels), SSIM (8×8 luma windows,
// stride 4), share of pixels whose largest channel delta exceeds 16/255, and
// PSNR. A capture "passes" the <1% visual budget when MAE < 1% AND
// (1 − SSIM) < 1%. Writes compare-<baseline>.json into the candidate run and,
// with --diff, amplified difference PNGs.
// ============================================================================
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNS = path.join(ROOT, 'output', 'perf-harness', 'runs');

async function load(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function luma(img) {
  const n = img.width * img.height;
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    out[i] = 0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2];
  }
  return out;
}

function ssim(a, b, width, height, win = 8, stride = 4) {
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  let total = 0;
  let count = 0;
  const n = win * win;
  for (let y = 0; y + win <= height; y += stride) {
    for (let x = 0; x + win <= width; x += stride) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let yy = 0; yy < win; yy++) {
        let idx = (y + yy) * width + x;
        for (let xx = 0; xx < win; xx++, idx++) {
          const va = a[idx];
          const vb = b[idx];
          sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      const ma = sa / n;
      const mb = sb / n;
      const va = saa / n - ma * ma;
      const vb = sbb / n - mb * mb;
      const cov = sab / n - ma * mb;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      count++;
    }
  }
  return total / Math.max(1, count);
}

export async function compareImages(fileA, fileB, diffFile = null) {
  const a = await load(fileA);
  const b = await load(fileB);
  if (a.width !== b.width || a.height !== b.height) return { error: 'size mismatch' };
  const len = a.data.length;
  let absSum = 0;
  let sq = 0;
  let over = 0;
  const diff = diffFile ? Buffer.alloc(len) : null;
  for (let p = 0; p < len; p += 3) {
    let maxd = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[p + c] - b.data[p + c]);
      absSum += d;
      sq += d * d;
      if (d > maxd) maxd = d;
      if (diff) diff[p + c] = Math.min(255, d * 8);
    }
    if (maxd > 16) over++;
  }
  const pixels = len / 3;
  const mae = absSum / len / 255 * 100;
  const mse = sq / len;
  const psnr = mse > 0 ? 10 * Math.log10((255 * 255) / mse) : Infinity;
  const s = ssim(luma(a), luma(b), a.width, a.height);
  if (diff) await sharp(diff, { raw: { width: a.width, height: a.height, channels: 3 } }).png().toFile(diffFile);
  const dssim = (1 - s) * 100;
  return {
    maePct: +mae.toFixed(4),
    ssim: +s.toFixed(5),
    dssimPct: +dssim.toFixed(4),
    over16Pct: +(over / pixels * 100).toFixed(4),
    psnr: Number.isFinite(psnr) ? +psnr.toFixed(2) : 'inf',
    pass: mae < 1 && dssim < 1,
  };
}

export async function compareRuns(baseLabel, candLabel, { writeDiff = false } = {}) {
  const baseShots = path.join(RUNS, baseLabel, 'shots');
  const candShots = path.join(RUNS, candLabel, 'shots');
  const out = {};
  if (!fs.existsSync(baseShots) || !fs.existsSync(candShots)) return out;
  const diffDir = path.join(RUNS, candLabel, `diff-vs-${baseLabel}`);
  if (writeDiff) fs.mkdirSync(diffDir, { recursive: true });
  for (const file of fs.readdirSync(baseShots).filter((f) => f.endsWith('.png'))) {
    const cand = path.join(candShots, file);
    if (!fs.existsSync(cand)) continue;
    out[file.replace(/\.png$/, '')] = await compareImages(
      path.join(baseShots, file), cand, writeDiff ? path.join(diffDir, file) : null,
    );
  }
  fs.writeFileSync(path.join(RUNS, candLabel, `compare-${baseLabel}.json`), JSON.stringify(out, null, 2));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, cand] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!base || !cand) {
    console.error('usage: compare.mjs <baselineLabel> <candidateLabel> [--diff]');
    process.exit(2);
  }
  const res = await compareRuns(base, cand, { writeDiff: process.argv.includes('--diff') });
  let worst = 0;
  for (const [k, v] of Object.entries(res)) {
    worst = Math.max(worst, v.maePct ?? 0, v.dssimPct ?? 0);
    console.log(`${v.pass ? 'PASS' : 'FAIL'}  ${k.padEnd(28)} MAE ${String(v.maePct).padStart(7)}%  1-SSIM ${String(v.dssimPct).padStart(7)}%  >16 ${String(v.over16Pct).padStart(7)}%  PSNR ${v.psnr}`);
  }
  console.log(`worst metric: ${worst.toFixed(4)}%`);
}
