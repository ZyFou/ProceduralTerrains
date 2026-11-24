// Generates the static template-card thumbnails shipped with the app
// (src/assets/template-thumbs/<kind>/<id>.webp).
//
// Each template is created through the same engine project transaction the
// editor uses (App.createProjectFromTemplate), then the harness settles until
// the terrain is FULLY loaded — no LOD rebuilds, pending detail pages, prop
// sectors, height bakes, water transitions or shader compiles — before the
// frame is captured and compressed to a tiny WebP.
//
//   npm run templates:thumbs        (= node tools/template-thumbs.mjs)
//   env: KINDS=procedural,nodes,mini  ONLY=island,nodes-canyon  SEED=20261124
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Run directly: drive this module through the perf-harness probe (fresh Vite
// server + headless Edge, main-thread engine) at the Ultra quality preset.
const SELF = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const probe = path.join(path.dirname(SELF), 'perf-harness', 'probe.mjs');
  const run = spawnSync(process.execPath, [probe, SELF, '--config', JSON.stringify({ preset: 'ultra' })], { stdio: 'inherit' });
  process.exit(run.status ?? 1);
}

const SEED = Number(process.env.SEED || 20261124);
const KINDS = (process.env.KINDS || 'procedural,nodes,mini').split(',');
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
// Card thumbnails render at ~230×144 CSS px; 2× covers HiDPI screens.
const WIDTH = 448;
const HEIGHT = 280;
const QUALITY = 58;

export default async function ({ page, h, ROOT }) {
  const outRoot = path.join(ROOT, 'src', 'assets', 'template-thumbs');
  const jobs = await page.evaluate(async (kinds) => {
    const { PROJECT_TEMPLATES } = await import('/src/project/ProjectTemplates.js');
    const { NODE_PROJECT_TEMPLATES } = await import('/src/project/NodeProjectTemplates.js');
    const { MINI_COMPOSITION_IDS } = await import('/src/engine/mini/MiniTerrainSettings.js');
    const list = [];
    if (kinds.includes('procedural')) for (const t of PROJECT_TEMPLATES) list.push({ kind: 'procedural', id: t.id });
    if (kinds.includes('nodes')) for (const t of NODE_PROJECT_TEMPLATES) list.push({ kind: 'nodes', id: t.id });
    if (kinds.includes('mini')) {
      for (const t of PROJECT_TEMPLATES) list.push({ kind: 'mini', id: t.id });
      for (const id of MINI_COMPOSITION_IDS) list.push({ kind: 'mini', id });
    }
    return list;
  }, KINDS);

  let totalBytes = 0;
  for (const job of jobs) {
    if (ONLY && !ONLY.has(job.id)) continue;
    const t0 = Date.now();
    await page.evaluate(async ({ kind, id, seed }) => {
      const e = window.__engine;
      const { getProjectTemplate } = await import('/src/project/ProjectTemplates.js');
      const { createNodeTemplateGraph, getNodeProjectTemplate } = await import('/src/project/NodeProjectTemplates.js');
      const { applyGraphColorPreset, setGraphColorEnabled } = await import('/src/engine/terrain/graph/GraphDocument.js');
      const { MINI_COMPOSITION_IDS } = await import('/src/engine/mini/MiniTerrainSettings.js');
      window.__h.unfreeze();
      let project;
      if (kind === 'nodes') {
        const template = getNodeProjectTemplate(id);
        let graph = createNodeTemplateGraph(id);
        graph = template.colorsEnabled !== false
          ? applyGraphColorPreset(graph, template.colorPreset || 'alpine')
          : setGraphColorEnabled(graph, false);
        project = { projectMode: 'nodes', seed, initialGraph: graph, nodeTemplateId: id };
      } else if (kind === 'mini') {
        const composition = MINI_COMPOSITION_IDS.includes(id);
        const base = composition ? null : getProjectTemplate(id);
        project = {
          projectMode: 'procedural', seed,
          noiseStackPresetKey: base?.noiseStackPreset ?? null,
          mini: { recipe: composition ? id : 'procedural', seed, preset: base?.preset ?? null },
        };
      } else {
        const template = getProjectTemplate(id);
        project = { projectMode: 'procedural', seed, presetKey: template.preset, noiseStackPresetKey: template.noiseStackPreset ?? null };
      }
      await e.transitionMode({ worldMode: 'studio', projectMode: project.projectMode, project, reason: 'project-create' });
      // The editor builds the texture atlas for an atlas-backed surface source
      // (App's applySurfaceTextures effect); the harness has no App, so do the
      // same here and wait until it is prepared, uploaded and installed.
      const { sourceUsesTextureAtlas } = await import('/src/engine/terrain/surface/SurfaceTextureSources.js');
      if (sourceUsesTextureAtlas(e.params.surfaceTextureSource)) {
        const atlas = await e.buildAndSetSurfaceAtlas(e.params.surfaceTextureSource);
        if (!atlas?.anyPresent) throw new Error(`${id}: surface textures did not load`);
      }
    }, { ...job, seed: SEED });
    // Wait for the whole terrain: long idle run so late prop/detail streaming
    // after the first idle frame cannot slip into the capture.
    const settled = await h.settle({ timeoutMs: 180000, minFrames: 90, idleFrames: 60 });
    if (!settled.idle) console.warn(`  ! ${job.kind}/${job.id} did not fully settle`, JSON.stringify(settled.state));
    const dataUrl = await h.capture();
    const png = Buffer.from(dataUrl.split(',')[1], 'base64');
    // Mini dioramas sit small in the middle of their home framing; zoom in so
    // they read at card size. Board templates already fill the frame.
    const { width: srcW, height: srcH } = await sharp(png).metadata();
    const zoom = job.kind === 'mini' ? 0.74 : 1;
    const cropH = Math.round(Math.min(srcH, srcW / (WIDTH / HEIGHT)) * zoom);
    const cropW = Math.round(cropH * (WIDTH / HEIGHT));
    const webp = await sharp(png)
      .extract({ left: Math.round((srcW - cropW) / 2), top: Math.round((srcH - cropH) / 2), width: cropW, height: cropH })
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
      .webp({ quality: QUALITY, effort: 6, smartSubsample: true })
      .toBuffer();
    const file = path.join(outRoot, job.kind, `${job.id}.webp`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, webp);
    totalBytes += webp.length;
    console.log(`  ${job.kind}/${job.id}: ${(webp.length / 1024).toFixed(1)} KB (settled ${settled.ms} ms, ${Date.now() - t0} ms total)`);
  }
  console.log(`template thumbnails: ${(totalBytes / 1024).toFixed(1)} KB total`);
}
