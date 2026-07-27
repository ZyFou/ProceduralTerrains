// ============================================================================
// WaterDebugViews — debug overlay helpers for the water pipeline.
// ============================================================================

import { setWaterDebugMode } from './RealisticWaterMaterial.js';

export const WATER_DEBUG_VIEWS = [
  { value: 'off', label: 'Off' },
  { value: 'depth', label: 'Depth Map' },
  { value: 'shoreline', label: 'Shoreline Mask' },
  { value: 'foam', label: 'Foam Mask' },
  { value: 'mask', label: 'Water Mask' },
  { value: 'normal', label: 'Surface Normal' },
  { value: 'opticalDepth', label: 'Optical Depth' },
  { value: 'transmittance', label: 'Transmittance' },
  { value: 'fresnel', label: 'Fresnel' },
  { value: 'reflection', label: 'Sky Reflection' },
  { value: 'refraction', label: 'Transmission / Refraction' },
  { value: 'opacity', label: 'Final Opacity' },
];

export function applyWaterDebugToMaterials(materials, debugView) {
  for (const mat of materials) {
    if (mat?.uniforms?.uDebugMode) setWaterDebugMode(mat, debugView);
  }
}

export function waterDebugActive(debugView) {
  return debugView && debugView !== 'off';
}
