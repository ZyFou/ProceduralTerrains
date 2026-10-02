// Visible meshes per material/program for the current view + uniform counts.
export default async function ({ page, h, scene }) {
  const view = scene.views.find((v) => v.id === (process.env.VIEW || scene.views[0].id));
  await h.setPose(view.pose);
  await h.settle({ timeoutMs: 90000 });
  const recs = await page.evaluate(() => {
    const e = window.__engine;
    const mats = new Map();
    e.scene.traverseVisible((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) {
        if (!m) continue;
        const rec = mats.get(m.id) || { id: m.id, type: m.type, name: m.name || o.name, meshes: 0, uniforms: 0, arrays: 0, arrayNames: [] };
        rec.meshes++;
        if (!mats.has(m.id)) {
          for (const [k, u] of Object.entries(m.uniforms || {})) {
            rec.uniforms++;
            if (Array.isArray(u?.value)) { rec.arrays++; if (rec.arrayNames.length < 12) rec.arrayNames.push(`${k}[${u.value.length}]`); }
          }
        }
        mats.set(m.id, rec);
      }
    });
    return [...mats.values()].sort((a, b) => b.meshes - a.meshes);
  });
  console.log(recs.map((r) => `${r.id} ${r.type} ${r.name} meshes=${r.meshes} uniforms=${r.uniforms} arrays=${r.arrays}`).join(String.fromCharCode(10)));
}
