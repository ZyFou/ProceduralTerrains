// Does a cold shader compile block the whole GPU process? An independent
// worker with its own OffscreenCanvas WebGL context times 1-pixel readbacks
// every 20 ms while the main context submits a cold compile (no polling).
export default async function ({ page }) {
  const res = await page.evaluate(async () => {
    const workerSrc = `
      const c = new OffscreenCanvas(8, 8);
      const gl = c.getContext('webgl2');
      const px = new Uint8Array(4);
      const samples = [];
      let running = true;
      onmessage = (e) => { if (e.data === 'stop') { running = false; postMessage(samples); } };
      const loop = () => {
        if (!running) return;
        const t0 = performance.now();
        gl.clearColor(Math.random(), 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        samples.push([Math.round(t0), Math.round(performance.now() - t0)]);
        setTimeout(loop, 20);
      };
      loop();`;
    const worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
    await new Promise((r) => setTimeout(r, 500));
    const e = window.__engine;
    const m = e.terrainMaterial.clone();
    m.defines = { ...m.defines, BLOCK_PROBE: Math.floor(Math.random() * 1e9) };
    const Mesh = e.board.chunks[0].mesh.constructor;
    const Scene = e.scene.constructor;
    const scene = new Scene();
    scene.add(new Mesh(e.board.chunks[0].mesh.geometry, m));
    const tSubmit = performance.now();
    e.renderer.compile(scene, e.camera);   // submit only, no readiness polling
    const submitMs = performance.now() - tSubmit;
    await new Promise((r) => setTimeout(r, 16000));
    const samples = await new Promise((r) => { worker.onmessage = (ev) => r(ev.data); worker.postMessage('stop'); });
    worker.terminate();
    const lat = samples.map((s) => s[1]);
    return { submitMs: Math.round(submitMs), n: lat.length, max: Math.max(...lat), over100: lat.filter((x) => x > 100).length, big: samples.filter((s) => s[1] > 100).slice(0, 10) };
  });
  console.log(JSON.stringify(res));
}
