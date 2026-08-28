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

// Concrete runtime coverage is stricter than reusable node-family coverage.
// A hidden authoring/export pass can still crash a native WebGPU session even
// when the visible terrain is already a NodeMaterial, so every production
// custom material is named here and must have a native canary result.
export const WEBGPU_PRODUCTION_MATERIALS = Object.freeze([
  'terrain-studio',
  'terrain-manual',
  'terrain-nodes',
  'terrain-infinite',
  'terrain-planet',
  'water-studio-legacy',
  'water-studio-realistic',
  'water-infinite',
  'water-planet',
  'cloud-studio',
  'cloud-planet',
  'cloud-occupancy',
  'cloud-composite',
  'sky-procedural',
  'post-look',
  'post-camera',
  'underwater',
  'height-baker-studio',
  'height-baker-planet',
  'export-studio',
  'export-planet',
  'props-standard-patches',
]);

const PORTED_PRODUCTION_MATERIALS = Object.freeze([
  'sky-procedural',
  'post-look',
  'post-camera',
  'underwater',
  'cloud-composite',
  'cloud-occupancy',
]);

const VALIDATED_PRODUCTION_MATERIALS = Object.freeze([]);
const EXACT_MATERIAL_FAMILIES = Object.freeze([]);
const APPLICATION_READY = WEBGPU_SHADER_FAMILIES.every(
  (family) => EXACT_MATERIAL_FAMILIES.includes(family),
) && WEBGPU_PRODUCTION_MATERIALS.every(
  (material) => VALIDATED_PRODUCTION_MATERIALS.includes(material),
);

export const WEBGPU_RENDERER_STATUS = Object.freeze({
  phase: 'tsl-port',
  applicationReady: APPLICATION_READY,
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
  exactMaterialFamilies: EXACT_MATERIAL_FAMILIES,
  requiredProductionMaterials: WEBGPU_PRODUCTION_MATERIALS,
  portedProductionMaterials: PORTED_PRODUCTION_MATERIALS,
  validatedProductionMaterials: VALIDATED_PRODUCTION_MATERIALS,
});

export function getMissingWebGpuProductionMaterials(status = WEBGPU_RENDERER_STATUS) {
  const validated = new Set(status.validatedProductionMaterials || []);
  return WEBGPU_PRODUCTION_MATERIALS.filter((material) => !validated.has(material));
}

export function getMissingWebGpuMaterialFamilies(status = WEBGPU_RENDERER_STATUS) {
  const exact = new Set(status.exactMaterialFamilies || []);
  return WEBGPU_SHADER_FAMILIES.filter((family) => !exact.has(family));
}

export function describeWebGpuApplicationStatus(status = WEBGPU_RENDERER_STATUS) {
  if (status.applicationReady) return 'WebGPU renderer validated';
  const ported = status.portedProductionMaterials?.length || 0;
  const required = WEBGPU_PRODUCTION_MATERIALS.length;
  const missing = getMissingWebGpuMaterialFamilies(status);
  return `TSL migration in progress (${ported}/${required} production materials ported; ${missing.join(', ')} parity remaining)`;
}
