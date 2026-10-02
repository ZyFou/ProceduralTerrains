// Compact text summary of one harness run (and optional comparison run).
//   node tools/perf-harness/summary.mjs <label> [baselineLabel]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreRun } from './score.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNS = path.join(ROOT, 'output', 'perf-harness', 'runs');
const [label, baseLabel] = process.argv.slice(2);
const read = (l) => JSON.parse(fs.readFileSync(path.join(RUNS, l, 'results.json'), 'utf8'));
const r = read(label);
const b = baseLabel ? read(baseLabel) : null;
const f = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));
const delta = (cur, base) => (cur == null || base == null || !base ? '' : ` (${((cur / base - 1) * 100).toFixed(1)}%)`);

for (const [sid, s] of Object.entries(r.scenes || {})) {
  const bs = b?.scenes?.[sid];
  console.log(`${sid}  boot ${s.boot?.bootMs ?? '—'}ms${s.transition ? `  mode ${s.transition.ms}ms` : ''}${s.failed ? `  FAILED ${s.failed}` : ''}`);
  for (const [vid, v] of Object.entries(s.views || {})) {
    const bv = bs?.views?.[vid];
    console.log(`  view ${vid.padEnd(10)} frame ${f(v.frameMs?.mean)}${delta(v.frameMs?.mean, bv?.frameMs?.mean)}  cpu ${f(v.cpuMs?.mean)}  gpu ${f(v.gpuMs?.mean)}${delta(v.gpuMs?.mean, bv?.gpuMs?.mean)}  tris ${f(v.triangles?.mean, 0)}  draws ${f(v.drawCalls?.mean, 0)}  settle ${v.settle?.ms}ms${v.settle?.idle ? '' : ' (not idle)'}`);
    for (const row of (v.breakdown || []).slice(0, 6)) console.log(`      ${row.gpuMsPerFrame.toFixed(2)}ms gpu  ${row.cpuMsPerFrame.toFixed(2)}ms cpu  ×${row.perFrame}  ${row.label}  draws ${row.drawCallsPerFrame}`);
  }
  for (const [pid, v] of Object.entries(s.paths || {})) {
    const bv = bs?.paths?.[pid];
    console.log(`  path ${pid.padEnd(10)} frame ${f(v.frameMs?.mean)}${delta(v.frameMs?.mean, bv?.frameMs?.mean)} p95 ${f(v.frameMs?.p95)} max ${f(v.frameMs?.max)}  cpu ${f(v.cpuMs?.mean)} p95 ${f(v.cpuMs?.p95)} max ${f(v.cpuMs?.max)}  gpu ${f(v.gpuMs?.mean)}${delta(v.gpuMs?.mean, bv?.gpuMs?.mean)}  tris ${f(v.triangles?.mean, 0)}`);
    for (const row of (v.breakdown || []).slice(0, 8)) console.log(`      ${row.gpuMsPerFrame.toFixed(2)}ms gpu  ${row.cpuMsPerFrame.toFixed(2)}ms cpu  ×${row.perFrame}  ${row.label}  draws ${row.drawCallsPerFrame}`);
  }
  const m = s.memory;
  if (m) {
    console.log(`  memory heap ${f(m.jsHeapUsed / 1048576, 1)}MB  geo ${f(m.sceneGeometryBytes / 1048576, 1)}MB  tex ${f(m.sceneTextureBytes / 1048576, 1)}MB  programs ${m.programs}  textures ${m.textures}  geometries ${m.geometries}`);
  }
  if (s.system) {
    console.log(`  system VRAM ${f(s.system.gpuDedicatedBytes / 1048576, 0)}MB${delta(s.system.gpuDedicatedBytes, bs?.system?.gpuDedicatedBytes)}  shared ${f(s.system.gpuSharedBytes / 1048576, 0)}MB  renderer RAM ${f(s.system.rendererPrivateBytes / 1048576, 0)}MB  gpu-proc RAM ${f(s.system.gpuProcessPrivateBytes / 1048576, 0)}MB`);
  }
}
for (const boot of r.boot || []) {
  console.log(`boot ${boot.kind}: ready ${boot.readyMs}ms  maxLongTask ${boot.maxLongTaskMs}ms  TBT ${boot.totalBlockingMs}ms  max rAF gap ${boot.maxRafGapMs}ms  gaps>250ms ${boot.rafGapsOver250}  heap ${f(boot.jsHeapUsed / 1048576, 1)}MB`);
}
const score = scoreRun(r);
const baseScore = b ? scoreRun(b) : null;
console.log(`\nSCORE overall frame (geomean ms) ${f(score.overall, 3)}${baseScore ? delta(score.overall, baseScore.overall) : ''}  gpu ${f(score.gpu, 3)}  cpu ${f(score.cpu, 3)}  p95 ${f(score.p95, 3)}`);
