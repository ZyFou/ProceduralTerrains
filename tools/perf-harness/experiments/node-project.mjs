// Node-project checks: creates a node template project (default Geological
// Hybrid), settles, captures views and reports the height-bake state.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/node-project.mjs --scene studio
// env TEMPLATE=<node template id>, VIEWS=<json [{id,pose}]>, PARAMS=<json>, TAG=name,
//     FRAMES=n (per view, consecutive frames with a tiny camera nudge)
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, h, ROOT }) {
  const tag = process.env.TAG || 'node';
  const dir = path.join(ROOT, 'output', 'perf-harness', 'node-project', tag);
  fs.mkdirSync(dir, { recursive: true });
  const template = process.env.TEMPLATE || 'nodes-geological-hybrid';
  const created = await page.evaluate(async ({ templateId, live }) => {
    const e = window.__engine;
    window.__h.unfreeze();
    // LIVE=1 reproduces the previous node behaviour (no height bake)
    if (live) e._studioLiveHeightField = true;
    const { createNodeTemplateGraph } = await import('/src/project/NodeProjectTemplates.js');
    const graph = createNodeTemplateGraph(templateId);
    const t0 = performance.now();
    await e.transitionMode({
      worldMode: 'studio',
      projectMode: 'nodes',
      project: { projectMode: 'nodes', seed: 12345, initialGraph: graph },
      reason: 'project-create',
    });
    return { ms: Math.round(performance.now() - t0), projectMode: e.projectMode };
  }, { templateId: template, live: process.env.LIVE === '1' });
  console.log('created', JSON.stringify(created));
  if (process.env.LOG) {
    const lines = await page.evaluate(() => window.__h.consoleLines.slice(-60));
    for (const l of lines) console.log(`  [${l.t}] ${l.level} ${l.text.slice(0, 220)}`);
  }
  if (process.env.PARAMS) await h.setParams(JSON.parse(process.env.PARAMS));
  if (process.env.SEA_PLATEAU) {
    // terraces make flat steps: find the most common height band (a plateau)
    // and put the sea SEA_PLATEAU units above it -> a submerged flat that is
    // nearly coplanar with the water (worst case for depth fighting)
    const info = await page.evaluate(() => {
      const e = window.__engine;
      const sampler = e._getCpuHeightSampler();
      const size = e.boardSize || 2048;
      const counts = new Map();
      for (let i = 0; i < 160; i++) for (let j = 0; j < 160; j++) {
        const x = (i / 159 - 0.5) * size * 0.9; const z = (j / 159 - 0.5) * size * 0.9;
        const hgt = sampler?.heightAt?.(x, z);
        if (!Number.isFinite(hgt)) continue;
        const key = Math.round(hgt * 2) / 2;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const sorted = [...counts.entries()].filter(([k]) => k > 20).sort((a, b) => b[1] - a[1]).slice(0, 6);
      return { sampler: !!sampler, top: sorted };
    });
    console.log('plateaus', JSON.stringify(info));
    const plateau = info.top[0]?.[0] ?? 100;
    const seaLevel = plateau + Number(process.env.SEA_PLATEAU);
    console.log('seaLevel', seaLevel);
    await h.setParams({ seaLevel });
  }
  if (process.env.SEA_FRACTION) {
    const info = await page.evaluate(() => ({ scale: window.__engine.uniforms.uHeightScale.value, max: window.__engine._maxHeight?.() }));
    const seaLevel = Math.round(info.scale * Number(process.env.SEA_FRACTION));
    console.log('height', JSON.stringify(info), 'seaLevel', seaLevel);
    await h.setParams({ seaLevel });
  }
  const settle = await h.settle();
  const bakeState = await page.evaluate(() => {
    const e = window.__engine; const u = e.uniforms;
    return {
      live: e._usesLiveStudioHeightField(),
      useH: u.uUseTerrainHeightTex.value, useNear: u.uUseNearBake.value,
      baked: e._bakedStudioGen, gen: e._terrainGen,
      minimal: e.terrainMaterial?.userData?.minimalFragment,
      deferred: e._terrainHeightBakeDeferred,
    };
  });
  console.log('settle', JSON.stringify({ ms: settle.ms, frames: settle.frames, idle: settle.idle }), 'bake', JSON.stringify(bakeState));
  const views = process.env.VIEWS ? JSON.parse(process.env.VIEWS) : [
    { id: 'overview', pose: { radiusFactor: 1.1, phi: 62, theta: 45 } },
    { id: 'close', pose: { radiusFactor: 0.22, phi: 68, theta: 130, target: [0.05, 120, -0.05] } },
  ];
  const frames = Number(process.env.FRAMES || 1);
  for (const view of views) {
    for (let f = 0; f < frames; f++) {
      const pose = { ...view.pose };
      if (f > 0) { pose.theta = (pose.theta ?? 45) + f * 0.15; pose.phi = (pose.phi ?? 55) + f * 0.05; }
      await h.setPose(pose);
      await h.settle({ idleFrames: 10, minFrames: 12 });
      const url = await page.evaluate(() => window.__h.capture());
      const file = path.join(dir, `${view.id}${frames > 1 ? `-f${f}` : ''}.png`);
      fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    }
  }
  console.log('final bake', JSON.stringify(await page.evaluate(() => {
    const e = window.__engine; const u = e.uniforms;
    return { useH: u.uUseTerrainHeightTex.value, useNear: u.uUseNearBake.value, baked: e._bakedStudioGen, gen: e._terrainGen };
  })));
}
