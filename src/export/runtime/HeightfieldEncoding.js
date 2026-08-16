export function vertexGridUv(index, resolution) {
  if (!Number.isInteger(resolution) || resolution < 2) throw new Error('Vertex-grid resolution must be at least 2.');
  if (!Number.isInteger(index) || index < 0 || index >= resolution) throw new Error('Vertex-grid index is out of range.');
  return index / (resolution - 1);
}

export function vertexGridWorldCoordinate(center, size, index, resolution) {
  return center + (vertexGridUv(index, resolution) - 0.5) * size;
}

export function decodePackedHeight01(pixels, pixelIndex) {
  const offset = pixelIndex * 4;
  return (pixels[offset] * 65536 + pixels[offset + 1] * 256 + pixels[offset + 2]) / 16777215;
}

// WebGL readRenderTargetPixels returns row zero from the render target's
// bottom edge. That is exactly the runtime contract's -Z to +Z row order, so
// Unity RAW data is packed without a vertical flip.
export function encodeUnityRaw16FromPackedPixels(pixels, width, height) {
  if (!(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) {
    throw new Error('Packed height pixels must be an RGBA Uint8Array matching the supplied dimensions.');
  }
  const raw = new Uint8Array(width * height * 2);
  const view = new DataView(raw.buffer);
  for (let index = 0; index < width * height; index++) {
    const value = Math.round(decodePackedHeight01(pixels, index) * 65535);
    view.setUint16(index * 2, value, true);
  }
  return raw;
}
