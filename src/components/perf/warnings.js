// ============================================================================
// Performance warning system. Pure function: takes a merged snapshot and
// returns a list of { level, label } where level ∈ 'info' | 'warning' |
// 'critical'. Threshold-based, no side effects, no logging. The overlay
// renders these as compact rows — never as popups/alerts.
// ============================================================================

export const WARN_THRESHOLDS = {
  fpsWarning: 45,
  fpsCritical: 30,
  frameWarning: 22,      // ms
  frameCritical: 33,     // ms
  drawCalls: 1500,
  triangles: 3_000_000,
  textures: 120,
  heapRatio: 0.85,       // used / limit
  chunks: 400,
  cloudSteps: 64,
  pixelRatio: 2.5,
  exportSeconds: 30,
};

export function computeWarnings(snap, T = WARN_THRESHOLDS) {
  const out = [];
  if (!snap) return out;
  const add = (level, label) => out.push({ level, label });

  const { fps, frame, render, gpu, memory, diag, tasks } = snap;

  // --- frame rate / time ---
  if (fps > 0 && fps < T.fpsCritical) add('critical', `FPS critical: ${fps}`);
  else if (fps > 0 && fps < T.fpsWarning) add('warning', `FPS low: ${fps}`);

  if (frame && frame.avg > T.frameCritical) add('critical', `Frame time ${frame.avg.toFixed(1)}ms (>${T.frameCritical}ms)`);
  else if (frame && frame.avg > T.frameWarning) add('warning', `Frame time ${frame.avg.toFixed(1)}ms`);

  // --- renderer load ---
  if (render) {
    if (render.calls > T.drawCalls) add('warning', `High draw calls: ${render.calls}`);
    if (render.triangles > T.triangles) add('warning', `High triangle count: ${fmtNum(render.triangles)}`);
    if (render.textures > T.textures) add('warning', `Many textures loaded: ${render.textures}`);
  }

  // --- memory ---
  if (memory && memory.supported && memory.jsHeapLimit) {
    const ratio = memory.usedJSHeap / memory.jsHeapLimit;
    if (ratio > T.heapRatio) add('critical', `JS heap usage high: ${(ratio * 100).toFixed(0)}%`);
  } else if (memory && !memory.supported) {
    add('info', 'Memory API unavailable');
  }

  // --- gpu timing ---
  if (gpu && !gpu.supported) add('info', 'GPU timing unavailable on this device');

  // --- scene / mode specific ---
  if (diag) {
    if (diag.pixelRatio > T.pixelRatio) add('warning', `Pixel ratio high: ${diag.pixelRatio.toFixed(2)}`);

    const renderer = diag.renderer || {};
    const caps = renderer.capabilities || {};
    if (renderer.requestedGpuPreference && renderer.requestedGpuPreference !== 'default') {
      add('info', `${renderer.requestedGpuPreferenceLabel || 'GPU'} preference requested; browser may ignore it`);
    }
    if (renderer.requestedBackend === 'webgpu' && caps.webgpu && !caps.webgpu.supported) {
      add('warning', 'WebGPU selected but unavailable, falling back to WebGL');
    } else if (renderer.requestedBackend === 'webgpu' && renderer.activeBackend !== 'webgpu') {
      add('info', 'WebGPU selected, but this build is using WebGL');
    }
    if (caps.gpuInfoAvailable === false) {
      add('info', 'GPU name unavailable because browser blocked debug renderer info');
    }
    if (renderer.reloadRequired) add('info', 'Renderer preference change requires reload');

    const total = diag.culling?.total ?? 0;
    if (total > T.chunks) add('warning', `Many chunks active: ${total}`);

    if (diag.clouds?.enabled) {
      if (diag.clouds.steps > T.cloudSteps) add('warning', `Cloud raymarch steps high: ${diag.clouds.steps}`);
      if (diag.clouds.lod === 'none') add('info', 'Cloud LOD disabled');
      add('info', `Cloud culling: ${diag.clouds.cullingMode}`);
    }

    if (diag.water?.enabled) {
      if (/realistic|volumetric/i.test(diag.water.mode || '')) add('info', `${diag.water.mode} water may be expensive`);
    }

    const uw = diag.underwater;
    if (uw && uw.active) {
      if (uw.mode === 'high') add('warning', 'High underwater mode active');
      else add('info', 'Lite underwater mode active');
      if (uw.fellBackToLite) add('info', 'High underwater requested — falling back to Lite (legacy water)');
      if (uw.causticsEnabled) add('info', 'Underwater caustics enabled');
      if (uw.lightShaftsEnabled) add('warning', 'Underwater light shafts enabled');
      if (uw.particlesEnabled) add('info', 'Underwater particles enabled');
      if (uw.depthTextureAvailable === false) add('warning', 'Depth texture unavailable — simplified underwater fog');
    }
  }

  // --- long-running tasks ---
  if (Array.isArray(tasks)) {
    for (const t of tasks) {
      if (t.status === 'running' && t.elapsed > T.exportSeconds * 1000) {
        add('warning', `${t.name} running ${(t.elapsed / 1000).toFixed(0)}s`);
      }
      if (t.status === 'failed') add('critical', `${t.name} failed`);
    }
  }

  return out;
}

function fmtNum(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
