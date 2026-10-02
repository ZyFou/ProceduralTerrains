// Active sampler count of every linked program vs the GPU's texture-unit limit.
export default async function ({ page, h, scene }) {
  await h.setPose(scene.views[1].pose);
  await h.settle({ timeoutMs: 90000 });
  console.log(JSON.stringify(await page.evaluate(() => {
    const e = window.__engine;
    const gl = e.renderer.getContext();
    const SAMPLERS = new Set([gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_3D, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_SHADOW,
      gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D, gl.SAMPLER_2D_ARRAY_SHADOW]);
    const out = { maxFragmentUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), maxCombined: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS), maxVertex: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS), programs: [] };
    for (const p of e.renderer.info.programs || []) {
      const n = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS);
      const names = [];
      for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p.program, i); if (SAMPLERS.has(u.type)) names.push(u.name); }
      out.programs.push({ name: p.name || p.type, samplers: names.length, names: names.join(' ') });
    }
    out.programs.sort((a, b) => b.samplers - a.samplers);
    out.programs = out.programs.slice(0, 6);
    return out;
  }), null, 1));
}
