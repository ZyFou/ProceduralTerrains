export default async function ({ page }) {
  const info = await page.evaluate(async () => {
    const e = window.__engine;
    const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
    const out = [];
    const mats = new Set();
    e.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m)); });
    for (const m of mats) {
      if (!m.fragmentShader) continue;
      out.push({ name: m.userData?.benchmarkRole || m.name || m.type, v: hash(m.vertexShader), f: hash(m.fragmentShader), d: JSON.stringify(m.defines || {}), vl: m.vertexShader.length, fl: m.fragmentShader.length });
    }
    return { seed: e.params.seed, out };
  });
  console.log(JSON.stringify(info, null, 1));
}
