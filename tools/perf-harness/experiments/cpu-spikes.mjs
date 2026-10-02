// Per-frame CPU attribution of engine subsystems along the scene's path.
export default async function ({ page, h, scene }) {
  const p = scene.paths[0];
  await h.setPose(p.path[0]);
  await h.settle({ timeoutMs: 90000, idleFrames: 20, minFrames: 30 });
  await page.evaluate(() => {
    const e = window.__engine;
    const stats = window.__cpuStats = {};
    const wrap = (obj, name, label) => {
      if (!obj || typeof obj[name] !== 'function') return;
      const original = obj[name].bind(obj);
      obj[name] = (...args) => {
        const t0 = performance.now();
        try { return original(...args); } finally {
          const ms = performance.now() - t0;
          const s = stats[label] ||= { total: 0, max: 0, calls: 0, over4: 0 };
          s.total += ms; s.calls++; if (ms > s.max) s.max = ms; if (ms > 4) s.over4++;
        }
      };
    };
    wrap(e.propsManager, 'update', 'props.update');
    wrap(e.propsManager, 'tickWind', 'props.tickWind');
    wrap(e.propsManager, '_buildFlatSector', 'props.buildSector');
    wrap(e.propsManager, '_commitFlat', 'props.commit');
    wrap(e._detailPageCache, 'update', 'detailPages.update');
    wrap(e.studioCloud, 'update', 'cloud.update');
    wrap(e.studioCloud, '_rebuildOccupancy', 'cloud.occupancy');
    wrap(e.board, 'updateLOD', 'board.updateLOD');
    wrap(e.board, 'cull', 'board.cull');
    wrap(e, '_sceneRevisionKey', 'sceneRevisionKey');
    wrap(e, '_prepareCameraPipeline', 'cameraPipeline');
    wrap(e, '_updateUnderwater', 'underwater');
    wrap(e.waterSystem, 'update', 'water.update');
    wrap(e, '_ensureTerrainHeightTexSafely', 'heightBake');
    wrap(e.renderer, 'render', 'renderer.render(cpu)');
    wrap(e, '_tick', 'tick(total)');
  });
  const m = await page.evaluate(({ frames, path }) => window.__h.measure({ frames, warmup: 0, path }), { frames: p.frames, path: p.path });
  const stats = await page.evaluate(() => window.__cpuStats);
  console.log('cpu', JSON.stringify(m.cpuMs));
  for (const [k, v] of Object.entries(stats).sort((a, b) => b[1].total - a[1].total)) {
    console.log(k.padEnd(24), 'total', v.total.toFixed(1).padStart(8), 'max', v.max.toFixed(2).padStart(7), 'calls', String(v.calls).padStart(5), '>4ms', v.over4);
  }
}
