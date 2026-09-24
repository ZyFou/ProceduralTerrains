import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('**/tools/worker-check-entry.js', (route) => route.fulfill({
    contentType: 'text/javascript', body: `
      import { Engine } from '/src/engine/Engine.js';
      for (const name of ['_tickBody', '_validateCompiledPrograms', '_compileMaterialVariants', '_installSurfaceAtlas']) {
        const original = Engine.prototype[name];
        Engine.prototype[name] = function(...args) {
          const started = performance.now();
          const report = () => { const ms = performance.now() - started;
            if (ms > 50) console.log('[worker check] ' + name + ' ' + ms.toFixed(1) + 'ms'); };
          const result = original.apply(this, args);
          if (result?.then) return result.finally(report);
          report(); return result;
        };
      }
      await import('/src/engine/engine.worker.js');
      self.postMessage({ type: 'check-ready' });
    `,
  }));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.text().startsWith('[worker check]')) console.log(message.text());
    if (message.text().startsWith('[shader compile]')) console.log(message.text());
    if (message.text().startsWith('[frame stall]')) console.log(message.text());
  });
  await page.goto(`${process.env.TERRAIN_CHECK_URL || 'http://127.0.0.1:6061'}/tools/surface-qa.html`);
  const result = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    const offscreen = canvas.transferControlToOffscreen();
    const worker = new Worker('/tools/worker-check-entry.js', { type: 'module' });
    let nextId = 1, booted = false, cameraEvents = 0, lastCamera;
    const requests = new Map();
    const timings = [];
    let stage = 'boot';
    let resolveReady;
    const ready = new Promise((resolve) => { resolveReady = resolve; });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    worker.onmessage = ({ data }) => {
      if (data.type === 'check-ready') { resolveReady(); return; }
      if (data.type === 'event') {
        if (data.event === 'onBootComplete') booted = true;
        if (data.event === 'onCamera') { cameraEvents++; lastCamera = data.args[0]; }
        return;
      }
      const request = requests.get(data.id);
      if (!request) return;
      requests.delete(data.id);
      clearTimeout(request.timer);
      if (data.type === 'error') request.reject(new Error(data.error.message));
      else request.resolve(data.result);
    };
    worker.onerror = (event) => console.error('[worker check] worker error: ' + event.message);
    const request = (type, args, transfer = []) => new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { requests.delete(id); reject(new Error(`${type} timed out`)); }, 180000);
      requests.set(id, { resolve, reject, timer });
      worker.postMessage({ type, id, args }, transfer);
    });
    const invoke = (method, ...args) => request('invoke', [method, args]);
    let polling = false, initialized = false;
    const heartbeat = setInterval(async () => {
      if (polling || !initialized) return;
      polling = true;
      const started = performance.now(), currentStage = stage;
      try {
        await invoke('getClientSnapshot');
        timings.push({ stage: currentStage, ms: performance.now() - started });
      } catch { /* the task timeout reports stalled workers */ }
      finally { polling = false; }
    }, 200);
    try {
      await Promise.race([ready, sleep(15000).then(() => { throw new Error('Test worker did not initialize'); })]);
      await request('initialize', [{ canvas: offscreen, viewport: { width: 1280, height: 720, pixelRatio: 1 },
        initialView: 'editor', initialParams: { waterEnabled: false, cloudsEnabled: false, propsEnabled: false },
        initialPerf: { onDemandStudio: false } }], [offscreen]);
      initialized = true;
      const deadline = performance.now() + 120000;
      while (!booted && performance.now() < deadline) await sleep(200);
      if (!booted) throw new Error('Boot did not finish');
      console.log('[worker check] boot ready');
      stage = 'close-up';
      for (let i = 0; i < 12; i++) {
        await invoke('applyInputFrame', { wheel: { type: 'wheel', deltaY: -160, deltaX: 0,
          deltaMode: 0, clientX: 640, clientY: 360 }, pointerEvents: [], keyEvents: [] });
        await sleep(100);
      }
      await sleep(2000);
      console.log('[worker check] close-up ready');
      stage = 'pbr-load';
      await invoke('setParam', 'surfaceTextureSource', 'pbrLibrary');
      await invoke('buildAndSetSurfaceAtlas', 'pbrLibrary', null, 1);
      await sleep(1000);
      console.log('[worker check] PBR published');
      stage = 'pbr-switch';
      await invoke('setParam', 'surfaceTextureSource', 'procedural');
      await sleep(1000);
      await invoke('setParam', 'surfaceTextureSource', 'pbrLibrary');
      await invoke('installCachedSurfaceAtlas', 'pbrLibrary');
      await sleep(1500);
      const diagnostics = await invoke('getGraphicsDiagnostics');
      const stages = Object.fromEntries([...new Set(timings.map((entry) => entry.stage))].map((name) => {
        const times = timings.filter((entry) => entry.stage === name).map((entry) => entry.ms).sort((a, b) => a - b);
        return [name, { samples: times.length, maxPingMs: Math.max(...times), p95PingMs: times[Math.floor(times.length * 0.95)] }];
      }));
      await request('dispose', []);
      return { stages, cameraEvents, lastCamera, contextLosses: diagnostics.contextLossTimeline,
        shaderFailures: diagnostics.programHealth.filter((entry) => !entry.ok).length };
    } finally { clearInterval(heartbeat); worker.terminate(); }
  });
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  if (errors.length || result.contextLosses.length || result.shaderFailures || !result.cameraEvents) process.exitCode = 1;
} finally { await browser.close(); }
