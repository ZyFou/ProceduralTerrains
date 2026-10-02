// Compile-time + runtime experiment: make the OCTAVES-bound FBM loops use a
// uniform bound (real loops, no unrolling) and compare cold compile time and
// GPU cost of the studio terrain program.
export default async function ({ page, h, scene }) {
  const view = scene.views.find((v) => v.id === (process.env.VIEW || 'close'));
  await h.setPose(view.pose);
  await h.settle({ timeoutMs: 90000 });
  const measure = async (label) => {
    await h.setPose(view.pose);
    const m = await h.measure({ frames: 30, warmup: 6 });
    console.log(label.padEnd(28), 'frame', m.frameMs.mean, 'gpu', m.gpuMs?.mean);
  };
  // force live field so the heightAt cost dominates
  await page.evaluate(() => { const e = window.__engine; e._studioLiveHeightField = true; e.uniforms.uUseTerrainHeightTex.value = 0; e.uniforms.uUseWaterTerrainBiomeTex.value = 0; });
  await measure('original (live)');
  const res = await page.evaluate(async (variant) => {
    const e = window.__engine;
    const r = e.renderer;
    const m = e.terrainMaterial;
    const patch = (src) => {
      let s = src;
      if (variant.includes('oct')) {
        s = s.replace(/for \(int i = 0; i < OCTAVES; i\+\+\)/g, 'for (int i = 0; i < uDynOctaves; i++)');
        s = s.replace(/(float fbm\(vec2 p\) \{)/, 'uniform int uDynOctaves;\n$1');
      }
      if (variant.includes('small')) {
        s = s.replace(/for \(int i = 0; i < 4; i\+\+\) \{\n    sum \+= amp \* vnoise\(p\);/g, 'for (int i = 0; i < uDyn4; i++) {\n    sum += amp * vnoise(p);');
        s = s.replace(/(float fbm\(vec2 p\) \{)/, 'uniform int uDyn4;\n$1');
      }
      return s;
    };
    const before = { v: m.vertexShader, f: m.fragmentShader };
    m.uniforms.uDynOctaves = { value: m.defines.OCTAVES };
    m.uniforms.uDyn4 = { value: 4 };
    m.vertexShader = patch(m.vertexShader);
    m.fragmentShader = patch(m.fragmentShader);
    m.defines = { ...m.defines, DYN_BUST: Math.floor(Math.random() * 1e9) };
    m.needsUpdate = true;
    const t0 = performance.now();
    await r.compileAsync(e.scene, e.camera);
    const ms = performance.now() - t0;
    const changed = { v: m.vertexShader !== before.v, f: m.fragmentShader !== before.f, count: (m.fragmentShader.match(/uDynOctaves/g) || []).length };
    return { compileMs: Math.round(ms), changed };
  }, process.env.VARIANT || 'oct');
  console.log('compile', JSON.stringify(res));
  await measure('patched ' + (process.env.VARIANT || 'oct'));
}
