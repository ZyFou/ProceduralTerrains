import { SURFACE_TEXTURE_SOURCE } from './SurfaceTextureSources.js';

const usesPbrSurface = (program) => !!program?.surface && !program.surface.procedural;

/**
 * Surface-texture params a compiled terrain graph requires, or null when the
 * graph has no PBR material surface. The texture amount is raised to 1 only
 * when the PBR surface is new: a fresh project document (`fresh`), or a graph
 * edit whose previous program had no PBR surface. Re-compiling an existing PBR
 * graph keeps the user's amount.
 */
export function graphSurfaceTextureParams(program, { previousProgram = null, fresh = false } = {}) {
  if (!usesPbrSurface(program)) return null;
  const patch = { surfaceTextureSource: SURFACE_TEXTURE_SOURCE.PBR, surfaceTextureMode: true };
  if (fresh || !usesPbrSurface(previousProgram)) patch.surfaceTextureAmount = 1;
  return patch;
}
