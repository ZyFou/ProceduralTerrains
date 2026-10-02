export default async function ({ page }) {
  const out = await page.evaluate(async () => {
    const e = window.__engine;
    let err = null;
    const t0 = performance.now();
    try { await e.transitionMode({ worldMode: 'planet' }); } catch (x) { err = String(x?.message || x); }
    const t1 = performance.now();
    let prep = null; let prepErr = null;
    try {
      const p = await e._prepareHeightCacheProgram('planet', Math.round(e.params.octaves), e._stackGLSL);
      prep = { result: p.result, hasHandle: !!p.handle, passes: p.handle?.passes?.length };
      const mats = (p.handle?.passes || []).map((pass) => pass.material || pass.mesh?.material).filter(Boolean);
      const gl = e.renderer.getContext();
      prep.diag = mats.map((m) => {
        const props = e.renderer.properties.get(m);
        const prog = props?.currentProgram;
        if (!prog) return { name: m.name, noProgram: true, keys: Object.keys(props || {}) };
        return {
          link: gl.getProgramParameter(prog.program, gl.LINK_STATUS),
          log: gl.getProgramInfoLog(prog.program)?.slice(0, 500),
          fs: gl.getShaderInfoLog(prog.fragmentShader)?.slice(0, 1500),
        };
      });
      e._discardHeightCachePreparation(p);
    } catch (x) { prepErr = String(x?.stack || x).slice(0, 800); }
    return { err, dbg: globalThis.__planetPrepDbg, stacks: globalThis.__planetPrepStacks, rebuild: globalThis.__planetRebuildStacks, transitionMs: Math.round(t1 - t0), prep, prepErr };
  });
  console.log(JSON.stringify(out, null, 1).slice(0, 8000));
}
