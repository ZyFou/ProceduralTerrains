import * as THREE from 'three';

export const CINEMATIC_WATER_SEGMENTS = Object.freeze({
  low: 96,
  medium: 144,
  high: 192,
});

export function resolveCinematicWaterSegments(waterQuality = 2) {
  const quality = Math.round(Number(waterQuality) || 0);
  if (quality >= 2) return CINEMATIC_WATER_SEGMENTS.high;
  if (quality >= 1) return CINEMATIC_WATER_SEGMENTS.medium;
  return CINEMATIC_WATER_SEGMENTS.low;
}

export function shouldUseCinematicWaterGeometry(
  mode,
  worldMode,
  fpsDowngraded = false,
) {
  return mode === 'cinematic'
    && worldMode === 'studio'
    && !fpsDowngraded;
}

/**
 * Unit-size grid that preserves the legacy water mesh footprint. The vertex
 * shader redistributes these vertices around the camera, so the dense central
 * patch follows the view without rebuilding position buffers every frame.
 */
export function createCinematicWaterGeometry(segments) {
  const resolved = Math.max(2, Math.round(Number(segments) || 2));
  const geometry = new THREE.PlaneGeometry(1, 1, resolved, resolved);
  geometry.rotateX(-Math.PI / 2);
  geometry.name = 'CinematicWaterGrid';
  geometry.userData.cinematicWater = true;
  geometry.userData.segments = resolved;
  return geometry;
}

export function getWaterGeometryDiagnostics(geometry) {
  if (!geometry) {
    return {
      mode: 'none',
      segments: 0,
      vertices: 0,
      triangles: 0,
      memoryBytes: 0,
    };
  }
  const position = geometry.getAttribute?.('position');
  const vertices = position?.count ?? 0;
  const indexCount = geometry.index?.count ?? 0;
  const triangles = indexCount
    ? Math.floor(indexCount / 3)
    : Math.floor(vertices / 3);
  let memoryBytes = geometry.index?.array?.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes ?? {})) {
    memoryBytes += attribute?.array?.byteLength ?? 0;
  }
  return {
    mode: geometry.userData?.cinematicWater ? 'camera-density-grid' : 'single-quad',
    segments: geometry.userData?.segments ?? 1,
    vertices,
    triangles,
    memoryBytes,
  };
}
