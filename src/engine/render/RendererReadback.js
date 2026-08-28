import { RGBAFormat, UnsignedByteType } from 'three';

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function canUseWebGl2PixelPack(renderer, renderTarget, output, textureIndex) {
  if (!renderer?.isWebGLRenderer || !ArrayBuffer.isView(output)) return false;
  const gl = renderer.getContext?.();
  if (!gl?.PIXEL_PACK_BUFFER || typeof gl.fenceSync !== 'function'
    || typeof gl.getBufferSubData !== 'function') return false;
  const texture = Array.isArray(renderTarget.texture)
    ? renderTarget.texture[textureIndex]
    : renderTarget.texture;
  return texture?.format === RGBAFormat
    && texture?.type === UnsignedByteType
    && (output instanceof Uint8Array || output instanceof Uint8ClampedArray);
}

async function readWebGl2PixelPack(
  renderer,
  renderTarget,
  x,
  y,
  width,
  height,
  output,
  faceIndex,
) {
  const gl = renderer.getContext();
  const pbo = gl.createBuffer();
  if (!pbo) throw new Error('Could not allocate a WebGL2 pixel-pack buffer');
  const previousTarget = renderer.getRenderTarget?.() || null;
  const previousFace = renderer.getActiveCubeFace?.() || 0;
  const previousMip = renderer.getActiveMipmapLevel?.() || 0;
  const previousPack = gl.getParameter?.(gl.PIXEL_PACK_BUFFER_BINDING) || null;
  let fence = null;

  try {
    try {
      renderer.setRenderTarget(renderTarget, faceIndex, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, output.byteLength, gl.STREAM_READ);
      gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!fence) throw new Error('Could not create a WebGL2 readback fence');
      gl.flush();
    } finally {
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previousPack);
    }

    for (;;) {
      const status = gl.clientWaitSync(fence, 0, 0);
      if (status === gl.CONDITION_SATISFIED || status === gl.ALREADY_SIGNALED) break;
      if (status === gl.WAIT_FAILED) throw new Error('WebGL2 asynchronous readback fence failed');
      await nextFrame();
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, output);
    return output;
  } finally {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previousPack);
    if (fence) gl.deleteSync(fence);
    gl.deleteBuffer(pbo);
  }
}

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
    } else if (canUseWebGl2PixelPack(renderer, renderTarget, output, textureIndex)) {
      await readWebGl2PixelPack(
        renderer,
        renderTarget,
        x,
        y,
        width,
        height,
        output,
        faceIndex,
      );
    } else {
      // WebGL1 and uncommon target formats keep the compatibility path. All
      // normal editor targets are WebGL2 RGBA8 and use the non-blocking PBO
      // branch above.
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
