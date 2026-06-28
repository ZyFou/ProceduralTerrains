// ============================================================================
// Erosion Web Worker. Keeps the (potentially multi-second) droplet + thermal
// simulation off the main thread so the app never freezes while baking. The
// heightmap and result grids are transferred (zero-copy) where possible.
//
// Protocol:
//   main → worker: { type:'erode', id, width, height, heightmap, params }
//   worker → main: { type:'progress', id, progress, phase }
//                  { type:'result', id, delta, flow, erosionMask,
//                                   depositionMask, sedimentMap, slopeMap }
//                  { type:'error', id, message }
//
// The worker returns `delta` (eroded - base) — the additive height-offset the
// engine feeds straight into the ErosionField — so the heightmap buffer can be
// transferred in (zero-copy) and the main thread never needs the base back.
// ============================================================================

import { erode } from './erosionSim.js';

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'erode') return;
  const { id, width, height, heightmap, params } = msg;

  try {
    const out = erode({
      width,
      height,
      heightmap,
      params,
      onProgress: (progress, phase) => {
        self.postMessage({ type: 'progress', id, progress, phase });
      },
    });
    // erode() leaves `heightmap` (the base) untouched, so the delta is exact.
    const delta = new Float32Array(out.eroded.length);
    for (let i = 0; i < delta.length; i++) delta[i] = out.eroded[i] - heightmap[i];

    self.postMessage(
      {
        type: 'result',
        id,
        delta,
        flow: out.flow,
        erosionMask: out.erosionMask,
        depositionMask: out.depositionMask,
        sedimentMap: out.sedimentMap,
        slopeMap: out.slopeMap,
      },
      [
        delta.buffer,
        out.flow.buffer,
        out.erosionMask.buffer,
        out.depositionMask.buffer,
        out.sedimentMap.buffer,
        out.slopeMap.buffer,
      ],
    );
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err?.message || err) });
  }
};
