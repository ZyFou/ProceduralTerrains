import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Capture the editor renderer through the same preset action used by the Shape panel.
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') { errors.push(message.text()); console.error(message.text().slice(0, 900)); }
  });
  const config = { preset: 'ultra', params: { seed: 1337, erosionBackend: 'cpu', waterEnabled: false, waterMode: 'off', skyboxEnabled: false, sunAzimuth: 300, sunElevation: 32 } };
  await page.goto(server.resolvedUrls.local[0] + 'tools/perf-harness/harness.html?config=' + encodeURIComponent(JSON.stringify(config)));
  await page.waitForFunction(() => window.__h, null, { timeout: 120000 });
  console.log(await page.evaluate(() => window.__h.boot()));
  const nodes = process.argv.includes('--nodes');
  const result = await page.evaluate(async nodes => {
    const e = window.__engine;
    document.querySelector('#wrap').style.cssText = 'width:1080px;height:1080px';
    e._onResize();
    let ok;
    if (nodes) {
      const { createNodeTemplateGraph } = await import('/src/project/NodeProjectTemplates.js');
      await e.transitionMode({worldMode:'studio', projectMode:'nodes', project:{
        seed:1337, nodeTemplateId:'nodes-dry-canyon', initialGraph:createNodeTemplateGraph('nodes-dry-canyon'),
      }});
      ok = e._liveGraphProgram.surface.usesErosion && e.uniforms.uDryCanyon.value === 0;
    } else ok = await e.applyPresetByKey('dryCanyon');
    return { ok, res: e.erosionField.res, enabled: e.erosionField.enabled, size: e.boardSize,
      span: e.uniforms.uBakeSpan.value.toArray(), scale: e.uniforms.uHeightScale.value,
      variant: e.terrainMaterial.userData.terrainVariant };
  }, nodes);
  console.log(result);
  assert.equal(result.ok && result.enabled, true);
  await page.evaluate(async () => {
    const e = window.__engine;
    e.scene.background.setRGB(0.067, 0.10, 0.088);
    await window.__h.settle({ timeoutMs: 60000, minFrames: 8, idleFrames: 3 });
  });
  const png = await page.evaluate(() => window.__h.capture());
  const probe = await page.evaluate(async () => {
    const e = window.__engine, u = e.uniforms, target = e.terrainHeightBaker.target;
    const { DataUtils } = await import('/node_modules/three/build/three.module.js');
    const heightDifferences = [];
    for (const [s,t] of [[0.25,0.3],[0.48,0.45],[0.75,0.62],[0.5,0.8]]) {
      const i = Math.floor(target.width*s), j = Math.floor(target.height*t);
      const data = new Uint16Array(4);
      e.renderer.readRenderTargetPixels(target,i,j,1,1,data);
      const x = u.uBakeOrigin.value.x + (i+0.5)/target.width*u.uBakeSpan.value.x;
      const z = u.uBakeOrigin.value.y + (j+0.5)/target.height*u.uBakeSpan.value.y;
      const cpu = e._getCpuHeightSampler().heightAt(x,z);
      heightDifferences.push(Math.abs(cpu - DataUtils.fromHalfFloat(data[3]) * u.uHeightScale.value));
    }
    return { heightDifferences, baked: u.uUseTerrainHeightTex.value };
  });
  console.log(probe);
  assert.ok(probe.baked && probe.heightDifferences.every(difference => difference < 2));
  await mkdir('output', { recursive: true });
  const output = nodes ? 'output/dry-canyon-nodes.png' : 'output/dry-canyon.png';
  await writeFile(output, Buffer.from(png.split(',')[1], 'base64'));
  if (nodes) {
    const rewired = await page.evaluate(async () => {
      const engine = window.__engine;
      const graph = structuredClone(engine.terrainGraph);
      const maps = graph.nodes.find(node => node.type === 'erosionMaps');
      const gravel = graph.nodes.find(node => node.label === 'Deposit gravel');
      const wire = graph.edges.find(edge => edge.target === gravel.id && edge.targetHandle === 'mask');
      const initial = engine.erosionField.revision;
      const sources = [];
      for (const channel of ['flow', 'erosion', 'deposition']) {
        wire.source = maps.id;
        wire.sourceHandle = channel;
        const edit = engine.setTerrainGraph(graph);
        if (!edit.ok) throw new Error(JSON.stringify(edit.diagnostics));
        const result = await edit.ready;
        if (result?.error) throw result.error;
        await window.__h.settle({ timeoutMs: 60000, minFrames: 3, idleFrames: 2 });
        sources.push(await window.__h.capture());
      }
      const retained = initial === engine.erosionField.revision;
      const saved = JSON.parse(JSON.stringify(engine.createProjectPayload()));
      const landform = graph.nodes.find(node => node.type === 'mainWash');
      landform.params.warp = 1.4;
      const priorKey = engine.erosionField.graphKey;
      await engine.setTerrainGraph(graph).ready;
      const rebaked = engine.erosionField.graphKey !== priorKey && engine.erosionField.revision > initial;
      await engine.loadSeedJSON(saved, {silent:true});
      const savedWire = engine.terrainGraph.edges.find(edge => edge.id === wire.id);
      const restored = engine.erosionField.graphKey === priorKey && engine.erosionField.enabled
        && savedWire.sourceHandle === 'deposition' && engine.erosionField.masks.flow.length === 384 * 384;
      return {distinct: new Set(sources).size, retained, rebaked, restored};
    });
    console.log(rewired);
    assert.deepEqual(rewired, {distinct:3, retained:true, rebaked:true, restored:true});
  }
  if (process.argv.includes('--orbit')) {
    const encoder = spawn('ffmpeg', ['-loglevel','error','-y','-f','image2pipe','-framerate','24',
      '-i','pipe:0','-vf','scale=720:720,tpad=stop_mode=clone:stop_duration=1',
      '-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart','output/dry-canyon-orbit.mp4'],
    { stdio: ['pipe','ignore','inherit'], windowsHide: true });
    const finished = once(encoder, 'close');
    try {
      const end = await page.evaluate(() => window.__engine.controls.getView());
      for (let frame = 0; frame < 96; frame++) {
        const data = await page.evaluate(async ({ frame, end }) => {
          const e = window.__engine, t = frame / 95;
          const k = t * t * (3 - 2 * t);
          const lerp = (a,b) => a + (b-a)*k;
          window.__h.setPose({ theta: lerp(18,end.theta*180/Math.PI), phi: lerp(22,end.phi*180/Math.PI),
            radius: lerp(e.boardSize*2.05,end.radius), target: [0,lerp(120,end.target[1]),lerp(0,end.target[2]/e.boardSize)] });
          return window.__h.capture();
        }, { frame, end });
        if (!encoder.stdin.write(Buffer.from(data.split(',')[1], 'base64'))) await once(encoder.stdin,'drain');
      }
    } finally { encoder.stdin.end(); }
    const [exitCode] = await finished;
    assert.equal(exitCode, 0);
  }
  assert.deepEqual(errors, []);
  console.log('Saved', output);
} finally {
  await browser?.close();
  await server.close();
}
