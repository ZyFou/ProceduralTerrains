// Sync-link a cold copy of the terrain program in an independent worker and
// watch the PAGE's requestAnimationFrame cadence: a long rAF gap means the
// synchronous link blocks presentation globally (GPU process main thread).
export default async function ({ page }) {
  const res = await page.evaluate(async () => {
    const e = window.__engine;
    const gl = e.renderer.getContext();
    const prog = e.renderer.properties.get(e.terrainMaterial).currentProgram.program;
    const shaders = gl.getAttachedShaders(prog);
    const sources = shaders.map((s) => ({ type: gl.getShaderParameter(s, gl.SHADER_TYPE), src: gl.getShaderSource(s) }));
    const bust = `#define SYNC_GLOBAL_PROBE ${Math.floor(Math.random() * 1e9)}\n`;
    const workerSrc = `
      onmessage = ({ data }) => {
        const c = new OffscreenCanvas(8, 8);
        const gl = c.getContext('webgl2');
        const p = gl.createProgram();
        for (const s of data.sources) {
          const sh = gl.createShader(s.type);
          const lines = s.src.split('\n');
          lines.splice(1, 0, data.bust);
          gl.shaderSource(sh, lines.join('\n'));
          gl.compileShader(sh);
          gl.attachShader(p, sh);
        }
        const t0 = performance.now();
        gl.linkProgram(p);
        const ok = gl.getProgramParameter(p, gl.LINK_STATUS);
        postMessage({ ok, ms: Math.round(performance.now() - t0), log: ok ? '' : gl.getProgramInfoLog(p) });
      };`;
    const worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
    let last = performance.now();
    let maxGap = 0;
    let running = true;
    const frame = (now) => { maxGap = Math.max(maxGap, now - last); last = now; if (running) requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    await new Promise((r) => setTimeout(r, 300));
    maxGap = 0;
    const done = new Promise((r) => { worker.onmessage = (ev) => r(ev.data); });
    worker.postMessage({ sources, bust });
    const out = await done;
    await new Promise((r) => setTimeout(r, 300));
    running = false;
    worker.terminate();
    return { link: out, pageMaxRafGapMs: Math.round(maxGap) };
  });
  console.log(JSON.stringify(res));
}
