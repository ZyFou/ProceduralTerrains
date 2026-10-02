// Prototype: depth pre-pass for the studio terrain. A cheap depth-only pass
// (same vertex shader, trivial fragment) lays down the nearest depth so the
// expensive terrain fragment runs once per visible pixel instead of once per
// covering fragment (hills overdraw each other heavily at close/grazing views).
//   VIEW=close node tools/perf-harness/probe.mjs tools/perf-harness/experiments/depth-prepass.mjs --scene studio
import fs from 'node:fs';
import path from 'node:path';
import { compareImages } from '../compare.mjs';

export default async function ({ page, h, scene, shot, ROOT }) {
  const dir = path.join(ROOT, 'output', 'perf-harness', 'prepass');
  fs.mkdirSync(dir, { recursive: true });
  for (const viewId of (process.env.VIEW || 'close,grazing,overview').split(',')) {
    const view = scene.views.find((v) => v.id === viewId);
    await h.setPose(view.pose);
    await h.settle({ timeoutMs: 90000 });
    const run = async (label) => {
      await h.setPose(view.pose);
      const best = [];
      for (let r = 0; r < 2; r++) best.push(await h.measure({ frames: 40, warmup: 8 }));
      const m = best.sort((a, b) => a.gpuMs.median - b.gpuMs.median)[0];
      const file = path.join(dir, `${viewId}-${label}.png`);
      await h.setPose(view.pose);
      await shot(file);
      return { label, gpu: m.gpuMs?.median, frame: m.frameMs?.median, file };
    };
    const results = [await run('base')];
    for (const variant of ['prepass-nowrite', 'prepass-write']) {
      await page.evaluate(async (mode) => {
        const e = window.__engine;
        const T = await import('/node_modules/.vite/deps/three.js');
        const terrain = e.terrainMaterial;
        if (!window.__pre) {
          const frag = /* glsl */ `
            varying vec3 vWorldPos; varying float vWallMesh;
            void main() { gl_FragColor = vec4(0.0); }`;
          const pre = new T.ShaderMaterial({
            uniforms: terrain.uniforms,
            defines: { ...terrain.defines },
            vertexShader: terrain.vertexShader,
            fragmentShader: frag,
            side: terrain.side,
            colorWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          });
          const meshes = [];
          e.board.group.traverse((o) => { if (o.isMesh && o.material === terrain) meshes.push(o); });
          for (const m of meshes) {
            const p = new T.Mesh(m.geometry, pre);
            p.renderOrder = -10;
            p.frustumCulled = m.frustumCulled;
            p.matrixAutoUpdate = false;
            m.add(p);
          }
          window.__pre = { pre, count: meshes.length };
          await e.renderer.compileAsync(e.scene, e.camera);
        }
        terrain.depthWrite = mode === 'prepass-write';
        terrain.needsUpdate = false;
      }, variant);
      results.push(await run(variant));
    }
    for (const r of results.slice(1)) {
      r.diff = await compareImages(results[0].file, r.file);
    }
    await page.evaluate(() => {
      const e = window.__engine;
      e.board.group.traverse((o) => {
        for (const c of [...o.children]) if (c.material === window.__pre?.pre) o.remove(c);
      });
      e.terrainMaterial.depthWrite = true;
      window.__pre = null;
    });
    console.log(viewId, JSON.stringify(results.map((r) => ({
      label: r.label, gpu: r.gpu, frame: r.frame,
      mae: r.diff?.mae, ssim: r.diff?.ssim, over16: r.diff?.over16,
    }))));
  }
}
