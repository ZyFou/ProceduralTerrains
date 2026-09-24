import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.goto(`${process.env.TERRAIN_CHECK_URL || 'http://127.0.0.1:6061'}/tools/surface-qa.html`);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { createSurfaceDocument } = await import('/src/engine/terrain/surface/SurfaceDocument.js');
    const { putSurfaceBlob } = await import('/src/project/SurfaceAssetStore.js');
    const { prepareSurfaceInBackground } = await import('/src/engine/terrain/surface/SurfacePreparationClient.js');
    const { uploadSurfaceTextures } = await import('/src/engine/terrain/surface/SurfaceUploadQueue.js');
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas') });
    const longTasks = [];
    const observer = new PerformanceObserver((list) => {
      for (const task of list.getEntries()) longTasks.push(task.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    const canvas = new OffscreenCanvas(4, 4);
    const context = canvas.getContext('2d');
    context.fillStyle = '#9a7854';
    context.fillRect(0, 0, 4, 4);
    const reference = await putSurfaceBlob(await canvas.convertToBlob({ type: 'image/png' }));
    const id = `user:${reference.hash}`;
    const surfaceDocument = createSurfaceDocument({ settings: { profile: 'eco' },
      assets: { [id]: { id, name: 'Browser import check', maps: { albedo: reference }, normalConvention: 'GL' } } });
    for (const role of Object.keys(surfaceDocument.roles)) surfaceDocument.roles[role] = id;
    const start = performance.now();
    const atlas = await prepareSurfaceInBackground({ source: 'pbrLibrary', document: surfaceDocument });
    const prepareMs = performance.now() - start;
    const uploadStart = performance.now();
    await uploadSurfaceTextures(renderer, atlas);
    const uploadMs = performance.now() - uploadStart;
    const result = { prepareMs, uploadMs, layers: atlas.diffuse.image.depth,
      mipLevels: atlas.diffuse.mipmaps.length, glError: renderer.getContext().getError() };
    const customStart = performance.now();
    const custom = await prepareSurfaceInBackground({ source: 'customTextures', customMaps: {} });
    result.customPrepareMs = performance.now() - customStart;
    const customUploadStart = performance.now();
    await uploadSurfaceTextures(renderer, custom);
    result.customUploadMs = performance.now() - customUploadStart;
    result.customGlError = renderer.getContext().getError();
    const extension = renderer.getContext().getExtension('WEBGL_lose_context');
    if (extension) {
      const restored = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WebGL context restore timed out')), 5000);
        renderer.domElement.addEventListener('webglcontextrestored', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
      });
      extension.loseContext();
      await new Promise((resolve) => setTimeout(resolve, 100));
      extension.restoreContext();
      await restored;
      await uploadSurfaceTextures(renderer, atlas);
      result.restoreGlError = renderer.getContext().getError();
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    observer.disconnect();
    result.maxLongTaskMs = Math.max(0, ...longTasks);
    custom.diffuse.dispose();
    custom.props.dispose();
    atlas.diffuse.dispose();
    atlas.props.dispose();
    renderer.dispose();
    return result;
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.glError || result.customGlError || result.restoreGlError
      || result.layers !== 1 || result.mipLevels < 2) process.exitCode = 1;
} finally {
  await browser.close();
}
