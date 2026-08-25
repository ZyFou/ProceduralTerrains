/**
 * Backend-neutral render-target readback. WebGLRenderer accepts a caller-owned
 * buffer while the universal renderer returns one, so callers use this single
 * async contract and never force a synchronous GPU read during export.
 */
export async function readRenderTargetPixelsAsync(
  renderer,
  renderTarget,
  x,
  y,
  width,
  height,
  buffer = null,
  { textureIndex = 0, faceIndex = 0 } = {},
) {
  if (!renderer || !renderTarget) throw new Error('Renderer and render target are required');
  if (renderer.isWebGLRenderer) {
    const output = buffer || new Uint8Array(width * height * 4);
    if (typeof renderer.readRenderTargetPixelsAsync === 'function') {
      await renderer.readRenderTargetPixelsAsync(
        renderTarget,
        x,
        y,
        width,
        height,
        output,
        faceIndex,
        textureIndex,
      );
    } else {
      renderer.readRenderTargetPixels(renderTarget, x, y, width, height, output, faceIndex);
    }
    return output;
  }

  if (typeof renderer.readRenderTargetPixelsAsync !== 'function') {
    throw new Error('The active renderer does not provide asynchronous target readback');
  }
  const output = await renderer.readRenderTargetPixelsAsync(
    renderTarget,
    x,
    y,
    width,
    height,
    textureIndex,
    faceIndex,
  );
  if (buffer && output !== buffer) buffer.set(output);
  return buffer || output;
}
