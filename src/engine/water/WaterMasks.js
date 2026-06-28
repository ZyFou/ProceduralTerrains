// ============================================================================
// WaterMasks — CPU-side mask generation from terrain height data.
// Used for debug previews and export; not regenerated every frame.
// ============================================================================

/**
 * Generate water-related masks from a height sampler.
 * @param {object} opts
 * @param {function(number,number): number} opts.sampleHeight - height at world XZ
 * @param {number} opts.seaLevel
 * @param {number} opts.size - world extent (square)
 * @param {number} opts.resolution - pixels per side
 * @param {object} [opts.origin] - { x, z } world origin of the map
 */
export function generateWaterMasks({
  sampleHeight,
  seaLevel,
  size,
  resolution,
  origin = { x: 0, z: 0 },
}) {
  const res = Math.max(8, Math.min(2048, resolution | 0));
  const half = size * 0.5;
  const waterMask = new Float32Array(res * res);
  const depthMap = new Float32Array(res * res);
  const shorelineMask = new Float32Array(res * res);
  const foamMask = new Float32Array(res * res);
  const underwaterMask = new Float32Array(res * res);

  let maxDepth = 0.001;

  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const u = i / (res - 1);
      const v = j / (res - 1);
      const x = origin.x + (u - 0.5) * size;
      const z = origin.z + (v - 0.5) * size;
      const h = sampleHeight(x, z);
      const depth = seaLevel - h;
      const idx = j * res + i;

      if (depth > 0.02) {
        waterMask[idx] = 1;
        depthMap[idx] = depth;
        maxDepth = Math.max(maxDepth, depth);
        underwaterMask[idx] = depth > 0.5 ? 1 : 0;
      }
    }
  }

  // shoreline + foam from depth gradient
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const idx = j * res + i;
      if (waterMask[idx] < 0.5) continue;
      const depth = depthMap[idx];
      const dL = i > 0 ? depthMap[idx - 1] : depth;
      const dR = i < res - 1 ? depthMap[idx + 1] : depth;
      const dU = j > 0 ? depthMap[idx - res] : depth;
      const dD = j < res - 1 ? depthMap[idx + res] : depth;
      const grad = Math.max(
        Math.abs(depth - dL),
        Math.abs(depth - dR),
        Math.abs(depth - dU),
        Math.abs(depth - dD),
      );
      const shore = smoothstep(8, 0.5, depth) * (0.5 + grad * 0.15);
      shorelineMask[idx] = shore;
      foamMask[idx] = smoothstep(4, 0.8, depth) * (0.6 + grad * 0.2);
    }
  }

  // normalize depth map
  for (let i = 0; i < depthMap.length; i++) {
    if (waterMask[i] > 0.5) depthMap[i] /= maxDepth;
  }

  return {
    resolution: res,
    size,
    origin,
    seaLevel,
    maxDepth,
    waterMask,
    depthMap,
    shorelineMask,
    foamMask,
    underwaterMask,
  };
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Convert a float mask to PNG data URL for download. */
export function maskToPngDataUrl(mask, resolution, { colorize = false } = {}) {
  const data = new Uint8ClampedArray(resolution * resolution * 4);
  for (let i = 0; i < mask.length; i++) {
    const v = Math.max(0, Math.min(1, mask[i]));
    const p = i * 4;
    if (colorize) {
      data[p] = Math.round((1 - v) * 255);
      data[p + 1] = Math.round(v * 128);
      data[p + 2] = Math.round(v * 255);
    } else {
      const b = Math.round(v * 255);
      data[p] = data[p + 1] = data[p + 2] = b;
    }
    data[p + 3] = 255;
  }
  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(resolution, resolution);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export function downloadMaskPng(mask, resolution, filename, opts) {
  const url = maskToPngDataUrl(mask, resolution, opts);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

/** Encode a float mask as PNG bytes (Uint8Array) for bundling into a zip. */
export async function maskToPngBytes(mask, resolution, opts) {
  const url = maskToPngDataUrl(mask, resolution, opts);
  const blob = await (await fetch(url)).blob();
  return new Uint8Array(await blob.arrayBuffer());
}
