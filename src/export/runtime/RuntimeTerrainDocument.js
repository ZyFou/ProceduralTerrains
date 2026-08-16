import packageMetadata from '../../../package.json';
import { normalizeManualTerrainDocument } from '../../manual/ManualShapeCatalog.js';
import { migrateStack } from '../../engine/terrain/noise/NoiseStack.js';
import {
  RUNTIME_TERRAIN_FORMAT,
  RUNTIME_TERRAIN_SCHEMA_VERSION,
  validateRuntimeTerrainDocument,
} from './RuntimeTerrainValidator.js';

const GENERATION_PARAM_KEYS = Object.freeze([
  'noiseScale', 'noiseStrength', 'terrainSmoothing', 'octaves',
  'persistence', 'lacunarity', 'ridge', 'warp', 'falloff', 'edgeFalloffMode',
  'terrainFormationSeaLevel', 'moistScale', 'moistBias', 'biomeScale', 'tempBias',
]);

const clone = (value) => value == null ? value : structuredClone(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

// The editor exposes seeds as unsigned 32-bit values, while Unity serializes
// TerrainProjectAsset.Seed as a signed System.Int32. Converting through a JS
// bitwise operation preserves all 32 seed bits and produces the signed value
// accepted by the runtime document schema (for example, 0xffffffff -> -1).
const signedInt32Seed = (value) => Math.trunc(finite(value)) | 0;

function projectNoiseStack(raw) {
  const stack = migrateStack(raw);
  return {
    version: stack.version,
    globalSeed: finite(stack.globalSeed),
    normalizeOutput: stack.normalizeOutput === true,
    outputMin: finite(stack.outputMin),
    outputMax: finite(stack.outputMax, 1.35),
    layers: stack.layers.map((layer) => ({
      type: layer.type,
      enabled: layer.enabled !== false,
      blendMode: layer.blendMode,
      strength: finite(layer.strength, 1),
      opacity: finite(layer.opacity, 1),
      seedOffset: finite(layer.seedOffset),
      params: clone(layer.params ?? {}),
      masks: (layer.masks ?? []).map((mask) => ({
        type: mask.type,
        enabled: mask.enabled !== false,
        invert: mask.invert === true,
        params: clone(mask.params ?? {}),
      })),
    })),
  };
}

function projectGraph(raw) {
  const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const edges = Array.isArray(raw?.edges) ? raw.edges : [];
  return {
    version: Number.isInteger(raw?.version) ? raw.version : 1,
    mode: raw?.mode === 'noise' ? 'noise' : 'terrain',
    nodes: nodes
      .filter((node) => node && typeof node.id === 'string' && typeof node.type === 'string')
      .map((node) => ({
        id: node.id,
        type: node.type,
        params: node.type === 'currentTerrain' && node.params?.stack
          ? { ...clone(node.params), stack: projectNoiseStack(node.params.stack) }
          : clone(node.params ?? {}),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges
      .filter((edge) => edge && typeof edge.source === 'string' && typeof edge.target === 'string')
      .map((edge) => ({
        source: edge.source,
        sourceHandle: String(edge.sourceHandle ?? ''),
        target: edge.target,
        targetHandle: String(edge.targetHandle ?? ''),
        type: String(edge.type ?? ''),
      }))
      .sort((a, b) => `${a.target}:${a.targetHandle}:${a.source}:${a.sourceHandle}`
        .localeCompare(`${b.target}:${b.targetHandle}:${b.source}:${b.sourceHandle}`)),
  };
}

function generationParameters(params) {
  return Object.fromEntries(GENERATION_PARAM_KEYS
    .filter((key) => params?.[key] !== undefined)
    .map((key) => [key, clone(params[key])]));
}

function baseGeneration(payload, kind) {
  const params = payload?.params ?? {};
  const descriptor = {
    kind,
    parameters: generationParameters(params),
    noiseStack: projectNoiseStack(params.noiseStack),
  };
  if (kind === 'nodes') descriptor.graph = projectGraph(payload?.graph);
  return descriptor;
}

function projectGeneration(payload, mode, seed) {
  const generation = {
    sourceVersion: 1,
    authoritative: 'baked',
    kind: mode,
    seed,
    ...baseGeneration(payload, mode === 'nodes' ? 'nodes' : 'procedural'),
  };
  // The spread above installs the base kind; restore the public project kind
  // for manual documents and keep their base source in a nested descriptor.
  generation.kind = mode;
  if (mode === 'manual') {
    const manual = normalizeManualTerrainDocument(payload?.manualTerrain);
    generation.manualTerrain = manual;
    generation.base = manual.baseSource === 'nodes'
      ? baseGeneration(payload, 'nodes')
      : manual.baseSource === 'procedural'
        ? baseGeneration(payload, 'procedural')
        : { kind: 'flat' };
  }
  return generation;
}

function projectFeatures(payload, options) {
  const params = payload?.params ?? {};
  const manual = payload?.manualTerrain;
  const manualSurface = manual?.surfacePaint;
  const manualMaterials = manualSurface?.version === 2 ? manualSurface.materials : manualSurface;
  const manualProps = manualSurface?.version === 2 ? manualSurface.props : null;
  const splines = payload?.creatorTools?.splines;
  const features = {
    heightfield: true,
    splat: options.exportSplat === true,
    paint: payload?.paint != null,
    erosion: payload?.erosion != null || params.erosionEnabled === true,
    splines: Array.isArray(splines) && splines.length > 0,
    importedMaps: payload?.realWorldSource != null,
    surfaces: (typeof params.surfaceTextureSource === 'string'
      && params.surfaceTextureSource !== 'procedural')
      || params.surfaceTextureMode === true || manualMaterials != null,
    water: params.waterEnabled !== false && finite(params.seaLevel) > 0.5,
    props: params.propsEnabled === true || manualProps != null,
  };
  const unsupportedFeatures = [
    ['paint', features.paint],
    ['erosion', features.erosion],
    ['splines', features.splines],
    ['imported-maps', features.importedMaps],
    ['surface-materials', features.surfaces],
    ['water', features.water],
    ['props', features.props],
  ].filter(([, enabled]) => enabled).map(([name]) => name);
  return { features, unsupportedFeatures };
}

function tileArtifactPath(tile, multi, filename) {
  return multi ? `tiles/tile_${tile.cx}_${tile.cz}/${filename}` : filename;
}

export function buildRuntimeTerrainDocument(context = {}, options = {}) {
  const payload = context.projectPayload ?? {};
  const params = payload.params ?? {};
  const mode = ['procedural', 'nodes', 'manual'].includes(payload.editorMode)
    ? payload.editorMode
    : ['procedural', 'nodes', 'manual'].includes(context.projectMode)
      ? context.projectMode
      : 'procedural';
  const world = payload.worldMode ?? context.worldMode ?? 'studio';
  const tileShape = context.tileAssemblyShape === 'circle' ? 'circle' : 'square';
  const boardSize = finite(context.boardSize);
  const heightScale = finite(params.heightScale ?? context.heightScale);
  const seaLevel = finite(params.seaLevel ?? context.seaLevel);
  const seed = signedInt32Seed(params.seed ?? context.seed);
  const heightRes = Number(options.heightRes);
  const texRes = Number(options.texRes);
  const tiles = (Array.isArray(context.tiles) && context.tiles.length
    ? context.tiles : [{ cx: 0, cz: 0 }])
    .map(({ cx, cz }) => ({ cx: Number(cx), cz: Number(cz) }))
    .sort((a, b) => a.cz - b.cz || a.cx - b.cx);
  const multi = tiles.length > 1;
  const minCX = Math.min(...tiles.map((tile) => tile.cx));
  const maxCX = Math.max(...tiles.map((tile) => tile.cx));
  const minCZ = Math.min(...tiles.map((tile) => tile.cz));
  const maxCZ = Math.max(...tiles.map((tile) => tile.cz));
  const { features, unsupportedFeatures } = projectFeatures(payload, options);

  const document = {
    format: RUNTIME_TERRAIN_FORMAT,
    schemaVersion: RUNTIME_TERRAIN_SCHEMA_VERSION,
    producer: {
      name: 'Procedural Terrains',
      appVersion: packageMetadata.version,
      generatorVersion: 1,
    },
    project: { mode, world, tileShape, seed },
    coordinates: {
      units: 'meters', upAxis: '+Y', xAxis: '+X', zAxis: '+Z',
      unityMapping: 'x,y,z', tilePivot: 'center',
    },
    bounds: {
      minX: (minCX - 0.5) * boardSize,
      minZ: (minCZ - 0.5) * boardSize,
      sizeX: (maxCX - minCX + 1) * boardSize,
      sizeZ: (maxCZ - minCZ + 1) * boardSize,
      minHeight: 0,
      maxHeight: heightScale,
      seaLevel,
    },
    tiles: tiles.map((tile) => ({
      cx: tile.cx,
      cz: tile.cz,
      centerX: tile.cx * boardSize,
      centerZ: tile.cz * boardSize,
      size: boardSize,
      heightfield: {
        path: tileArtifactPath(tile, multi, 'heightmap.raw'),
        resolution: heightRes,
        encoding: 'uint16-normalized',
        byteOrder: 'little-endian',
        sampleLayout: 'vertex-grid-inclusive',
        rowOrder: 'negative-z-to-positive-z',
        columnOrder: 'negative-x-to-positive-x',
        minHeight: 0,
        maxHeight: heightScale,
      },
      ...(options.exportSplat ? {
        splat: {
          path: tileArtifactPath(tile, multi, 'splatmaps/biomes.png'),
          width: texRes,
          height: texRes,
          channels: ['desert', 'canyon', 'wetland', 'mountains'],
        },
      } : {}),
    })),
    generation: projectGeneration(payload, mode, seed),
    features,
    unsupportedFeatures,
  };

  return document;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function serializeRuntimeTerrainDocument(document) {
  return `${JSON.stringify(stableValue(document), null, 2)}\n`;
}

export function createRuntimeTerrainDocumentFile(context, options) {
  const document = buildRuntimeTerrainDocument(context, options);
  const diagnostics = validateRuntimeTerrainDocument(document);
  const errors = diagnostics.filter((diagnostic) => diagnostic.status === 'error');
  if (errors.length) throw new Error(errors.map((diagnostic) => diagnostic.message).join(' '));
  return {
    document,
    diagnostics,
    bytes: new TextEncoder().encode(serializeRuntimeTerrainDocument(document)),
  };
}
