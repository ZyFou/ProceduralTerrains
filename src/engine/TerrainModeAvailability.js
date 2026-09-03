export const FINAL_TERRAIN_WORLD_MODES = Object.freeze(['infinite', 'planet']);
export const FINAL_TERRAIN_PROJECT_MODES = Object.freeze(['nodes', 'manual']);

const worldModes = new Set(FINAL_TERRAIN_WORLD_MODES);
const projectModes = new Set(FINAL_TERRAIN_PROJECT_MODES);

export function requiresFinalTerrainShader({
  worldMode = null,
  projectMode = null,
  project = null,
} = {}) {
  const requestedWorldMode = worldMode ?? project?.worldMode ?? 'studio';
  const requestedProjectMode = projectMode ?? project?.editorMode ?? 'procedural';
  return worldModes.has(requestedWorldMode) || projectModes.has(requestedProjectMode);
}

export function finalTerrainShaderPendingError() {
  const error = new Error('Wait for the final terrain shader before opening Infinite World, Planet, Nodes, or Manual Terrain.');
  error.code = 'FINAL_TERRAIN_SHADER_PENDING';
  return error;
}
