import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.goto(`${process.env.TERRAIN_CHECK_URL || 'http://127.0.0.1:6061'}/tools/surface-qa.html`);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { DetailPageCache } = await import('/src/engine/terrain/detail/DetailPageCache.js');
    const { createTerrainUniforms } = await import('/src/engine/terrain/TerrainMaterial.js');
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas') });
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const uniforms = createTerrainUniforms();
    const cache = new DetailPageCache({ renderer, uniforms });
    const camera = { position: new THREE.Vector3(0, 20, 0) };
    const longTasks = [];
    const observer = new PerformanceObserver((list) => {
      for (const task of list.getEntries()) longTasks.push(task.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    const start = performance.now();
    while (!cache.hasReadyPage && performance.now() - start < 60000) {
      cache.update({ camera, mode: 'studio', generation: 1, scale: 0.16,
        seedX: 0, seedY: 0, active: true, dt: 0.016 });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const ready = cache.hasReadyPage;
    const prepareMs = performance.now() - start;
    camera.position.set(1024, 20, 0);
    cache.update({ camera, mode: 'studio', generation: 2, scale: 0.16,
      seedX: 0, seedY: 0, active: true, dt: 0.016 });
    const staleCleared = !cache.hasReadyPage && uniforms.uDetailGlobalBlend.value === 0;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    observer.disconnect();
    cache.dispose();
    renderer.dispose();
    return { ready, prepareMs, staleCleared, maxLongTaskMs: Math.max(0, ...longTasks), gpu,
      glError: renderer.getContext().getError() };
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready || !result.staleCleared || result.glError) process.exitCode = 1;
} finally {
  await browser.close();
}
