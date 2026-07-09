import { UnityPreset } from './presets/UnityPreset.js';
import { UnrealPreset } from './presets/UnrealPreset.js';
import { GodotPreset } from './presets/GodotPreset.js';
import { BlenderPreset } from './presets/BlenderPreset.js';
import { ThreePreset } from './presets/ThreePreset.js';

export const EXPORT_PRESETS = [UnityPreset, UnrealPreset, GodotPreset, BlenderPreset, ThreePreset];
export const EXPORT_PRESET_OPTIONS = [{ value: 'custom', label: 'Custom export' }, ...EXPORT_PRESETS.map(({ id, label }) => ({ value: id, label }))];

export function getExportPreset(id) {
  return EXPORT_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function applyExportPreset(options, id) {
  const preset = getExportPreset(id);
  if (!preset) return { ...options, exportPresetId: 'custom', packageRoot: null, packagePaths: null, heightmapRawPath: null };
  return {
    ...options, ...preset.defaults, exportPresetId: preset.id,
    packageRoot: preset.layout.root, packagePaths: preset.layout.paths,
    heightmapRawPath: preset.layout.heightmapRawPath ?? null,
  };
}

export function createProductionFiles(options, context) {
  const preset = getExportPreset(options.exportPresetId);
  if (!preset) return {};
  const root = preset.layout.root;
  const terrainSize = Number(context.boardSize) || 0;
  const metadata = {
    app: 'Procedural Terrains', version: 1, preset: preset.id,
    generatedAt: new Date().toISOString(), seed: context.seed,
    worldSizeMeters: terrainSize, heightRangeMeters: Number(context.heightScale) || 0,
    coordinateSystem: preset.id === 'unreal' ? 'Unreal centimeters (Z-up import)' : 'Y-up meters',
    files: preset.layout.paths,
  };
  const readme = `${preset.label}\n\nImport the files in this folder using your engine's terrain import workflow.\nWorld size: ${terrainSize} m. Height range: ${metadata.heightRangeMeters} m.\n`;
  const encode = (value) => new TextEncoder().encode(value);
  return {
    [`${root}/terrain.json`]: encode(JSON.stringify(metadata, null, 2)),
    [`${root}/README.txt`]: encode(readme),
  };
}
