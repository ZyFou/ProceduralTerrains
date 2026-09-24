import { buildActiveSurfaceAtlas } from './applyTerrainSurface.js';
import { serializePreparedSurface } from './SurfacePreparationWire.js';

self.onmessage = async ({ data }) => {
  const { id, options } = data;
  try {
    const atlas = await buildActiveSurfaceAtlas(options);
    const { result, transfer } = serializePreparedSurface(atlas);
    atlas.diffuse.dispose();
    atlas.props.dispose();
    self.postMessage({ id, result }, transfer);
  } catch (error) {
    self.postMessage({ id, error: { name: error.name, message: error.message, stack: error.stack } });
  }
};
