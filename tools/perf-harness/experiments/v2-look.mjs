// V2 look check: Realistic V2 clouds, the Gerstner realistic water tiers and
// the Procedural V2 terrain surface, each captured next to the look it
// replaces / extends, with GPU frame time per configuration.
//   node tools/perf-harness/probe.mjs tools/perf-harness/experiments/v2-look.mjs
//   env: LABEL=<run label>  SEED=8  PRESET=archipelago  STEPS=clouds,water,surface,infinite
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, h, shot, ROOT }) {
  const dir = path.join(ROOT, 'output', 'perf-harness', 'runs', process.env.LABEL || 'v2-look');
  fs.mkdirSync(dir, { recursive: true });
  const steps = (process.env.STEPS || 'clouds,water,surface,infinite').split(',');
  await page.evaluate(async ({ seed, preset }) => {
    await window.__engine.transitionMode({
      worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
      project: { projectMode: 'procedural', seed, presetKey: preset },
    });
  }, { seed: Number(process.env.SEED || 8), preset: process.env.PRESET || 'archipelago' });
  await h.settle({ timeoutMs: 120000 });

  const info = () => page.evaluate(() => {
    const e = window.__engine;
    const cloud = e.worldMode === 'infinite' ? e.infiniteCloud : e.studioCloud;
    const water = e.worldMode === 'infinite' ? e.infiniteWorld?.waterPlane : e.water;
    const terrain = e.worldMode === 'infinite' ? e._infiniteTerrainMat : e.terrainMaterial;
    const diagnostics = (e.renderer.info.programs || [])
      .filter((p) => p.diagnostics && !p.diagnostics.runnable)
      .map((p) => `${p.name}: ${(p.diagnostics.fragmentShader?.log || p.diagnostics.programLog || '').slice(0, 400)}`);
    return {
      world: e.worldMode,
      cloud: cloud ? {
        mode: cloud.renderMode ?? 'legacy', active: cloud.active, lowRes: cloud.usesLowRes, scale: cloud.effectiveRenderScale,
        adaptive: [cloud._adaptiveScaleMultiplier, cloud._adaptiveStepScale], steps: cloud.material?.uniforms?.uCloudSteps?.value,
      } : null,
      water: { effective: e.waterSystem.getEffectiveMode(), material: water?.material?.name || water?.material?.type, pending: e.waterSystem.isMaterialTransitionPending() },
      terrain: { live: terrain?.userData?.terrainVariant, target: e.getTargetTerrainVariant(), v2: e.uniforms.uSurfV2Amount?.value, noise: !!e.uniforms.uSurfV2Noise?.value },
      shaderErrors: diagnostics,
    };
  });
  const ready = async (predicate, label, timeoutMs = 180000) => {
    const started = Date.now();
    for (;;) {
      await h.settle({ timeoutMs: 60000, minFrames: 20, idleFrames: 10 });
      const state = await info();
      if (predicate(state)) return state;
      if (Date.now() - started > timeoutMs) { console.log('TIMEOUT', label, JSON.stringify(state)); return state; }
      await page.waitForTimeout(500);
    }
  };
  const gpu = async (label) => {
    const m = await h.measure({ frames: 60, warmup: 10 });
    console.log('GPU', label, JSON.stringify({ gpu: m.gpuMs?.mean, p95: m.gpuMs?.p95, frame: m.frameMs?.mean, passes: m.renderPasses?.mean }));
  };
  const views = async (prefix, poses) => {
    for (const [id, pose] of poses) {
      await h.setPose(pose);
      await h.settle({ timeoutMs: 90000, minFrames: 20, idleFrames: 10 });
      await shot(path.join(dir, `${prefix}-${id}.png`));
    }
  };

  const wide = ['wide', { radiusFactor: 1.25, phi: 58, theta: 40 }];
  const side = ['side', { radiusFactor: 0.9, phi: 80, theta: 200, target: [0, 200, 0] }];
  const sea = ['sea', { radiusFactor: 0.16, phi: 80, theta: 120, target: [0.30, 45, 0.30] }];
  const shore = ['shore', { radiusFactor: 0.30, phi: 66, theta: 300, target: [0.0, 45, 0.12] }];
  const cliff = ['cliff', { radiusFactor: 0.22, phi: 72, theta: 135, target: [0.06, 150, -0.05] }];
  const close = ['close', { radiusFactor: 0.07, phi: 74, theta: 300, target: [-0.02, 90, 0.10] }];
  const hill = ['hill', { radiusFactor: 0.5, phi: 62, theta: 20, target: [0, 80, 0] }];

  if (steps.includes('clouds')) {
    await h.setParams({ cloudsEnabled: true, cloudCoverage: 0.55, waterMode: 'legacy' });
    for (const mode of ['realistic', 'realisticV2']) {
      await h.setParams({ cloudRenderMode: mode });
      const state = await ready((s) => s.cloud?.mode === mode && s.cloud.active, `cloud ${mode}`);
      console.log('CLOUD', mode, JSON.stringify(state));
      await views(`cloud-${mode}`, [wide, side]);
      await h.setPose(wide[1]);
      await gpu(`cloud-${mode}`);
    }
  }

  // Where the cloud time goes: no clouds / empty V2 sky / default V2 sky.
  if (steps.includes('cloudcost')) {
    await h.setParams({ waterMode: 'legacy', cloudsEnabled: false });
    await h.setPose(wide[1]);
    await h.settle({ timeoutMs: 60000, minFrames: 20, idleFrames: 10 });
    await gpu('no-clouds');
    await h.setParams({ cloudsEnabled: true, cloudRenderMode: 'realisticV2', cloudCoverage: 0 });
    await ready((s) => s.cloud?.mode === 'realisticV2' && s.cloud.active, 'cloud cost');
    await h.setPose(wide[1]);
    await gpu('v2-empty-sky');
    for (const coverage of [0.5, 0.8]) {
      await h.setParams({ cloudCoverage: coverage });
      await h.settle({ timeoutMs: 60000, minFrames: 20, idleFrames: 10 });
      await gpu(`v2-coverage-${coverage}`);
    }
  }

  if (steps.includes('water')) {
    await h.setParams({ cloudsEnabled: false });
    for (const mode of ['realistic', 'volumetric', 'cinematic']) {
      await h.setParams({ waterMode: mode, waterEnabled: true });
      const state = await ready((s) => s.water.effective === mode && !s.water.pending, `water ${mode}`);
      console.log('WATER', mode, JSON.stringify(state));
      await views(`water-${mode}`, [wide, sea, shore]);
      await h.setPose(sea[1]);
      await gpu(`water-${mode}`);
    }
  }

  if (steps.includes('surface')) {
    await h.setParams({ cloudsEnabled: false, waterMode: 'realistic' });
    for (const source of ['procedural', 'proceduralV2']) {
      await h.setParams({ surfaceTextureSource: source });
      const want = source === 'proceduralV2' ? 'v2' : null;
      const state = await ready(
        (s) => (want ? s.terrain.live === want : s.terrain.live !== 'v2') && s.terrain.live === s.terrain.target,
        `surface ${source}`,
      );
      console.log('SURFACE', source, JSON.stringify(state));
      await views(`surface-${source}`, [wide, hill, cliff, shore, close]);
      await h.setPose(cliff[1]);
      await gpu(`surface-${source}`);
    }
  }

  // Clouds mirrored on realistic water (low views: Fresnel needs a grazing eye).
  if (steps.includes('mirror')) {
    await h.setParams({
      cloudsEnabled: true, cloudRenderMode: process.env.HERO_CLOUD || 'realisticV2', cloudCoverage: 0.55,
      waterMode: process.env.HERO_WATER || 'realistic', waterEnabled: true, surfaceTextureSource: 'proceduralV2',
    });
    const state = await ready((s) => s.cloud?.active && !s.water.pending && s.terrain.live === 'v2', 'mirror');
    console.log('MIRROR', JSON.stringify(state), JSON.stringify(await page.evaluate(() => {
      const u = window.__engine.uniforms;
      return { reflection: u.uWaterCloudReflection.value, span: u.uCloudLayerSpan.value,
        extent: u.uTerrainCloudShadowExtent.value, altitude: u.uTerrainCloudShadowAltitude.value,
        shadows: u.uTerrainCloudShadowEnabled.value };
    })));
    await views('mirror', [
      sea,
      ['bay', { radiusFactor: 0.20, phi: 82, theta: 300, target: [0.02, 60, 0.16] }],
      ['low', { radiusFactor: 0.45, phi: 84, theta: 40, target: [0, 70, 0] }],
    ]);
    await h.setPose(sea[1]);
    await gpu('mirror');
    // A/B under a cloudy sky: the same frame with the reflections off.
    const { default: sharp } = await import('sharp');
    await h.setParams({ cloudCoverage: 0.85 });
    await h.settle({ timeoutMs: 60000, minFrames: 20, idleFrames: 10 });
    await shot(path.join(dir, 'mirror-cloudy-on.png'));
    await h.setParams({ waterCloudReflection: 0 });
    await h.settle({ timeoutMs: 60000, minFrames: 20, idleFrames: 10 });
    await shot(path.join(dir, 'mirror-cloudy-off.png'));
    await gpu('mirror-off');
    await h.setParams({ waterCloudReflection: 1 });
    const raw = (name) => sharp(path.join(dir, name)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const [on, off] = await Promise.all([raw('mirror-cloudy-on.png'), raw('mirror-cloudy-off.png')]);
    const { width, height, channels } = on.info;
    let waterDiff = 0; let skyDiff = 0; let brighter = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * channels;
        const d = (Math.abs(on.data[i] - off.data[i]) + Math.abs(on.data[i + 1] - off.data[i + 1]) + Math.abs(on.data[i + 2] - off.data[i + 2])) / 3;
        if (y > height * 0.45) { waterDiff += d; brighter += on.data[i + 1] - off.data[i + 1]; } else skyDiff += d;
      }
    }
    const waterPixels = width * Math.round(height * 0.55);
    console.log('MIRROR-AB', JSON.stringify({
      waterMeanAbsDiff: +(waterDiff / waterPixels).toFixed(2),
      waterMeanBrighter: +(brighter / waterPixels).toFixed(2),
      skyMeanAbsDiff: +(skyDiff / (width * Math.round(height * 0.45))).toFixed(2),
    }));
  }

  // Procedural V2 across biomes: each preset gets its own stone and ground.
  if (steps.includes('biomes')) {
    for (const preset of (process.env.PRESETS || 'alpine,canyon,dunes,rolling').split(',')) {
      await page.evaluate(async ({ seed, presetKey }) => {
        await window.__engine.transitionMode({
          worldMode: 'studio', projectMode: 'procedural', reason: 'project-create',
          project: { projectMode: 'procedural', seed, presetKey },
        });
      }, { seed: Number(process.env.SEED || 8), presetKey: preset });
      await h.settle({ timeoutMs: 120000 });
      await h.setParams({ cloudsEnabled: false, waterMode: 'realistic', surfaceTextureSource: 'proceduralV2' });
      const state = await ready((s) => s.terrain.live === 'v2' && s.terrain.target === 'v2', `biome ${preset}`);
      console.log('BIOME', preset, JSON.stringify(state.terrain), JSON.stringify(state.shaderErrors));
      await views(`biome-${preset}`, [
        wide,
        ['mid', { radiusFactor: 0.42, phi: 66, theta: 30, target: [0, 120, 0] }],
        ['near', { radiusFactor: 0.12, phi: 72, theta: 210, target: [0.03, 150, 0.02] }],
      ]);
    }
  }

  // Everything together on the tile: V2 clouds, Cinematic water, V2 surface.
  if (steps.includes('hero')) {
    const heroWater = process.env.HERO_WATER || 'cinematic';
    const heroCloud = process.env.HERO_CLOUD || 'realisticV2';
    await h.setParams({
      cloudsEnabled: true, cloudRenderMode: heroCloud, cloudCoverage: 0.5,
      waterMode: heroWater, waterEnabled: true, surfaceTextureSource: 'proceduralV2',
    });
    const state = await ready(
      (s) => s.terrain.live === 'v2' && s.cloud?.active && s.water.effective === heroWater && !s.water.pending,
      'hero',
    );
    console.log('HERO', JSON.stringify(state));
    await views('hero', [wide, hill, shore]);
    await h.setPose(wide[1]);
    await gpu('hero');
    console.log('HERO-AFTER', JSON.stringify((await info()).cloud));
  }

  if (steps.includes('infinite')) {
    await h.setParams({ cloudsEnabled: true, cloudRenderMode: 'realisticV2', waterMode: 'realistic', surfaceTextureSource: 'proceduralV2' });
    console.log('to infinite', JSON.stringify(await page.evaluate(() => window.__h.transition('infinite'))));
    const state = await ready((s) => s.terrain.live === 'v2' && s.cloud?.active, 'infinite v2');
    console.log('INFINITE', JSON.stringify(state));
    await views('infinite-v2', [
      ['horizon', { position: [0, 520, 0], yaw: 35, pitch: -8 }],
      ['low', { position: [900, 260, -700], yaw: 140, pitch: -14 }],
      ['sky', { position: [0, 160, 0], yaw: 80, pitch: 24 }],
    ]);
    await gpu('infinite-v2');
  }
  console.log('FINAL', JSON.stringify(await info()));
}
