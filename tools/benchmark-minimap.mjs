// CPU responsiveness + exact RGBA comparison against a Git baseline.
// Usage: node tools/benchmark-minimap.mjs [baseline-ref] > results.json
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Minimap } from '../src/engine/Minimap.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { TerrainHeightSampler } from '../src/engine/terrain/TerrainHeightSampler.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = process.argv[2] || '1b488d99aae81fae615eecf281fb24e2f9995cdf';
const cache = resolve(root, '.cache');
mkdirSync(cache, { recursive: true });
const temporary = mkdtempSync(join(cache, 'minimap-parity-'));
const baselinePath = join(temporary, 'Minimap.js');
const round = (value) => Math.round(value * 1000) / 1000;

try {
  writeFileSync(baselinePath, execFileSync('git', ['show', `${baseline}:src/engine/Minimap.js`], { cwd: root }));
  const { Minimap: Baseline } = await import(pathToFileURL(baselinePath));
  const make = (Class, seed, mode) => {
    const uniforms = createTerrainUniforms();
    uniforms.uSeedOffset.value.set(seed, seed * 0.31);
    const sampler = new TerrainHeightSampler(uniforms, () => ({ octaves: 5, infinite: false }));
    const map = new Class({}, {}, null, null);
    map.setBoard(2048, 420);
    map.setSources({ sampler, controls: { target: { x: 173.712, z: -247.618 } },
      getWaterLevel: () => 95,
      getPaintHeightOffset: (x, z) => Math.sin(x * 0.1) * 9 + Math.cos(z * 0.2) * 5,
      getPropsMask: (x, z) => ({ grass: (Math.sin(x) + 1) / 2, flowers: (Math.cos(z) + 1) / 2, mixed: 0.25 }),
    });
    map.setConfig({ mode, zoom: 2.7 });
    return map;
  };
  const runs = [];
  for (const mode of ['height', 'water', 'noise', 'biome', 'slope', 'props']) {
    for (const seed of [17, 42, 1234]) {
      const before = make(Baseline, seed, mode);
      const startedAt = performance.now();
      const reference = before.createFramePacket();
      const beforeMs = performance.now() - startedAt;
      const after = make(Minimap, seed, mode);
      const nextStartedAt = performance.now();
      const candidate = await after.createFramePacket();
      const afterMs = performance.now() - nextStartedAt;
      let differingBytes = 0;
      for (let i = 0; i < reference.rgba.length; i++) differingBytes += reference.rgba[i] !== candidate.rgba[i];
      const cachedAt = performance.now();
      await after.createFramePacket();
      runs.push({ mode, seed, beforeSingleTaskMs: round(beforeMs), afterTotalMs: round(afterMs),
        afterMaxSampleBatchMs: round(after.getDiagnostics().maxBatchMs), afterCachedMs: round(performance.now() - cachedAt),
        differingBytes, rgbaSha256: createHash('sha256').update(candidate.rgba).digest('hex') });
      before.dispose(); after.dispose();
    }
  }
  console.log(JSON.stringify({ baseline, environment: `Node ${process.version}, CPU-only`,
    conditions: '128x128 exact samples / 256x256 RGBA; five octaves; zoom 2.7; authored height offsets; varied prop masks; sequential before/after (not randomized); no GPU/browser timing',
    runs }, null, 2));
  if (runs.some((run) => run.differingBytes > 0)) process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
