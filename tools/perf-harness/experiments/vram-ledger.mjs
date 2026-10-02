// VRAM inventory: render-target ledger entries + every live texture/RT the
// renderer holds, sized from its dimensions and format.
export default async function ({ page, h, scene }) {
  const view = scene.views[0];
  await h.setPose(view.pose);
  await h.settle({ timeoutMs: 90000 });
  const out = await page.evaluate(() => {
    const e = window.__engine;
    const snap = e._gpuResourceLedger?.snapshot?.();
    const bpp = (t) => {
      const T = { 1009: 1, 1015: 4, 1016: 2, 1010: 1 }; // ubyte, float, half, byte
      const per = T[t.type] ?? 1;
      const ch = { 1023: 4, 1028: 1, 1030: 2, 1022: 3, 1026: 1, 1027: 2 }[t.format] ?? 4;
      return per * ch;
    };
    const seen = new Map();
    const visit = (t, where) => {
      if (!t || !t.isTexture || seen.has(t.uuid)) return;
      const img = t.image || {};
      const w = img.width || t.source?.data?.width || 0;
      const hgt = img.height || t.source?.data?.height || 0;
      const d = img.depth || (t.isCubeTexture || (Array.isArray(img) && img.length === 6) ? 6 : 1);
      const bytes = w * hgt * d * bpp(t);
      seen.set(t.uuid, { name: t.name || t.constructor.name, w, h: hgt, d, type: t.type, format: t.format, mb: +(bytes / 1048576).toFixed(2), where });
    };
    e.scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        for (const [k, u] of Object.entries(m.uniforms || {})) visit(u?.value, k);
        for (const k of ['map', 'normalMap', 'envMap']) visit(m[k], k);
      }
    });
    for (const [k, u] of Object.entries(e.uniforms || {})) visit(u?.value, k);
    const list = [...seen.values()].sort((a, b) => b.mb - a.mb);
    return { ledger: snap, textures: list.slice(0, 25), total: list.reduce((s, x) => s + x.mb, 0).toFixed(1) };
  });
  console.log(JSON.stringify(out, null, 1).slice(0, 7000));
}
