import { estimateRenderTargetBytes } from './GpuResourceLedger.js';

// Three's public pixel formats (including integer textures).
const CHANNELS = { 1021: 1, 1022: 3, 1023: 4, 1026: 1, 1027: 1, 1028: 1, 1029: 1, 1030: 2, 1031: 2, 1032: 3, 1033: 4 };

/** On-demand estimates only. Walking geometry/materials must never run in _tick. */
export function inspectRenderResources({ scene, targets = {}, materials = [] } = {}) {
  const textures = new Set();
  const attributes = new Set();
  const seenMaterials = new Set();
  const seenTargets = new Set();
  const cpuBuffers = new Set();
  const entries = [];
  let unknownTextures = 0;
  const trackCpu = (array) => { if (ArrayBuffer.isView(array)) cpuBuffers.add(array.buffer); };
  const addTexture = (texture, owner) => {
    if (!texture?.isTexture || textures.has(texture)) return;
    textures.add(texture);
    const images = Array.isArray(texture.image) ? texture.image : [texture.image];
    let bytes = 0;
    for (const source of images) {
      const img = source?.image || source;
      trackCpu(img?.data);
      if (texture.isCompressedTexture) {
        for (const mip of source?.mipmaps || texture.mipmaps || []) {
          bytes += mip.data?.byteLength || 0;
          trackCpu(mip.data);
        }
      } else if (img?.width && img?.height) {
        bytes += estimateRenderTargetBytes({ width: img.width, height: img.height,
          type: texture.type, channels: CHANNELS[texture.format] || 4, depthBytes: 0,
          mipmaps: texture.generateMipmaps }) * Math.max(1, img.depth || 1);
      }
    }
    if (!bytes) unknownTextures += 1;
    entries.push({ owner, kind: 'texture', bytes, revision: texture.version });
  };
  // Attachments are included in their target, never counted again as uniforms.
  for (const [owner, target] of Object.entries(targets)) {
    if (!target || seenTargets.has(target)) continue;
    seenTargets.add(target);
    const colors = target.textures || [target.texture];
    let bytes = 0;
    for (const texture of colors) {
      if (!texture) continue;
      textures.add(texture);
      const color = estimateRenderTargetBytes({ width: target.width, height: target.height,
        type: texture.type, channels: CHANNELS[texture.format] || 4,
        depthBytes: 0, mipmaps: texture.generateMipmaps });
      // Multisampled attachments also retain a single-sample resolve texture.
      bytes += color * (target.samples > 0 ? target.samples + 1 : 1);
    }
    if (target.depthTexture) textures.add(target.depthTexture);
    if (target.depthBuffer !== false) {
      bytes += target.width * target.height * 4 * Math.max(1, target.samples || 1);
      if (target.samples > 0 && target.depthTexture) bytes += target.width * target.height * 4;
    }
    entries.push({ owner, kind: 'render-target', bytes, width: target.width, height: target.height });
  }
  const addMaterial = (material, owner) => {
    if (!material || seenMaterials.has(material)) return;
    seenMaterials.add(material);
    for (const value of Object.values(material)) if (value?.isTexture) addTexture(value, owner);
    for (const uniform of Object.values(material.uniforms || {})) {
      const values = Array.isArray(uniform.value) ? uniform.value : [uniform.value];
      for (const value of values) if (value?.isTexture) addTexture(value, owner);
    }
  };
  scene?.traverse?.((object) => {
    const owner = object.name || object.type || 'scene';
    const geometry = object.geometry;
    const list = [geometry?.index, ...Object.values(geometry?.attributes || {}),
      ...Object.values(geometry?.morphAttributes || {}).flat(), object.instanceMatrix, object.instanceColor];
    for (const attribute of list) {
      const buffer = attribute?.isInterleavedBufferAttribute ? attribute.data : attribute;
      if (!buffer?.array || attributes.has(buffer)) continue;
      attributes.add(buffer);
      trackCpu(buffer.array);
      entries.push({ owner, kind: 'geometry-buffer', bytes: buffer.array.byteLength });
    }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) addMaterial(material, owner);
  });
  for (const material of materials) addMaterial(material, 'retained-material');
  addTexture(scene?.background, 'background');
  addTexture(scene?.environment, 'environment');
  return {
    scope: 'reachable scene, retained materials and known pass resources; estimates, not measured VRAM',
    estimatedBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    cpuBackingBufferBytes: [...cpuBuffers].reduce((total, buffer) => total + buffer.byteLength, 0),
    unknownTextures, entries,
  };
}
