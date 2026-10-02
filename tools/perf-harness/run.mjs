// ============================================================================
// Terrain Studio performance harness (driver).
//
//   node tools/perf-harness/run.mjs --label baseline
//   node tools/perf-harness/run.mjs --label it3 --scenes studio,planet --skip-boot
//   node tools/perf-harness/run.mjs --label it3 --boot-only
//
// Runtime scenes: Vite dev server + tools/perf-harness/harness.html (main-thread
// Engine, manual frame pumping, warm persistent browser profile so shader
// programs come from Chrome's disk cache and timings are not compile-bound).
// Boot: production build (vite build + vite preview) of the real app, worker
// renderer, fresh (cold) and reused (warm) browser profiles; records
// time-to-ready, main-thread long tasks and rAF gaps (UI freezes).
//
// Output: output/perf-harness/runs/<label>/{results.json, shots/*.png}
// ============================================================================
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { SCENES } from './scenes.mjs';
import { sampleBrowserMemory } from './sysmem.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const label = opt('label', `run-${Date.now()}`);
const sceneFilter = opt('scenes') ? String(opt('scenes')).split(',') : null;
const viewFilter = opt('views') ? String(opt('views')).split(',') : null;
const skipBoot = !!opt('skip-boot');
const bootOnly = !!opt('boot-only');
const skipRuntime = bootOnly;
const channel = opt('channel', 'msedge');
const devPort = Number(opt('dev-port', 6071));
const previewPort = Number(opt('preview-port', 6072));
const measureFrames = Number(opt('frames', 120));
const bootRepeats = Number(opt('boot-repeats', 1));
const skipBuild = !!opt('skip-build');
const withBreakdown = !!opt('breakdown');
const popOnly = !!opt('pop-only');
const withPop = !!opt('pop') || popOnly;
// Best-of-N: each view/path is measured N times and the repetition with the
// lowest median frame time is kept (filters background interference).
const repeats = Math.max(1, Number(opt('repeat', 2)));
const bestOf = (list) => list.reduce((best, m) => ((m.frameMs?.median ?? Infinity) < (best.frameMs?.median ?? Infinity) ? m : best));

const OUT = path.join(ROOT, 'output', 'perf-harness', 'runs', label);
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const WARM_PROFILE = path.join(ROOT, 'output', 'perf-harness', '.profile-warm');

const BROWSER_ARGS = [
  '--ignore-gpu-blocklist',
  '--enable-gpu',
  '--use-angle=d3d11',
  '--enable-precise-memory-info',
  '--js-flags=--expose-gc',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--force-device-scale-factor=1',
  ...(args.includes('--extra-args') ? String(args[args.indexOf('--extra-args') + 1]).split(' ') : []),
];

const log = (...a) => console.log(`[harness ${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---------------------------------------------------------------- servers
function startServer(cmdArgs, readyRe, name) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, cmdArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const logFile = fs.createWriteStream(path.join(OUT, `${name}.log`));
    let done = false;
    const onData = (buf) => {
      const text = buf.toString();
      logFile.write(text);
      if (!done && readyRe.test(text.replace(/\x1b\[[0-9;]*m/g, ''))) { done = true; resolve(child); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (b) => { onData(b); if (!done) process.stderr.write(`[${name}] ${b}`); });
    child.on('exit', (code) => { if (!done) reject(new Error(`${name} exited (${code})`)); });
    setTimeout(() => { if (!done) reject(new Error(`${name} did not start`)); }, 180000);
  });
}

function runNode(cmdArgs, name) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, cmdArgs, { cwd: ROOT, stdio: 'inherit', windowsHide: true });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${name} failed (${code})`))));
  });
}

function killTree(child) {
  if (!child || child.exitCode != null) return;
  try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { child.kill(); }
}

// -------------------------------------------------------------- runtime
async function runRuntime(results) {
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  log(`starting vite dev server on ${devPort}`);
  const server = await startServer([vite, '--port', String(devPort), '--strictPort', '--host', '127.0.0.1'], /Local:|ready in/i, 'vite');
  const base = `http://127.0.0.1:${devPort}`;
  const context = await chromium.launchPersistentContext(WARM_PROFILE, {
    channel, headless: true, args: BROWSER_ARGS, viewport: { width: 1280, height: 720 },
  });
  try {
    // Warm Vite's dependency optimizer + transforms once (not measured).
    {
      const page = await context.newPage();
      await page.goto(`${base}/tools/perf-harness/harness.html?config=${encodeURIComponent(JSON.stringify({ preset: 'high' }))}`);
      await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 180000 }).catch(() => {});
      await page.evaluate(() => window.__h?.boot()).catch(() => {});
      await page.close();
    }
    for (const scene of SCENES) {
      if (sceneFilter && !sceneFilter.includes(scene.id)) continue;
      for (let attempt = 0; attempt < 2; attempt++) {
        const ok = await runScene(context, base, scene, results);
        if (ok) break;
        log(`  retrying scene ${scene.id}`);
      }
    }
  } finally {
    await context.close().catch(() => {});
    killTree(server);
  }
}

async function runScene(context, base, scene, results) {
  {
      log(`scene ${scene.id}`);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
      const sceneResult = { id: scene.id, label: scene.label, views: {}, paths: {}, errors };
      try {
        const t0 = Date.now();
        await page.goto(`${base}/tools/perf-harness/harness.html?config=${encodeURIComponent(JSON.stringify(scene.config))}`);
        await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 180000 });
        sceneResult.boot = await page.evaluate(() => window.__h.boot());
        sceneResult.boot.pageMs = Date.now() - t0;
        log(`  booted in ${sceneResult.boot.bootMs}ms (${sceneResult.boot.preset}, ${sceneResult.boot.gpu})`);
        if (scene.mode) {
          sceneResult.transition = await page.evaluate((m) => window.__h.transition(m), scene.mode);
          log(`  mode ${scene.mode} in ${sceneResult.transition.ms}ms`);
        }
        for (const view of scene.views) {
          if (popOnly || (viewFilter && !viewFilter.includes(view.id))) continue;
          await page.evaluate((p) => window.__h.setPose(p), view.pose);
          const settle = await page.evaluate(() => window.__h.settle({ timeoutMs: 150000 }));
          await page.evaluate((p) => window.__h.setPose(p), view.pose);
          const shot = await page.evaluate(() => window.__h.capture());
          const file = path.join(SHOTS, `${scene.id}--${view.id}.png`);
          fs.writeFileSync(file, Buffer.from(shot.split(',')[1], 'base64'));
          const reps = [];
          for (let k = 0; k < repeats; k++) {
            await page.evaluate((p) => window.__h.setPose(p), view.pose);
            reps.push(await page.evaluate((n) => window.__h.measure({ frames: n, warmup: 20 }), measureFrames));
          }
          const m = { ...bestOf(reps), repeats: reps.map((r) => r.frameMs?.median) };
          const diag = await page.evaluate(() => window.__h.diagnostics());
          sceneResult.views[view.id] = { settle, ...m, diag };
          if (withBreakdown) sceneResult.views[view.id].breakdown = await page.evaluate(() => window.__h.breakdown({ frames: 30 }));
          log(`  view ${view.id}: frame ${m.frameMs?.mean}ms (cpu ${m.cpuMs?.mean} gpu ${m.gpuMs?.mean}) tris ${m.triangles?.mean} draws ${m.drawCalls?.mean} settle ${settle.ms}ms idle=${settle.idle}`);
        }
        for (const p of scene.paths || []) {
          if (popOnly || (viewFilter && !viewFilter.includes(p.id))) continue;
          await page.evaluate((pose) => window.__h.setPose(pose), p.path[0]);
          await page.evaluate(() => window.__h.settle({ timeoutMs: 90000, idleFrames: 20, minFrames: 30 }));
          // Paths run once: a second pass would find every chunk/LOD already
          // streamed and hide exactly the hitches the path exists to measure.
          const reps = [];
          for (let k = 0; k < 1; k++) {
            await page.evaluate((pose) => window.__h.setPose(pose), p.path[0]);
            reps.push(await page.evaluate(({ frames, path: pth }) => window.__h.measure({ frames, warmup: 0, path: pth }), { frames: p.frames, path: p.path }));
          }
          const m = { ...bestOf(reps), repeats: reps.map((r) => r.frameMs?.median) };
          sceneResult.paths[p.id] = m;
          if (withBreakdown) {
            await page.evaluate((pose) => window.__h.setPose(pose), p.path[0]);
            m.breakdown = await page.evaluate(({ frames, path: pth }) => window.__h.breakdown({ frames, path: pth }), { frames: p.frames, path: p.path });
          }
          log(`  path ${p.id}: frame ${m.frameMs?.mean}ms p95 ${m.frameMs?.p95} max ${m.frameMs?.max} (cpu ${m.cpuMs?.mean} p95 ${m.cpuMs?.p95})`);
        }
        if (withPop && scene.popPath) {
          await page.evaluate((pose) => window.__h.setPose(pose), scene.popPath.path[0]);
          await page.evaluate(() => window.__h.settle({ timeoutMs: 90000, idleFrames: 20, minFrames: 30 }));
          sceneResult.pop = await page.evaluate((p) => window.__h.popTest(p), scene.popPath);
          log(`  LOD pops: ${sceneResult.pop.popFrames}/${sceneResult.pop.frames} frames, worst ${sceneResult.pop.maxPopPixelsPct}% px changed (mean ${sceneResult.pop.maxPopMeanPct}%), total ${sceneResult.pop.totalPopPixelsPct}%`);
        }
        sceneResult.memory = await page.evaluate(() => window.__h.gcAndMemory());
        sceneResult.system = await sampleBrowserMemory(WARM_PROFILE);
        log(`  memory heap ${(sceneResult.memory.jsHeapUsed / 1048576).toFixed(1)}MB geo ${(sceneResult.memory.sceneGeometryBytes / 1048576).toFixed(1)}MB tex ${(sceneResult.memory.sceneTextureBytes / 1048576).toFixed(1)}MB vram ${sceneResult.system ? (sceneResult.system.gpuDedicatedBytes / 1048576).toFixed(0) : '?'}MB`);
        sceneResult.console = await page.evaluate(() => window.__h.consoleLines.filter((l) => l.level !== 'info' || /\[boot\]|\[mode\]|\[shader/.test(l.text)).slice(-60));
      } catch (error) {
        sceneResult.failed = String(error?.message || error).slice(0, 500);
        log(`  FAILED: ${sceneResult.failed}`);
      } finally {
        await page.close().catch(() => {});
      }
      results.scenes[scene.id] = sceneResult;
      fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
      return !/Execution context was destroyed|navigation/i.test(sceneResult.failed || '');
  }
}

// ----------------------------------------------------------------- boot
const BOOT_PROBE = () => {
  const s = { longTasks: [], rafGaps: [], bootStates: [], start: performance.now() };
  window.__bootProbe = s;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) s.longTasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* unsupported */ }
  let last = performance.now();
  const frame = (now) => {
    const gap = now - last;
    if (gap > 50) s.rafGaps.push({ t: Math.round(last), d: Math.round(gap) });
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const watch = () => {
    const c = document.querySelector('canvas[data-boot-state]');
    const state = c?.dataset.bootState || null;
    const prev = s.bootStates[s.bootStates.length - 1]?.state;
    if (state && state !== prev) s.bootStates.push({ state, t: Math.round(performance.now()) });
  };
  new MutationObserver(watch).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-boot-state'], childList: true });
  setInterval(watch, 50);
};

const bootMainThread = !!opt('boot-main-thread');
async function bootOnce(base, profileDir, kind) {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel, headless: true, args: BROWSER_ARGS, viewport: { width: 1280, height: 720 },
  });
  try {
    await context.addInitScript(BOOT_PROBE);
    if (opt('boot-instrument-gl')) {
      await context.addInitScript(() => {
        const slow = [];
        window.__slowGL = slow;
        for (const Ctx of [globalThis.WebGL2RenderingContext]) {
          if (!Ctx) continue;
          const proto = Ctx.prototype;
          for (const name of Object.getOwnPropertyNames(proto)) {
            const d = Object.getOwnPropertyDescriptor(proto, name);
            if (typeof d?.value !== 'function' || name === 'constructor') continue;
            const original = d.value;
            proto[name] = function (...a) {
              const t0 = performance.now();
              const v = original.apply(this, a);
              const ms = performance.now() - t0;
              if (ms > 50) slow.push({ name, ms: Math.round(ms), at: Math.round(t0), stack: new Error().stack.split('\n').slice(2, 14).map((x) => x.trim()).join(' | ').slice(0, 1500) });
              return v;
            };
          }
        }
      });
    }
    if (bootMainThread) {
      await context.addInitScript(() => {
        try {
          const key = 'terrain-studio-perf-v1';
          const cur = JSON.parse(localStorage.getItem(key) || '{"preset":"balanced"}');
          localStorage.setItem(key, JSON.stringify({ ...cur, useWorker: false, workerPreferenceExplicit: true }));
        } catch { /* ignore */ }
      });
    }
    const page = await context.newPage();
    const errors = [];
    const consoleLines = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)));
    const t0 = Date.now();
    page.on('console', (m) => {
      const text = m.text();
      if (/\[(boot|shader|frame stall|graphics|mode)/i.test(text) || m.type() === 'error') consoleLines.push(`${Date.now() - t0}ms ${text.slice(0, 300)}`);
    });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    let state = null;
    try {
      await page.waitForFunction(() => {
        const st = window.__bootProbe?.bootStates;
        const lastState = st?.[st.length - 1]?.state;
        return lastState === 'ready' || lastState === 'failed';
      }, null, { timeout: 300000, polling: 100 });
    } catch { state = 'timeout'; }
    const readyAt = await page.evaluate(() => {
      const st = window.__bootProbe.bootStates;
      return st[st.length - 1];
    });
    // keep sampling briefly after ready: post-boot deferred work stalls count too
    await page.waitForTimeout(4000);
    const probe = await page.evaluate(() => {
      const p = window.__bootProbe;
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        bootStates: p.bootStates,
        longTasks: p.longTasks,
        rafGaps: p.rafGaps,
        domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
        jsHeapUsed: performance.memory?.usedJSHeapSize ?? null,
        slowGL: window.__slowGL || [],
      };
    });
    const system = await sampleBrowserMemory(profileDir);
    const readyMs = readyAt?.state === 'ready' ? readyAt.t : null;
    const lt = probe.longTasks;
    const gaps = probe.rafGaps;
    const sumBlocking = lt.reduce((a, t) => a + Math.max(0, t.d - 50), 0);
    const result = {
      kind,
      state: state || readyAt?.state,
      wallMs: Date.now() - t0,
      readyMs,
      domContentLoaded: probe.domContentLoaded,
      longTaskCount: lt.length,
      longTaskTotalMs: lt.reduce((a, t) => a + t.d, 0),
      totalBlockingMs: sumBlocking,
      maxLongTaskMs: lt.reduce((a, t) => Math.max(a, t.d), 0),
      rafGapCount: gaps.length,
      rafGapsOver250: gaps.filter((g) => g.d > 250).length,
      maxRafGapMs: gaps.reduce((a, g) => Math.max(a, g.d), 0),
      rafGapTotalMs: gaps.reduce((a, g) => a + g.d, 0),
      bootStates: probe.bootStates,
      topGaps: [...gaps].sort((a, b) => b.d - a.d).slice(0, 8),
      jsHeapUsed: probe.jsHeapUsed,
      system,
      errors,
      console: consoleLines,
      slowGL: probe.slowGL,
    };
    log(`  boot ${kind}: ready ${readyMs}ms, maxLongTask ${result.maxLongTaskMs}ms, TBT ${sumBlocking}ms, max rAF gap ${result.maxRafGapMs}ms (${result.rafGapsOver250} >250ms)`);
    return result;
  } finally {
    await context.close().catch(() => {});
  }
}

async function runBoot(results) {
  if (!skipBuild) {
    log('building production bundle');
    await runNode([path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'warn'], 'vite build');
  }
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  log(`starting vite preview on ${previewPort}`);
  const server = await startServer([vite, 'preview', '--port', String(previewPort), '--strictPort', '--host', '127.0.0.1'], /Local:|http:\/\//i, 'preview');
  const base = `http://127.0.0.1:${previewPort}`;
  results.boot = [];
  try {
    const warmRuns = Number(opt('boot-warm-runs', 1));
    for (let r = 0; r < bootRepeats; r++) {
      const cold = fs.mkdtempSync(path.join(os.tmpdir(), 'terrain-boot-'));
      results.boot.push(await bootOnce(base, cold, 'cold'));
      for (let w = 0; w < warmRuns; w++) results.boot.push(await bootOnce(base, cold, 'warm'));
      fs.rmSync(cold, { recursive: true, force: true });
    }
  } finally {
    killTree(server);
  }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
}

// ------------------------------------------------------------------ main
const results = {
  label,
  startedAt: new Date().toISOString(),
  git: null,
  machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1) },
  scenes: {},
};
try {
  const { execSync } = await import('node:child_process');
  results.git = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
    + (execSync('git status --porcelain', { cwd: ROOT }).toString().trim() ? '+dirty' : '');
} catch { /* not a git checkout */ }

if (!skipRuntime) await runRuntime(results);
if (!skipBoot) await runBoot(results);
results.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
log(`results → ${path.relative(ROOT, OUT)}`);
