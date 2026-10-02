// ============================================================================
// In-page side of the performance harness. Boots a main-thread Engine on a
// fixed 1280×720 canvas, then exposes `window.__h` so the Playwright driver can
// step frames deterministically, time CPU / GPU / serialized frame cost,
// settle streaming work and capture repeatable screenshots.
//
// Nothing here changes engine behaviour: the driver only replaces the engine
// clock (fixed dt) and pumps `_tick()` itself instead of requestAnimationFrame.
// ============================================================================
import { Engine } from '/src/engine/EnergySavingEngine.js';
import { createPerfSettings } from '/src/engine/render/PerformanceSettings.js';

const qs = new URLSearchParams(location.search);
const config = JSON.parse(qs.get('config') || '{}');

// Optional: record every WebGL call that blocks the calling thread > 50 ms.
const slowGL = [];
window.__slowGL = slowGL;
if (config.instrumentGL) {
  const proto = WebGL2RenderingContext.prototype;
  for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (typeof d?.value !== 'function' || name === 'constructor') continue;
    const original = d.value;
    proto[name] = function (...args) {
      const t0 = performance.now();
      const v = original.apply(this, args);
      const ms = performance.now() - t0;
      if (ms > 50) {
        slowGL.push({
          name, ms: Math.round(ms), at: Math.round(t0),
          stack: new Error().stack.split('\n').slice(2, 12).map((x) => x.trim().replace(/https?:\/\/[^/]+/, '').replace(/\?v=[0-9a-f]+/, '')).join(' | '),
        });
      }
      return v;
    };
  }
}
const canvas = document.getElementById('c');
const log = [];
const consoleLines = [];
for (const level of ['info', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    try { consoleLines.push({ level, t: Math.round(performance.now()), text: args.map(String).join(' ').slice(0, 400) }); } catch { /* ignore */ }
    original(...args);
  };
}

let resolveBoot;
let rejectBoot;
const bootPromise = new Promise((resolve, reject) => { resolveBoot = resolve; rejectBoot = reject; });
const bootStarted = performance.now();
let bootMs = null;

const callbacks = new Proxy({
  onBootComplete: () => { bootMs = performance.now() - bootStarted; resolveBoot(); },
  onBootError: (error) => rejectBoot(new Error(error?.message || 'boot failed')),
}, {
  get(target, key) {
    if (key in target) return target[key];
    return () => {};
  },
  has() { return true; },
});

const perf = {
  ...createPerfSettings(config.preset || 'high'),
  autoPerf: false,
  useWorker: false,
  energyMode: 'off',
  ...(config.perf || {}),
};

const engine = new Engine({
  canvas,
  callbacks,
  initialParams: { seed: 1337, ...(config.params || {}) },
  initialPerf: perf,
  perfSettingsStored: true,
  initialView: 'editor',
  coldShaderRun: config.coldShaderRun ?? null,
});
window.__engine = engine;

const renderer = engine.renderer;
const gl = renderer.getContext();
const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
// WebGL sync objects (the engine's GpuFramePacer fence) only update their
// status after control returns to the event loop, so every frame must yield a
// full task or the pacer skips the next draw. MessageChannel avoids the 4ms
// setTimeout clamp.
const yieldChannel = new MessageChannel();
const yieldQueue = [];
yieldChannel.port1.onmessage = () => yieldQueue.shift()?.();
const yieldTask = () => new Promise((resolve) => { yieldQueue.push(resolve); yieldChannel.port2.postMessage(0); });

// Accumulate draw calls / triangles over EVERY render() of a frame (main pass,
// reflections, post passes) — renderer.info auto-resets per render call.
const frameStats = { calls: 0, triangles: 0, renders: 0 };
{
  const baseRender = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    const result = baseRender(scene, camera);
    window.__sceneRenders = (window.__sceneRenders || 0) + 1;
    frameStats.calls += renderer.info.render.calls;
    frameStats.triangles += renderer.info.render.triangles;
    frameStats.renders++;
    return result;
  };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --------------------------------------------------------------- clock control
let fakeDt = 1 / 60;
let frozen = false;
const realClock = engine._clock;
const fakeClock = {
  update() {}, getDelta: () => fakeDt, getElapsed: () => 0,
  reset() {}, start() {}, stop() {}, connect() {}, dispose() {},
};

function freeze() {
  if (frozen) return;
  frozen = true;
  renderer.setAnimationLoop(null);
  engine._clock = fakeClock;
  engine._debug.forceRender = true;
  engine.setPerformanceProfilerActive?.(false);
}

function unfreeze() {
  if (!frozen) return;
  frozen = false;
  engine._clock = realClock;
  engine._debug.forceRender = false;
  renderer.setAnimationLoop(() => engine._tick());
}

function tickOnce(dt = 1 / 60) {
  fakeDt = dt;
  frameStats.calls = 0;
  frameStats.triangles = 0;
  frameStats.renders = 0;
  engine._needsRender = true;
  engine._lastUserActivityAt = performance.now();
  engine._tick();
}

const px = new Uint8Array(4);
function syncGpu() {
  // A 1-pixel readback from the default framebuffer drains every queued GL
  // command for the frame: the elapsed time is the serialized CPU+GPU cost.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
}

// ------------------------------------------------------------------- state
function worldState() {
  const e = engine;
  const s = {
    mode: e.worldMode,
    compiling: e._compiling || 0,
    bootPending: !!e._bootPending,
    transition: !!e._modeTransitionCoordinator?.active,
    bgWork: e._bgWork ? [...e._bgWork.values()] : [],
    props: e.propsManager?.getDiagnostics?.()?.queuedSectors ?? 0,
    detailPending: (e._detailPageCache?.pending?.size ?? 0) + (e._detailPageCache?.readyQueue?.length ?? 0),
    surfaceReveal: e._surfaceReveal ?? null,
    baking: e.worldMode === 'studio'
      ? !!e.terrainHeightBaker?.isBaking || !!e._terrainHeightPreparePromise || !!e._nearHeightCache?.isBaking
      : e.worldMode === 'planet' ? !!e.planetHeightBaker?.isBaking : false,
  };
  if (e.worldMode === 'studio' && e.board) {
    s.building = !!e.board.isBuilding;
    s.lodQueue = e.board._lodRebuildQueue?.length ?? 0;
  } else if (e.worldMode === 'infinite' && e.infiniteWorld) {
    s.pendingChunks = (e.infiniteWorld.pendingChunkCount ?? 0) + (e.infiniteWorld.morphingChunkCount ?? 0);
  } else if (e.worldMode === 'planet' && e.planetWorld) {
    s.pendingChunks = (e.planetWorld.pendingChunkCount ?? 0) + (e.planetWorld.morphingChunkCount ?? 0);
  }
  return s;
}

function isIdle(s) {
  return !s.compiling && !s.bootPending && !s.transition && s.bgWork.length === 0
    && !s.props && !s.detailPending && !s.building && !s.lodQueue && !s.pendingChunks
    && !s.baking;
}

async function settle({ timeoutMs = 120000, idleFrames = 40, minFrames = 60 } = {}) {
  freeze();
  const started = performance.now();
  let idleRun = 0;
  let frames = 0;
  let last = worldState();
  while (performance.now() - started < timeoutMs) {
    tickOnce(1 / 60);
    syncGpu();
    frames++;
    // Real time must pass for worker results, compile polling and throttles.
    await sleep(8);
    last = worldState();
    idleRun = isIdle(last) ? idleRun + 1 : 0;
    if (idleRun >= idleFrames && frames >= minFrames) break;
  }
  return { ms: Math.round(performance.now() - started), frames, idle: isIdle(last), state: last };
}

// --------------------------------------------------------------- camera poses
const DEG = Math.PI / 180;
function setPose(pose = {}) {
  const e = engine;
  if (e.worldMode === 'studio' && e.controls) {
    const c = e.controls;
    const size = e.boardSize || 2048;
    const radius = pose.radiusFactor != null ? size * pose.radiusFactor : (pose.radius ?? size * 1.4);
    c.autoOrbit = false;
    c.mode = 'orbit';
    c.goalRadius = c.radius = radius;
    c.goalPhi = c.phi = (pose.phi ?? 55) * DEG;
    c.goalTheta = c.theta = (pose.theta ?? 45) * DEG;
    const t = pose.target || [0, 0, 0];
    c.goalTarget.set(t[0] * size, t[1], t[2] * size);
    c.target.copy(c.goalTarget);
    c._smoothRate = null;
    c.update?.(1);
  } else if (e.worldMode === 'infinite') {
    const p = pose.position || [0, 450, 0];
    e.camera.position.set(p[0], p[1], p[2]);
    if (e.fpsControls) {
      e.fpsControls.yaw = (pose.yaw ?? 0) * DEG;
      e.fpsControls.pitch = (pose.pitch ?? -10) * DEG;
      e.fpsControls.velocity?.set?.(0, 0, 0);
      e.fpsControls.update?.(0);
    }
  } else if (e.worldMode === 'planet' && e.planetControls) {
    const c = e.planetControls;
    const r = c.planetRadius || e.params.planetRadius || 16000;
    c.goalDist = c.dist = r * (pose.distFactor ?? 2.6);
    c.goalPhi = c.phi = (pose.phi ?? 65) * DEG;
    c.goalTheta = c.theta = (pose.theta ?? 35) * DEG;
    c.update?.(1);
  }
  e.camera.updateMatrixWorld(true);
  e._lastLodUpdate = 0;
  e._needsRender = true;
}

// ------------------------------------------------------------- measurement
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}
function summarize(values) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return null;
  const sorted = [...v].sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return {
    n: v.length,
    mean: +mean.toFixed(3),
    median: +percentile(sorted, 0.5).toFixed(3),
    p95: +percentile(sorted, 0.95).toFixed(3),
    p99: +percentile(sorted, 0.99).toFixed(3),
    max: +sorted[sorted.length - 1].toFixed(3),
  };
}

function interpolatePose(path, t) {
  // linear interpolation between key poses (numbers and arrays)
  const n = path.length - 1;
  const f = Math.min(n - 1e-9, Math.max(0, t * n));
  const i = Math.floor(f);
  const k = f - i;
  const a = path[i];
  const b = path[i + 1];
  const out = {};
  for (const key of Object.keys(a)) {
    const va = a[key];
    const vb = b[key] ?? va;
    if (Array.isArray(va)) out[key] = va.map((x, j) => x + (vb[j] - x) * k);
    else if (typeof va === 'number') out[key] = va + (vb - va) * k;
    else out[key] = va;
  }
  return out;
}

// Per-pass GPU attribution: wraps renderer.render so every scene draw gets its
// own timer query (the whole-frame query is disabled in this mode because
// TIME_ELAPSED queries cannot nest).
function labelFor(scene, camera, target) {
  const s = scene?.name || scene?.type || 'scene';
  const t = target ? `${target.width}x${target.height}` : 'canvas';
  const kids = scene?.children?.length ?? 0;
  const first = scene?.children?.find?.((c) => c.visible)?.name || '';
  return `${s}[${kids}${first ? ':' + first : ''}]→${t}`;
}

async function breakdown({ frames = 30, path = null, dt = 1 / 60 } = {}) {
  freeze();
  const original = renderer.render.bind(renderer);
  const records = [];
  const cpuByLabel = new Map();
  renderer.render = (scene, camera) => {
    const target = renderer.getRenderTarget();
    const label = labelFor(scene, camera, target);
    const q = timerExt ? gl.createQuery() : null;
    if (q) gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q);
    const c0 = performance.now();
    try { return original(scene, camera); } finally {
      const c1 = performance.now();
      if (q) gl.endQuery(timerExt.TIME_ELAPSED_EXT);
      records.push({ label, q, calls: renderer.info.render.calls, tris: renderer.info.render.triangles });
      cpuByLabel.set(label, (cpuByLabel.get(label) || 0) + (c1 - c0));
    }
  };
  try {
    for (let i = 0; i < frames; i++) {
      if (path) setPose(interpolatePose(path, i / Math.max(1, frames - 1)));
      tickOnce(dt);
      syncGpu();
      await yieldTask();
    }
  } finally {
    renderer.render = original;
  }
  await sleep(30);
  const byLabel = new Map();
  for (const r of records) {
    const entry = byLabel.get(r.label) || { label: r.label, count: 0, gpuMs: 0, calls: 0, tris: 0 };
    entry.count++;
    entry.calls += r.calls;
    entry.tris += r.tris;
    if (r.q) {
      if (gl.getQueryParameter(r.q, gl.QUERY_RESULT_AVAILABLE)) entry.gpuMs += gl.getQueryParameter(r.q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(r.q);
    }
    byLabel.set(r.label, entry);
  }
  return [...byLabel.values()].map((e) => ({
    label: e.label,
    perFrame: +(e.count / frames).toFixed(2),
    gpuMsPerFrame: +(e.gpuMs / frames).toFixed(3),
    cpuMsPerFrame: +((cpuByLabel.get(e.label) || 0) / frames).toFixed(3),
    drawCallsPerFrame: +(e.calls / frames).toFixed(1),
    trisPerFrame: Math.round(e.tris / frames),
  })).sort((a, b) => b.gpuMsPerFrame - a.gpuMsPerFrame);
}

async function measure({ frames = 120, warmup = 20, path = null, dt = 1 / 60 } = {}) {
  freeze();
  const queries = [];
  const cpu = [];
  const total = [];
  const tris = [];
  const draws = [];
  const passes = [];
  let skipped = 0;
  const count = warmup + frames;
  for (let i = 0; i < count; i++) {
    if (path) setPose(interpolatePose(path, i / Math.max(1, count - 1)));
    let q = null;
    if (timerExt) {
      q = gl.createQuery();
      gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q);
    }
    const t0 = performance.now();
    tickOnce(dt);
    const t1 = performance.now();
    if (q) gl.endQuery(timerExt.TIME_ELAPSED_EXT);
    syncGpu();
    const t2 = performance.now();
    if (frameStats.renders === 0) skipped++;
    if (i >= warmup) {
      cpu.push(t1 - t0);
      total.push(t2 - t0);
      queries.push(q);
      tris.push(frameStats.triangles);
      draws.push(frameStats.calls);
      passes.push(frameStats.renders);
    } else if (q) {
      queries.push(null);
      gl.deleteQuery(q);
    }
    // let fences signal + worker messages run between frames (not timed)
    await yieldTask();
  }
  // collect GPU timer results (they are ready after the sync)
  const gpu = [];
  let disjoint = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const pending = queries.filter((q) => q && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE));
    if (!pending.length) break;
    await sleep(10);
  }
  if (timerExt) disjoint = !!gl.getParameter(timerExt.GPU_DISJOINT_EXT);
  for (const q of queries) {
    if (!q) continue;
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(q);
  }
  return {
    frameMs: summarize(total),
    cpuMs: summarize(cpu),
    gpuMs: summarize(gpu),
    gpuDisjoint: disjoint,
    triangles: summarize(tris),
    drawCalls: summarize(draws),
    renderPasses: summarize(passes),
    skippedFrames: skipped,
  };
}

// ------------------------------------------------------------- LOD pop test
// At every pose along a slow camera move (animation frozen, dt = 0) the frame
// is rendered twice: A with the previous LOD selection frozen, B after LOD is
// re-selected for this pose. A and B share camera, time and streaming state,
// so |A - B| is exactly the visible change caused by LOD swaps/folds ("pops").
// Perfect geomorphing makes it zero.
function readLuma(buf, w, hgt) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, w, hgt, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const out = new Float32Array(w * hgt);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = 0.299 * buf[j] + 0.587 * buf[j + 1] + 0.114 * buf[j + 2];
  }
  return out;
}

function setLodFrozen(frozen) {
  const e = engine;
  e._debug.freezeLod = frozen;
  const w = e.infiniteWorld;
  if (w) {
    if (frozen && !w.__origUpdateLOD) {
      w.__origUpdateLOD = w._updateLOD;
      w._updateLOD = () => {};
    } else if (!frozen && w.__origUpdateLOD) {
      w._updateLOD = w.__origUpdateLOD;
      delete w.__origUpdateLOD;
    }
  }
}

async function popTest({ path, frames = 240 } = {}) {
  freeze();
  const w = gl.drawingBufferWidth;
  const hgt = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * hgt * 4);
  const perFrame = [];
  let changedFrames = 0;
  // state that can change the image without any LOD change (bakes publishing,
  // terrain generation): recorded on both sides of the worst frame
  const snap = () => ({
    gen: engine._terrainGen,
    planetBake: engine.planetHeightBaker?.phase ?? null,
    planetHeight: engine.uniforms.uUsePlanetHeightTex?.value,
    planetClimate: engine.uniforms.uUsePlanetClimateTex?.value,
    studioBake: engine.uniforms.uUseTerrainHeightTex?.value,
    nearBake: engine.uniforms.uUseNearBake?.value,
    renders: frameStats.renders,
  });
  let worst = { overPct: -1 };
  for (let i = 0; i < frames; i++) {
    setPose(interpolatePose(path, i / Math.max(1, frames - 1)));
    // each render needs its own task so the engine's GPU fence can signal
    // (otherwise the second tick is skipped as back-pressure)
    setLodFrozen(true);
    tickOnce(0);
    if (!frameStats.renders) { await yieldTask(); tickOnce(0); }
    const a = readLuma(buf, w, hgt);
    const stateA = snap();
    await yieldTask();
    setLodFrozen(false);
    engine._lastLodUpdate = 0;
    // temporal geomorphs (Planet / Infinite) advance on wall time: emulate a
    // 60 fps frame for the LOD step while animation stays frozen (dt = 0)
    const lodStepFrom = performance.now() - 1000 / 60;
    if (engine.planetWorld) engine.planetWorld._lastUpdateAt = lodStepFrom;
    if (engine.infiniteWorld) engine.infiniteWorld._lastLodStepAt = lodStepFrom;
    tickOnce(0);
    if (!frameStats.renders) { await yieldTask(); engine._lastLodUpdate = 0; tickOnce(0); }
    const b = readLuma(buf, w, hgt);
    let sum = 0;
    let over = 0;
    for (let k = 0; k < a.length; k++) {
      const d = Math.abs(a[k] - b[k]);
      sum += d;
      if (d > 16) over++;
    }
    const meanPct = sum / a.length / 255 * 100;
    const overPct = over / a.length * 100;
    perFrame.push({ meanPct, overPct });
    if (overPct > worst.overPct) worst = { frame: i, overPct: +overPct.toFixed(4), meanPct: +meanPct.toFixed(4), a: stateA, b: snap() };
    if (overPct > 0.01) changedFrames++;
    await yieldTask();
  }
  setLodFrozen(false);
  const sortedMean = perFrame.map((f) => f.meanPct).sort((x, y) => x - y);
  const sortedOver = perFrame.map((f) => f.overPct).sort((x, y) => x - y);
  return {
    frames,
    popFrames: changedFrames,
    maxPopMeanPct: +sortedMean[sortedMean.length - 1].toFixed(4),
    maxPopPixelsPct: +sortedOver[sortedOver.length - 1].toFixed(4),
    totalPopPixelsPct: +perFrame.reduce((acc, f) => acc + f.overPct, 0).toFixed(4),
    worst,
  };
}

// ----------------------------------------------------------------- capture
function setAnimationTime(t) {
  const e = engine;
  e.uniforms.uTime.value = t;
  for (const layer of [e.studioCloud, e.infiniteCloud, e.planetCloudLayer]) {
    const u = layer?.material?.uniforms;
    if (u?.uCloudTime) u.uCloudTime.value = t * 0.5;
    if (layer && '_rotation' in layer) layer._rotation = 0;
    if (layer && '_occBuiltAt' in layer) layer._occBuiltAt = 0;
  }
  if (e.propsManager?.tickWind) {
    const original = e.propsManager.__origTickWind || e.propsManager.tickWind.bind(e.propsManager);
    e.propsManager.__origTickWind = original;
    e.propsManager.tickWind = (_t, params) => original(t, params);
  }
}

async function capture({ time = 12.5 } = {}) {
  freeze();
  setAnimationTime(time);
  for (let i = 0; i < 4; i++) { tickOnce(0); syncGpu(); await yieldTask(); }
  tickOnce(0);
  const url = canvas.toDataURL('image/png');
  return url;
}

// ------------------------------------------------------------------ memory
function memory() {
  const info = renderer.info;
  let geometryBytes = 0;
  const seenGeo = new Set();
  const seenTex = new Set();
  let textureBytes = 0;
  const texBytes = (tex) => {
    if (!tex || seenTex.has(tex)) return;
    seenTex.add(tex);
    const img = tex.image || {};
    const w = img.width || 0;
    const h = img.height || 0;
    const d = img.depth || (tex.isCubeTexture ? 6 : 1);
    const bpt = { 1009: 1, 1015: 4, 1016: 2, 1013: 1, 1014: 4, 1012: 2 }[tex.type] || 1;
    const ch = { 1023: 4, 1028: 1, 1030: 2, 1022: 3, 1024: 1, 1025: 1 }[tex.format] || 4;
    const mips = tex.generateMipmaps && tex.minFilter !== 1006 && tex.minFilter !== 1003 ? 4 / 3 : 1;
    textureBytes += w * h * d * bpt * ch * mips;
  };
  engine.scene.traverse((obj) => {
    const g = obj.geometry;
    if (g && !seenGeo.has(g)) {
      seenGeo.add(g);
      for (const attr of Object.values(g.attributes || {})) geometryBytes += attr.array?.byteLength || 0;
      if (g.index) geometryBytes += g.index.array.byteLength;
    }
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      for (const u of Object.values(m.uniforms || {})) {
        const v = u?.value;
        if (v?.isTexture) texBytes(v);
      }
    }
  });
  const ledger = engine._gpuResourceLedger?.snapshot?.();
  return {
    jsHeapUsed: performance.memory?.usedJSHeapSize ?? null,
    jsHeapTotal: performance.memory?.totalJSHeapSize ?? null,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs?.length ?? null,
    sceneGeometryBytes: geometryBytes,
    sceneTextureBytes: Math.round(textureBytes),
    renderTargetLedgerBytes: ledger?.totalBytes ?? null,
  };
}

async function gcAndMemory() {
  if (typeof window.gc === 'function') { window.gc(); await sleep(50); window.gc(); }
  return memory();
}

async function transition(mode) {
  unfreeze();
  const started = performance.now();
  await engine.transitionMode({ worldMode: mode });
  return { ms: Math.round(performance.now() - started) };
}

async function setParams(patch = {}) {
  unfreeze();
  for (const [k, v] of Object.entries(patch)) engine.setParam(k, v);
  await sleep(50);
}

async function setPerf(patch = {}) {
  unfreeze();
  for (const [k, v] of Object.entries(patch)) engine.setPerfSetting(k, v);
  await sleep(50);
}

window.__h = {
  config,
  log,
  consoleLines,
  boot: async () => {
    await bootPromise;
    return { bootMs: Math.round(bootMs), gpu: engine.gpuNameFull, tier: engine.gpuTier, preset: engine.perf?.preset };
  },
  state: worldState,
  freeze, unfreeze, settle, setPose, measure, breakdown, popTest, capture, memory, gcAndMemory, transition, setParams, setPerf,
  diagnostics: () => {
    const d = engine.getPerfDiagnostics();
    return { mode: d.mode, terrain: d.terrain, culling: d.culling, lod: d.lod, merge: d.merge, props: d.props, water: { mode: d.water?.mode } };
  },
};
window.__harnessReady = true;
