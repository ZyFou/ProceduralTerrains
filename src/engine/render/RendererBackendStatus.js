// Renderer availability has two separate meanings:
// 1. the browser exposes a WebGPU device;
// 2. every material used by the editor has an exact TSL/WebGPU variant.
//
// Never collapse those into one boolean. Three's universal renderer can replace
// an unsupported ShaderMaterial with a generic NodeMaterial, which renders a
// frame but is not visual parity.

export const WEBGPU_SHADER_FAMILIES = Object.freeze([
  'height',
  'climate',
  'biome',
  'detail',
  'water',
  'cloud',
  'post',
]);

export const WEBGPU_RENDERER_STATUS = Object.freeze({
  phase: 'tsl-port',
  applicationReady: false,
  portedNodeFamilies: Object.freeze([
    'height',
    'climate',
    'biome',
    'detail',
    'water',
    'cloud',
    'post',
  ]),
  // Exact material parity is intentionally stricter than having a reusable
  // node function. These families still contain production ShaderMaterial
  // passes and therefore keep the main renderer on WebGL2.
  exactMaterialFamilies: Object.freeze([]),
});

export function getMissingWebGpuMaterialFamilies(status = WEBGPU_RENDERER_STATUS) {
  const exact = new Set(status.exactMaterialFamilies || []);
  return WEBGPU_SHADER_FAMILIES.filter((family) => !exact.has(family));
}

export function describeWebGpuApplicationStatus(status = WEBGPU_RENDERER_STATUS) {
  if (status.applicationReady) return 'WebGPU renderer validated';
  const missing = getMissingWebGpuMaterialFamilies(status);
  return `TSL migration in progress (${missing.join(', ')} material parity remaining)`;
}

