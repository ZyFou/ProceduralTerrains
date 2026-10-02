// Time individual GL calls on the compiling context after a cold submit.
export default async function ({ page }) {
  const res = await page.evaluate(async () => {
    const e = window.__engine;
    const r = e.renderer;
    const gl = r.getContext();
    const ext = gl.getExtension('KHR_parallel_shader_compile');
    const m = e.terrainMaterial.clone();
    m.defines = { ...m.defines, STATUS_PROBE: Math.floor(Math.random() * 1e9) };
    const Mesh = e.board.chunks[0].mesh.constructor;
    const Scene = e.scene.constructor;
    const scene = new Scene();
    scene.add(new Mesh(e.board.chunks[0].mesh.geometry, m));
    const t0 = performance.now();
    r.compile(scene, e.camera);
    const submit = performance.now() - t0;
    const prog = r.properties.get(m).currentProgram.program;
    const log = [];
    const timeCall = (label, fn) => { const a = performance.now(); const v = fn(); log.push([label, Math.round(performance.now() - a), v]); return v; };
    // 1) unrelated sync query on this context
    timeCall('getError', () => gl.getError());
    // 2) the completion status query, polled
    let done = false;
    const start = performance.now();
    while (!done && performance.now() - start < 60000) {
      done = timeCall('COMPLETION_STATUS', () => gl.getProgramParameter(prog, ext.COMPLETION_STATUS_KHR));
      await new Promise((res) => setTimeout(res, 50));
    }
    timeCall('LINK_STATUS', () => gl.getProgramParameter(prog, gl.LINK_STATUS));
    const slow = log.filter((l) => l[1] > 20);
    return { submit: Math.round(submit), calls: log.length, slow, first: log.slice(0, 4), total: Math.round(performance.now() - t0) };
  });
  console.log(JSON.stringify(res));
}
