// CPU profile of the measured frame loop (CDP Profiler), aggregated by
// function self time; also prints the slowest frames' CPU time.
export default async function ({ page, h, scene }) {
  const view = process.env.VIEW ? scene.views.find((v) => v.id === process.env.VIEW) : null;
  const p = view ? { frames: 240, path: [view.pose, view.pose] } : scene.paths[0];
  await h.setPose(p.path[0]);
  await h.settle({ timeoutMs: 90000, idleFrames: 20, minFrames: 30 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const m = await page.evaluate(({ frames, path }) => window.__h.measure({ frames, warmup: 0, path }), { frames: p.frames, path: p.path });
  const { profile } = await cdp.send('Profiler.stop');
  console.log('cpu', JSON.stringify(m.cpuMs), 'frame', JSON.stringify(m.frameMs));
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]);
    const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  console.log('total sampled ms', total.toFixed(0));
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    console.log(v.toFixed(1).padStart(8), 'ms', (v / total * 100).toFixed(1).padStart(5), '%', k);
  }
}
