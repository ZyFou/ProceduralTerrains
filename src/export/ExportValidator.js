const MAX_TEXTURE_RESOLUTION = 4096;
const MAX_MESH_RESOLUTION = 1024;

export function validateExport(options = {}, context = {}) {
  const checks = [];
  const add = (status, message) => checks.push({ status, message });
  const texRes = Number(options.texRes) || 0;
  const meshRes = Number(options.meshRes) || 0;

  if (context.worldMode === 'planet' && options.exportPresetId && options.exportPresetId !== 'custom') {
    add('warning', 'Engine presets currently package studio terrain exports; planet export keeps its native layout.');
  }
  if (!(Number(context.boardSize) > 0)) add('error', 'Terrain scale is invalid.');
  else add('success', `Terrain scale valid (${Math.round(context.boardSize)} m board).`);
  if (!options.includeMesh && !options.exportHeightmap) add('error', 'Select a terrain mesh or a heightmap to export.');
  if (options.exportHeightmap && ![512, 1024, 2048, 4096].includes(texRes)) add('error', 'Heightmap resolution must be 512, 1024, 2048, or 4096.');
  else if (options.exportHeightmap) add('success', `Heightmap ${texRes} × ${texRes}.`);
  if (texRes > MAX_TEXTURE_RESOLUTION) add('error', 'Texture resolution exceeds the supported 4096 limit.');
  else if (texRes >= 4096) add('warning', '4K maps can require substantial GPU memory.');
  if (meshRes > MAX_MESH_RESOLUTION) add('error', 'Mesh density exceeds the supported 1024 limit.');
  else if (options.includeMesh) add('success', `Mesh density ${meshRes} × ${meshRes}.`);
  if (options.exportWater && !options.exportWaterMask) add('warning', 'Water is included without a water mask.');
  else if (options.exportWaterMask) add('success', 'Water mask available.');
  if (options.exportSplat) add('success', 'Biome splat map available.');
  return checks;
}

export function hasExportErrors(checks) {
  return checks.some((check) => check.status === 'error');
}
