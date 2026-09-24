// WebGL texture creation must stay with the renderer. This queue keeps the
// expensive byte transfers off the first terrain draw and bounds each task.
export const SURFACE_UPLOAD_BYTES_PER_TASK = 4 * 1024 * 1024;

const nextFrame = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(resolve);
  else setTimeout(resolve, 16);
});

const cancelled = () => Object.assign(new Error('Surface upload superseded'), {
  code: 'SURFACE_ATLAS_SUPERSEDED',
});

export async function uploadSurfaceTextures(renderer, atlas, {
  isCurrent = () => true,
  bytesPerTask = SURFACE_UPLOAD_BYTES_PER_TASK,
  onProgress,
} = {}) {
  if (!renderer?.initTexture) return;
  if (!isCurrent()) throw cancelled();
  const textures = [atlas.diffuse, atlas.props];
  if (atlas.backend !== 'array') {
    for (let index = 0; index < textures.length; index++) {
      await nextFrame();
      if (!isCurrent()) throw cancelled();
      renderer.initTexture(textures[index]);
      onProgress?.((index + 1) / textures.length);
    }
    return;
  }

  const gl = renderer.getContext();
  const state = renderer.state;
  for (const texture of textures) {
    texture.source.dataReady = false;
    renderer.initTexture(texture); // Allocates mip storage without transferring pixels.
  }
  const jobs = [];
  for (const texture of textures) {
    const handle = renderer.properties.get(texture).__webglTexture;
    if (!handle) throw new Error('Could not allocate surface texture array');
    for (let level = 0; level < texture.mipmaps.length; level++) {
      const mip = texture.mipmaps[level];
      const rowBytes = mip.width * 4;
      const rowsPerTask = Math.max(1, Math.floor(bytesPerTask / rowBytes));
      const layerBytes = mip.width * mip.height * 4;
      for (let layer = 0; layer < texture.image.depth; layer++) {
        for (let y = 0; y < mip.height; y += rowsPerTask) {
          const rows = Math.min(rowsPerTask, mip.height - y);
          const start = layer * layerBytes + y * rowBytes;
          jobs.push({ handle, level, layer, y, width: mip.width, rows,
            data: mip.data.subarray(start, start + rows * rowBytes) });
        }
      }
    }
  }

  let completed = 0;
  while (completed < jobs.length) {
    await nextFrame();
    if (!isCurrent()) throw cancelled();
    let taskBytes = 0;
    while (completed < jobs.length) {
      const job = jobs[completed];
      if (taskBytes > 0 && taskBytes + job.data.byteLength > bytesPerTask) break;
      state.bindTexture(gl.TEXTURE_2D_ARRAY, job.handle, gl.TEXTURE0);
      state.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY, job.level, 0, job.y, job.layer,
        job.width, job.rows, 1, gl.RGBA, gl.UNSIGNED_BYTE, job.data,
      );
      taskBytes += job.data.byteLength;
      completed++;
    }
    onProgress?.(completed / jobs.length);
  }
  // Prevent Three from scheduling its own whole-array transfer on first draw.
  for (const texture of textures) texture.source.dataReady = false;
}
