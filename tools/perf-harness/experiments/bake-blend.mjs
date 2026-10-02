// Sweep the live->baked blend thresholds (footprint/texel ratio).
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, h, scene, shot, ROOT }) {
  const blends = JSON.parse(process.env.BLENDS || '[[0.75,1.25],[1.0,1.6],[1.5,2.5]]');
  for (const [a, b] of blends) {
    await page.evaluate(([x, y]) => window.__engine.uniforms.uBakeBlend.value.set(x, y), [a, b]);
    const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', `exp-blend-${a}-${b}`, 'shots');
    fs.mkdirSync(dir, { recursive: true });
    for (const view of scene.views) {
      await h.setPose(view.pose);
      const st = await h.settle({ timeoutMs: 90000 });
      await h.setPose(view.pose);
      await shot(path.join(dir, `${scene.id}--${view.id}.png`));
      const m = await h.measure({ frames: 40, warmup: 8 });
      const u = await page.evaluate(() => { const e = window.__engine; return [e.uniforms.uUseTerrainHeightTex.value, e.uniforms.uBakeTexelWorld.value, e.uniforms.uPixelWorldPerDist.value]; });
      console.log('blend', a, b, view.id.padEnd(9), 'frame', m.frameMs.mean, 'gpu', m.gpuMs?.mean, 'bake/texel/px', JSON.stringify(u), 'settle', st.ms, st.idle);
    }
  }
}
