// Cloud cost split: skip detail+erosion where edge == 0 (exact), and a lower
// bound with detail+erosion removed. studio-full overview/close.
import path from 'node:path';
import fs from 'node:fs';
import { compareImages } from '../compare.mjs';
export default async function ({ page, h, scene, shot, ROOT }) {
  const dir = path.join(ROOT, 'output', 'perf-harness', 'cloud-edge');
  fs.mkdirSync(dir, { recursive: true });
  for (const viewId of (process.env.VIEW || 'overview,close').split(',')) {
    const view = scene.views.find((v) => v.id === viewId);
    await h.setPose(view.pose);
    await h.settle({ timeoutMs: 90000 });
    const variants = [
      ['base', null],
      ['edge-skip', 'skip'],
      ['no-detail', 'none'],
    ];
    let ref = null;
    for (const [label, mode] of variants) {
      await page.evaluate(async (m) => {
        const e = window.__engine;
        const mat = e.studioCloud.material;
        window.__cloudSrc ||= mat.fragmentShader;
        let src = window.__cloudSrc;
        if (m === 'skip') {
          src = src.replace('float carve = 0.0;', 'float carve = 0.0;\n  if (edge > 0.0) {')
            .replace('float dens = clamp(cov + carve * edge, 0.0, 1.0);', '}\n  float dens = clamp(cov + carve * edge, 0.0, 1.0);');
        } else if (m === 'none') {
          src = src.replace('float carve = 0.0;', 'float carve = 0.0;\n  if (false) {')
            .replace('float dens = clamp(cov + carve * edge, 0.0, 1.0);', '}\n  float dens = clamp(cov + carve * edge, 0.0, 1.0);');
        }
        mat.fragmentShader = src;
        mat.needsUpdate = true;
        window.__h.unfreeze();
        await e.renderer.compileAsync(e.scene, e.camera);
        for (let i = 0; i < 3; i++) { e._needsRender = true; e._tick(); await new Promise((r) => setTimeout(r, 30)); }
      }, mode);
      await h.setPose(view.pose);
      const ms = [];
      for (let r = 0; r < 2; r++) ms.push((await h.measure({ frames: 30, warmup: 6 })).gpuMs?.median);
      const file = path.join(dir, `${viewId}-${label}.png`);
      await h.setPose(view.pose);
      await shot(file);
      const d = ref ? await compareImages(ref, file) : null;
      if (!ref) ref = file;
      console.log(viewId, label.padEnd(10), 'gpu', Math.min(...ms), d ? `MAE ${d.maePct} dSSIM ${d.dssimPct} >16 ${d.over16Pct}` : '');
    }
  }
}
