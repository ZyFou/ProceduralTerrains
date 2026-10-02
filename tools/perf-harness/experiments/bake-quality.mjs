// Re-enable the studio height/normal bake at runtime and compare captures +
// frame cost against the live per-pixel field (baseline run captures).
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, h, scene, shot, ROOT }) {
  const sizes = (process.env.BAKE_SIZES || '1024,2048').split(',').map(Number);
  for (const size of sizes) {
    const ok = await page.evaluate(async (sz) => {
      const e = window.__engine;
      window.__h.unfreeze();
      e.terrainHeightBaker?.dispose?.();
      e.terrainHeightBaker = null;
      e._bakeBaseSize = () => sz;
      e._studioLiveHeightField = false;
      e._terrainHeightBakeDeferred = true;
      e._bakedStudioGen = -1;
      return e._prepareStudioHeightCacheAsync();
    }, size);
    console.log('prepared', size, ok);
    const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', `exp-bake-${size}`, 'shots');
    fs.mkdirSync(dir, { recursive: true });
    for (const view of scene.views) {
      await h.setPose(view.pose);
      const s = await h.settle({ timeoutMs: 60000 });
      const used = await page.evaluate(() => window.__engine.uniforms.uUseTerrainHeightTex.value);
      await h.setPose(view.pose);
      await shot(path.join(dir, `${scene.id}--${view.id}.png`));
      const m = await h.measure({ frames: 60, warmup: 10 });
      console.log(size, view.id, 'bakeUsed', used, 'frame', m.frameMs.mean, 'gpu', m.gpuMs?.mean, 'settle', s.ms);
    }
  }
}
