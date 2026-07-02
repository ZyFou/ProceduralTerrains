// ============================================================================
// WebGPU compute backend for the erosion simulation — the Phase 4 pilot.
//
// Same contract as the worker path: takes {width, height, heightmap, params,
// onProgress} and resolves {delta, flow, erosionMask, depositionMask,
// sedimentMap, slopeMap}. Pure compute → readback; it never touches the
// three.js WebGL renderer, so it coexists with the current rendering backend.
// Any failure throws — the engine falls back to the CPU worker.
//
// Faithfulness to the CPU reference (erosionSim.js):
//  - Droplet start positions are precomputed on the CPU with the same
//    mulberry32 stream, and the identical brush kernel is uploaded.
//  - Post-processing (smoothing / strength blend / mask normalization) is the
//    shared finalizeErosion(), bit-identical to the CPU path.
//  - The thermal pass is an exact port (delta buffer per iteration).
//
// Deliberate deviations (inherent to parallel droplets):
//  - CPU runs droplets sequentially against the live map. GPU runs them in
//    small batches: each batch reads a height SNAPSHOT and accumulates
//    fixed-point integer atomics into the live map, so a droplet doesn't see
//    carving from its own batch (only from earlier batches).
//  - The don't-punch-holes clamp tests the batch snapshot (so every write is
//    a commutative integer atomicAdd → bit-deterministic per device), and a
//    serialized floorClamp pass between batches pins the map at bedrock.
// ============================================================================

import { DEFAULT_SIM_PARAMS, finalizeErosion, mulberry32, buildBrush } from './erosionSim.js';

// Fixed-point scales for integer atomics. Heights: 2^16 → ±32k world units of
// range at ~15µm resolution. Flow uses a coarser scale because it accumulates
// (droplets × water) and must not overflow i32.
const HEIGHT_SCALE = 65536;
const FLOW_SCALE = 256;
const WG_DROPLETS = 64;

/** Cheap static capability probe (no adapter request). */
export function isWebGPUErosionSupported() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

let _devicePromise = null;
function getDevice() {
  if (!_devicePromise) {
    _devicePromise = (async () => {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('no WebGPU adapter');
      const device = await adapter.requestDevice();
      device.lost.then(() => { _devicePromise = null; });
      return device;
    })();
    _devicePromise.catch(() => { _devicePromise = null; });
  }
  return _devicePromise;
}

const SHADER = /* wgsl */ `
struct SimParams {
  width : u32,
  height : u32,
  brushCount : u32,
  batchStart : u32,
  batchCount : u32,
  maxLifetime : u32,
  pad0 : u32,
  pad1 : u32,
  inertia : f32,
  sedimentCapacity : f32,
  minSlope : f32,
  depositionRate : f32,
  erosionRate : f32,
  evaporation : f32,
  gravity : f32,
  initialSpeed : f32,
  initialWater : f32,
  talus : f32,
  thermalStrength : f32,
  pad2 : f32,
}

const HEIGHT_SCALE : f32 = 65536.0;
const FLOW_SCALE : f32 = 256.0;

@group(0) @binding(0) var<uniform> P : SimParams;
// droplet pass
@group(0) @binding(1) var<storage, read> snapshot : array<i32>;
@group(0) @binding(2) var<storage, read_write> liveMap : array<atomic<i32>>;
@group(0) @binding(3) var<storage, read_write> flowAcc : array<atomic<i32>>;
@group(0) @binding(4) var<storage, read_write> eroAcc : array<atomic<i32>>;
@group(0) @binding(5) var<storage, read_write> depAcc : array<atomic<i32>>;
@group(0) @binding(6) var<storage, read> brush : array<vec4f>;   // (dx, dy, weight, 0)
@group(0) @binding(7) var<storage, read> starts : array<vec2f>;
// thermal pass (same buffers, non-conflicting bindings per entry point)
@group(0) @binding(8) var<storage, read> mapRO : array<i32>;
@group(0) @binding(9) var<storage, read_write> deltaAcc : array<atomic<i32>>;
@group(0) @binding(10) var<storage, read_write> mapRW : array<i32>;
@group(0) @binding(11) var<storage, read_write> deltaRW : array<i32>;

fn snapH(i : u32) -> f32 { return f32(snapshot[i]) / HEIGHT_SCALE; }

// bilinear height + gradient of the snapshot surface → (value, gx, gy)
fn heightGrad(pos : vec2f) -> vec3f {
  let cx = u32(pos.x);
  let cy = u32(pos.y);
  let fx = pos.x - f32(cx);
  let fy = pos.y - f32(cy);
  let nw = cy * P.width + cx;
  let hNW = snapH(nw);
  let hNE = snapH(nw + 1u);
  let hSW = snapH(nw + P.width);
  let hSE = snapH(nw + P.width + 1u);
  let gx = (hNE - hNW) * (1.0 - fy) + (hSE - hSW) * fy;
  let gy = (hSW - hNW) * (1.0 - fx) + (hSE - hNE) * fx;
  let v = hNW * (1.0 - fx) * (1.0 - fy) + hNE * fx * (1.0 - fy)
        + hSW * (1.0 - fx) * fy + hSE * fx * fy;
  return vec3f(v, gx, gy);
}

fn addHeight(i : u32, v : f32) {
  atomicAdd(&liveMap[i], i32(round(v * HEIGHT_SCALE)));
}

@compute @workgroup_size(${WG_DROPLETS})
fn droplets(@builtin(global_invocation_id) gid : vec3u) {
  if (gid.x >= P.batchCount) { return; }
  let W = P.width;
  let H = P.height;
  var pos = starts[P.batchStart + gid.x];
  var dir = vec2f(0.0, 0.0);
  var speed = P.initialSpeed;
  var water = P.initialWater;
  var sediment = 0.0;

  for (var life = 0u; life < P.maxLifetime; life++) {
    let nodeX = i32(pos.x);
    let nodeY = i32(pos.y);
    let cellIdx = u32(nodeY) * W + u32(nodeX);
    let offX = pos.x - f32(nodeX);
    let offY = pos.y - f32(nodeY);
    let hg = heightGrad(pos);

    // update direction with inertia, then move one cell
    dir = dir * P.inertia - hg.yz * (1.0 - P.inertia);
    let len = length(dir);
    if (len != 0.0) { dir = dir / len; }
    pos += dir;

    atomicAdd(&flowAcc[cellIdx], i32(round(water * FLOW_SCALE)));

    // died: flowed off the map or stopped moving
    if ((dir.x == 0.0 && dir.y == 0.0) ||
        pos.x < 0.0 || pos.x >= f32(W - 1u) ||
        pos.y < 0.0 || pos.y >= f32(H - 1u)) { break; }

    let newHeight = heightGrad(pos).x;
    let deltaHeight = newHeight - hg.x;
    let capacity = max(-deltaHeight, P.minSlope) * speed * water * P.sedimentCapacity;

    if (sediment > capacity || deltaHeight > 0.0) {
      var deposit : f32;
      if (deltaHeight > 0.0) { deposit = min(deltaHeight, sediment); }
      else { deposit = (sediment - capacity) * P.depositionRate; }
      sediment -= deposit;
      addHeight(cellIdx, deposit * (1.0 - offX) * (1.0 - offY));
      addHeight(cellIdx + 1u, deposit * offX * (1.0 - offY));
      addHeight(cellIdx + W, deposit * (1.0 - offX) * offY);
      addHeight(cellIdx + W + 1u, deposit * offX * offY);
      atomicAdd(&depAcc[cellIdx], i32(round(deposit * HEIGHT_SCALE)));
    } else {
      let erodeAmt = min((capacity - sediment) * P.erosionRate, -deltaHeight);
      for (var b = 0u; b < P.brushCount; b++) {
        let bo = brush[b];
        let ex = nodeX + i32(bo.x);
        let ey = nodeY + i32(bo.y);
        if (ex < 0 || ex >= i32(W) || ey < 0 || ey >= i32(H)) { continue; }
        let ei = u32(ey) * W + u32(ex);
        let w = erodeAmt * bo.z;
        // don't punch holes — clamp against the batch snapshot. All writes
        // stay commutative atomicAdds, so a batch is bit-deterministic
        // regardless of scheduling; the floorClamp pass between batches
        // catches within-batch over-removal at bedrock.
        let removed = min(snapH(ei), w);
        let q = i32(round(removed * HEIGHT_SCALE));
        atomicAdd(&liveMap[ei], -q);
        sediment += removed;
        atomicAdd(&eroAcc[ei], q);
      }
    }

    speed = sqrt(max(0.0, speed * speed - deltaHeight * P.gravity));
    water = water * (1.0 - P.evaporation);
  }
}

@compute @workgroup_size(8, 8)
fn thermalMove(@builtin(global_invocation_id) gid : vec3u) {
  let x = gid.x;
  let y = gid.y;
  if (x < 1u || y < 1u || x >= P.width - 1u || y >= P.height - 1u) { return; }
  let i = y * P.width + x;
  let h = f32(mapRO[i]) / HEIGHT_SCALE;
  var nb = array<u32, 4>(i - 1u, i + 1u, i - P.width, i + P.width);
  var maxDiff = 0.0;
  var slideTo = -1;   // ('target' is reserved in WGSL)
  for (var k = 0u; k < 4u; k++) {
    let diff = h - f32(mapRO[nb[k]]) / HEIGHT_SCALE;
    if (diff > maxDiff) { maxDiff = diff; slideTo = i32(nb[k]); }
  }
  if (slideTo >= 0 && maxDiff > P.talus) {
    let mv = (maxDiff - P.talus) * 0.5 * P.thermalStrength;
    let q = i32(round(mv * HEIGHT_SCALE));
    atomicAdd(&deltaAcc[i], -q);
    atomicAdd(&deltaAcc[u32(slideTo)], q);
  }
}

// Serialized between droplet batches. Two rules that sequential CPU droplets
// get for free but parallel batches need enforced:
//  - bedrock: within-batch over-removal can't push a cell below zero
//  - deposit cap: stacked same-cell deposits can fill toward the pre-batch
//    neighbourhood height but can't spike into a brand-new local peak
@compute @workgroup_size(64)
fn floorClamp(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  let W = P.width;
  if (i >= W * P.height) { return; }
  var h = max(atomicLoad(&liveMap[i]), 0);
  let x = i % W;
  let y = i / W;
  if (x >= 1u && x < W - 1u && y >= 1u && y < P.height - 1u) {
    var cap = snapshot[i];
    cap = max(cap, snapshot[i - 1u]);
    cap = max(cap, snapshot[i + 1u]);
    cap = max(cap, snapshot[i - W]);
    cap = max(cap, snapshot[i + W]);
    h = min(h, cap);   // only ever limits rises: cap >= snapshot[i]
  }
  atomicStore(&liveMap[i], h);
}

@compute @workgroup_size(64)
fn thermalApply(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= P.width * P.height) { return; }
  mapRW[i] = mapRW[i] + deltaRW[i];
  deltaRW[i] = 0;
}
`;

function makeBuffer(device, size, usage) {
  return device.createBuffer({ size: Math.max(4, size), usage });
}

async function readBack(device, encoderQueue, src, staging, byteLength) {
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(src, 0, staging, 0, byteLength);
  encoderQueue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const out = new Int32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  return out;
}

/**
 * Run the erosion simulation on the GPU. Same inputs/outputs as the worker
 * protocol (plus this returns `delta` computed here). Throws on any failure.
 */
export async function erodeWebGPU({ width, height, heightmap, params, onProgress }) {
  if (!isWebGPUErosionSupported()) throw new Error('WebGPU not available');
  const p = { ...DEFAULT_SIM_PARAMS, ...params };
  const N = width * height;
  const droplets = Math.max(0, Math.round(p.droplets));
  const device = await getDevice();
  device.pushErrorScope('validation');

  // ---- CPU-side precomputation shared with the reference implementation
  const rand = mulberry32((p.seed | 0) || 1);
  const startsData = new Float32Array(Math.max(2, droplets * 2));
  for (let i = 0; i < droplets; i++) {
    startsData[i * 2] = rand() * (width - 1);       // same stream order as CPU
    startsData[i * 2 + 1] = rand() * (height - 1);
  }
  const brush = buildBrush(width, height, Math.max(1, Math.round(p.erosionRadius)));
  const brushData = new Float32Array(Math.max(4, brush.offsets.length * 4));
  for (let b = 0; b < brush.offsets.length; b++) {
    brushData[b * 4] = brush.offsets[b][0];
    brushData[b * 4 + 1] = brush.offsets[b][1];
    brushData[b * 4 + 2] = brush.weights[b];
  }
  const mapInit = new Int32Array(N);
  for (let i = 0; i < N; i++) mapInit[i] = Math.round(heightmap[i] * HEIGHT_SCALE);

  // ---- buffers
  const S = GPUBufferUsage;
  const paramsBuf = makeBuffer(device, 80, S.UNIFORM | S.COPY_DST);
  const mapBuf = makeBuffer(device, N * 4, S.STORAGE | S.COPY_SRC | S.COPY_DST);
  const snapBuf = makeBuffer(device, N * 4, S.STORAGE | S.COPY_DST);
  const flowBuf = makeBuffer(device, N * 4, S.STORAGE | S.COPY_SRC);
  const eroBuf = makeBuffer(device, N * 4, S.STORAGE | S.COPY_SRC);
  const depBuf = makeBuffer(device, N * 4, S.STORAGE | S.COPY_SRC);
  const deltaBuf = makeBuffer(device, N * 4, S.STORAGE);
  const brushBuf = makeBuffer(device, brushData.byteLength, S.STORAGE | S.COPY_DST);
  const startsBuf = makeBuffer(device, startsData.byteLength, S.STORAGE | S.COPY_DST);
  const staging = makeBuffer(device, N * 4, S.MAP_READ | S.COPY_DST);
  const allBufs = [paramsBuf, mapBuf, snapBuf, flowBuf, eroBuf, depBuf, deltaBuf, brushBuf, startsBuf, staging];

  try {
    const q = device.queue;
    q.writeBuffer(mapBuf, 0, mapInit);
    q.writeBuffer(brushBuf, 0, brushData);
    q.writeBuffer(startsBuf, 0, startsData);
    const pu = new ArrayBuffer(80);
    const u32 = new Uint32Array(pu, 0, 8);
    const f32 = new Float32Array(pu, 32, 12);
    u32.set([width, height, brush.offsets.length, 0, 0, Math.max(0, Math.round(p.maxLifetime)), 0, 0]);
    f32.set([p.inertia, p.sedimentCapacity, p.minSlope, p.depositionRate, p.erosionRate,
             p.evaporation, p.gravity, p.initialSpeed, p.initialWater, p.talus, p.thermalStrength, 0]);
    q.writeBuffer(paramsBuf, 0, pu);

    const module = device.createShaderModule({ code: SHADER });
    const pipe = (entryPoint) => device.createComputePipeline({
      layout: 'auto', compute: { module, entryPoint },
    });
    const dropletsPipe = pipe('droplets');
    const thermalMovePipe = pipe('thermalMove');
    const thermalApplyPipe = pipe('thermalApply');
    const floorClampPipe = pipe('floorClamp');

    const bind = (pipeline, entries) => device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: entries.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
    });
    const dropletsBind = bind(dropletsPipe, [
      [0, paramsBuf], [1, snapBuf], [2, mapBuf], [3, flowBuf], [4, eroBuf], [5, depBuf],
      [6, brushBuf], [7, startsBuf],
    ]);
    const thermalMoveBind = bind(thermalMovePipe, [[0, paramsBuf], [8, mapBuf], [9, deltaBuf]]);
    const thermalApplyBind = bind(thermalApplyPipe, [[0, paramsBuf], [10, mapBuf], [11, deltaBuf]]);
    const floorClampBind = bind(floorClampPipe, [[0, paramsBuf], [1, snapBuf], [2, mapBuf]]);

    // ------------------------------------------------------- hydraulic pass
    // Batches trade CPU-fidelity (droplets seeing earlier carving) against
    // parallelism; each batch snapshots the live map, then runs in parallel.
    // Keep batches small: with stale snapshots, convergent droplets all erode
    // the same channels and the terrain runs away batch-over-batch.
    const batchSize = 256;
    const batches = Math.ceil(droplets / batchSize);
    for (let b = 0; b < batches; b++) {
      const start = b * batchSize;
      const count = Math.min(batchSize, droplets - start);
      q.writeBuffer(paramsBuf, 12, new Uint32Array([start, count]));
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(mapBuf, 0, snapBuf, 0, N * 4);
      const pass = encoder.beginComputePass();
      pass.setPipeline(dropletsPipe);
      pass.setBindGroup(0, dropletsBind);
      pass.dispatchWorkgroups(Math.ceil(count / WG_DROPLETS));
      pass.end();
      const clamp = encoder.beginComputePass();
      clamp.setPipeline(floorClampPipe);
      clamp.setBindGroup(0, floorClampBind);
      clamp.dispatchWorkgroups(Math.ceil(N / 64));
      clamp.end();
      q.submit([encoder.finish()]);
      if ((b & 3) === 3 || b === batches - 1) {
        await q.onSubmittedWorkDone();
        onProgress?.((b + 1) / batches, 'hydraulic');
      }
    }

    // --------------------------------------------------------- thermal pass
    const thermalIters = Math.max(0, Math.round(p.thermalIterations));
    if (thermalIters > 0 && p.thermalStrength > 0) {
      const encoder = device.createCommandEncoder();
      for (let it = 0; it < thermalIters; it++) {
        const move = encoder.beginComputePass();
        move.setPipeline(thermalMovePipe);
        move.setBindGroup(0, thermalMoveBind);
        move.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
        move.end();
        const apply = encoder.beginComputePass();
        apply.setPipeline(thermalApplyPipe);
        apply.setBindGroup(0, thermalApplyBind);
        apply.dispatchWorkgroups(Math.ceil(N / 64));
        apply.end();
      }
      q.submit([encoder.finish()]);
      await q.onSubmittedWorkDone();
      onProgress?.(1, 'thermal');
    }

    // ------------------------------------------------------------- readback
    const mapI = await readBack(device, q, mapBuf, staging, N * 4);
    const flowI = await readBack(device, q, flowBuf, staging, N * 4);
    const eroI = await readBack(device, q, eroBuf, staging, N * 4);
    const depI = await readBack(device, q, depBuf, staging, N * 4);

    const gpuError = await device.popErrorScope();
    if (gpuError) throw new Error(`WebGPU validation: ${gpuError.message}`);

    const map = new Float32Array(N);
    const flow = new Float32Array(N);
    const erosionMask = new Float32Array(N);
    const depositionMask = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      map[i] = mapI[i] / HEIGHT_SCALE;
      flow[i] = flowI[i] / FLOW_SCALE;
      erosionMask[i] = eroI[i] / HEIGHT_SCALE;
      depositionMask[i] = depI[i] / HEIGHT_SCALE;
    }

    // shared post-processing — bit-identical to the CPU path
    const out = finalizeErosion({
      width, height, base: heightmap, map, flow, erosionMask, depositionMask, params: p,
    });
    const delta = new Float32Array(N);
    for (let i = 0; i < N; i++) delta[i] = out.eroded[i] - heightmap[i];
    onProgress?.(1, 'done');
    return { delta, ...out };
  } catch (err) {
    // drain the error scope if we threw before popping it
    device.popErrorScope().catch(() => {});
    throw err;
  } finally {
    for (const buf of allBufs) buf.destroy();
  }
}
