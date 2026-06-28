// ============================================================================
// WaterExport — helpers for exporting water meshes and mask maps.
// ============================================================================

import * as THREE from 'three';
import { generateWaterMasks, maskToPngBytes } from './WaterMasks.js';
import { isWaterActive } from './WaterSettings.js';

/**
 * Build the requested water mask PNGs as a { filename: Uint8Array } map so the
 * caller can fold them into a single export zip (no separate downloads).
 * Returns an empty map when water is inactive or nothing is requested.
 */
export async function buildWaterMaskFiles({
  sampleHeight,
  seaLevel,
  size,
  resolution = 512,
  origin,
  options = {},
}) {
  if (!isWaterActive(options.waterMode ?? 'legacy', seaLevel)) return {};

  const wantMask = !!options.exportWaterMask;
  const wantDepth = !!options.exportDepthMap;
  const wantShore = !!options.exportShorelineMask;
  const wantFoam = !!options.exportFoamMask;
  if (!wantMask && !wantDepth && !wantShore && !wantFoam) return {};

  const masks = generateWaterMasks({ sampleHeight, seaLevel, size, resolution, origin });
  const prefix = options.filenamePrefix ?? 'water';
  const files = {};

  if (wantMask) files[`water/${prefix}-water-mask.png`] = await maskToPngBytes(masks.waterMask, masks.resolution);
  if (wantDepth) files[`water/${prefix}-depth-map.png`] = await maskToPngBytes(masks.depthMap, masks.resolution, { colorize: true });
  if (wantShore) files[`water/${prefix}-shoreline-mask.png`] = await maskToPngBytes(masks.shorelineMask, masks.resolution);
  if (wantFoam) files[`water/${prefix}-foam-mask.png`] = await maskToPngBytes(masks.foamMask, masks.resolution);

  return files;
}

/**
 * Build a simple water plane mesh for GLB export (separate named object).
 */
export function buildExportWaterPlane({ size, seaLevel, name = 'Water' }) {
  const geo = new THREE.PlaneGeometry(size, size);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a4a6e,
    transparent: true,
    opacity: 0.75,
    roughness: 0.2,
    metalness: 0.1,
    name: 'WaterMaterial',
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.position.y = seaLevel;
  return mesh;
}

export function buildWaterMetadata(params) {
  return {
    waterMode: params.waterMode,
    seaLevel: params.seaLevel,
    waterEnabled: params.waterEnabled,
    preset: params.waterQualityPreset,
  };
}
