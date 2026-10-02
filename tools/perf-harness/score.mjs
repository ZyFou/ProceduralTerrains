// Aggregate score of one run. "Overall frame time" is the geometric mean of the
// MEDIAN serialized frame cost (CPU submit + GPU completion) over every static
// view and camera path, so a 10% win anywhere moves the score by the same
// relative amount regardless of the scene's absolute cost. Medians keep a
// single driver hitch from swinging the convergence decision; means and p95
// are still reported per scene.
const geomean = (values) => {
  const v = values.filter((x) => Number.isFinite(x) && x > 0);
  if (!v.length) return null;
  return Math.exp(v.reduce((a, x) => a + Math.log(x), 0) / v.length);
};

export function scoreRun(run) {
  const frame = [];
  const gpu = [];
  const cpu = [];
  const p95 = [];
  for (const scene of Object.values(run.scenes || {})) {
    for (const v of [...Object.values(scene.views || {}), ...Object.values(scene.paths || {})]) {
      frame.push(v.frameMs?.median);
      gpu.push(v.gpuMs?.median);
      cpu.push(v.cpuMs?.median);
      p95.push(v.frameMs?.p95);
    }
  }
  return { overall: geomean(frame), gpu: geomean(gpu), cpu: geomean(cpu), p95: geomean(p95), samples: frame.length };
}
