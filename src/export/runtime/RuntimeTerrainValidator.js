export const RUNTIME_TERRAIN_FORMAT = 'procedural-terrains';
export const RUNTIME_TERRAIN_SCHEMA_VERSION = 1;
export const UNITY_HEIGHTFIELD_RESOLUTIONS = Object.freeze([513, 1025, 2049, 4097]);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export function isSafeArtifactPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')) return false;
  if (value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export function isUnityHeightfieldResolution(value) {
  return Number.isInteger(value) && UNITY_HEIGHTFIELD_RESOLUTIONS.includes(value);
}

export function validateRuntimeTerrainDocument(document) {
  const diagnostics = [];
  const add = (status, code, message, path = '') => diagnostics.push({ status, code, message, path });

  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    add('error', 'document.invalid', 'Runtime terrain document must be a JSON object.');
    return diagnostics;
  }
  if (document.format !== RUNTIME_TERRAIN_FORMAT) {
    add('error', 'format.unsupported', `Expected format “${RUNTIME_TERRAIN_FORMAT}”.`, 'format');
  }
  if (document.schemaVersion !== RUNTIME_TERRAIN_SCHEMA_VERSION) {
    const qualifier = Number(document.schemaVersion) > RUNTIME_TERRAIN_SCHEMA_VERSION ? 'newer' : 'unsupported';
    add('error', 'schema.unsupported', `Runtime terrain schema ${document.schemaVersion ?? 'missing'} is ${qualifier}; this exporter supports schema ${RUNTIME_TERRAIN_SCHEMA_VERSION}.`, 'schemaVersion');
  }
  if (!document.producer || typeof document.producer.name !== 'string' || !document.producer.name
      || typeof document.producer.appVersion !== 'string' || !document.producer.appVersion
      || !Number.isInteger(document.producer.generatorVersion) || document.producer.generatorVersion < 1) {
    add('error', 'producer.invalid', 'Producer name, app version, and generator version are required.', 'producer');
  }

  const project = document.project;
  if (!project || typeof project !== 'object') {
    add('error', 'project.missing', 'Project metadata is required.', 'project');
  } else {
    if (!['procedural', 'nodes', 'manual'].includes(project.mode)) {
      add('error', 'project.mode', 'Project mode must be procedural, nodes, or manual.', 'project.mode');
    }
    if (project.world !== 'studio') {
      add('error', 'project.world', 'Runtime document v1 supports studio worlds only.', 'project.world');
    }
    if ((project.tileShape ?? 'square') !== 'square') {
      add('error', 'project.tileShape', 'Runtime document v1 supports square tile assemblies only.', 'project.tileShape');
    }
    if (!Number.isInteger(project.seed) || project.seed < -2147483648 || project.seed > 2147483647) {
      add('error', 'project.seed', 'Project seed must be a 32-bit integer.', 'project.seed');
    }
  }

  const coordinates = document.coordinates;
  if (!coordinates || coordinates.units !== 'meters' || coordinates.upAxis !== '+Y'
      || coordinates.xAxis !== '+X' || coordinates.zAxis !== '+Z'
      || coordinates.unityMapping !== 'x,y,z' || coordinates.tilePivot !== 'center') {
    add('error', 'coordinates.unsupported', 'Coordinate convention must use meter units, +Y up, identity XYZ mapping, and center tile pivots.', 'coordinates');
  }

  const bounds = document.bounds;
  if (!bounds || !finite(bounds.minX) || !finite(bounds.minZ)
      || !finite(bounds.sizeX) || bounds.sizeX <= 0
      || !finite(bounds.sizeZ) || bounds.sizeZ <= 0
      || !finite(bounds.minHeight) || !finite(bounds.maxHeight)
      || bounds.maxHeight <= bounds.minHeight || !finite(bounds.seaLevel)) {
    add('error', 'bounds.invalid', 'Bounds must contain finite, positive horizontal sizes and an increasing height range.', 'bounds');
  }

  if (!Array.isArray(document.tiles) || document.tiles.length === 0) {
    add('error', 'tiles.missing', 'At least one terrain tile is required.', 'tiles');
  } else {
    const seen = new Set();
    let previous = null;
    for (let index = 0; index < document.tiles.length; index++) {
      const tile = document.tiles[index];
      const base = `tiles[${index}]`;
      if (!tile || typeof tile !== 'object') {
        add('error', 'tile.invalid', 'Tile entry must be an object.', base);
        continue;
      }
      if (!Number.isInteger(tile.cx) || !Number.isInteger(tile.cz)
          || tile.cx < -2147483648 || tile.cx > 2147483647
          || tile.cz < -2147483648 || tile.cz > 2147483647) {
        add('error', 'tile.coordinate', 'Tile coordinates must be 32-bit integers.', base);
      } else {
        const key = `${tile.cx},${tile.cz}`;
        if (seen.has(key)) add('error', 'tile.duplicate', `Duplicate tile coordinate ${key}.`, base);
        seen.add(key);
        if (previous && (tile.cz < previous.cz || (tile.cz === previous.cz && tile.cx < previous.cx))) {
          add('error', 'tile.order', 'Tiles must be sorted by cz, then cx.', base);
        }
        previous = tile;
      }
      if (!finite(tile.centerX) || !finite(tile.centerZ) || !finite(tile.size) || tile.size <= 0) {
        add('error', 'tile.bounds', 'Tile center and positive size are required.', base);
      }

      const heightfield = tile.heightfield;
      if (!heightfield || typeof heightfield !== 'object') {
        add('error', 'heightfield.missing', 'Every tile requires a heightfield.', `${base}.heightfield`);
      } else {
        if (!isSafeArtifactPath(heightfield.path)) {
          add('error', 'artifact.path', 'Heightfield path must be a safe forward-slash relative path.', `${base}.heightfield.path`);
        }
        if (!isUnityHeightfieldResolution(heightfield.resolution)) {
          add('error', 'heightfield.resolution', `Heightfield resolution must be one of ${UNITY_HEIGHTFIELD_RESOLUTIONS.join(', ')}.`, `${base}.heightfield.resolution`);
        }
        if (heightfield.encoding !== 'uint16-normalized'
            || heightfield.byteOrder !== 'little-endian'
            || heightfield.sampleLayout !== 'vertex-grid-inclusive'
            || heightfield.rowOrder !== 'negative-z-to-positive-z'
            || heightfield.columnOrder !== 'negative-x-to-positive-x') {
          add('error', 'heightfield.encoding', 'Heightfield encoding or sample orientation is unsupported.', `${base}.heightfield`);
        }
        if (!finite(heightfield.minHeight) || !finite(heightfield.maxHeight)
            || heightfield.maxHeight <= heightfield.minHeight) {
          add('error', 'heightfield.range', 'Heightfield requires an increasing finite height range.', `${base}.heightfield`);
        }
      }

      if (tile.splat != null) {
        if (!isSafeArtifactPath(tile.splat.path)) {
          add('error', 'artifact.path', 'Splat path must be a safe forward-slash relative path.', `${base}.splat.path`);
        }
        if (!Number.isInteger(tile.splat.width) || tile.splat.width <= 0
            || !Number.isInteger(tile.splat.height) || tile.splat.height <= 0) {
          add('error', 'splat.resolution', 'Splat dimensions must be positive integers.', `${base}.splat`);
        }
        const channels = tile.splat.channels;
        if (!Array.isArray(channels) || channels.join(',') !== 'desert,canyon,wetland,mountains') {
          add('error', 'splat.channels', 'Splat channels must be desert, canyon, wetland, and mountains in RGBA order.', `${base}.splat.channels`);
        }
      }
    }
  }

  if (document.generation != null) {
    if (typeof document.generation !== 'object' || Array.isArray(document.generation)
        || document.generation.sourceVersion !== 1
        || document.generation.authoritative !== 'baked'
        || !['procedural', 'nodes', 'manual'].includes(document.generation.kind)) {
      add('error', 'generation.invalid', 'Generation source must be a version 1 baked-authoritative procedural, nodes, or manual descriptor.', 'generation');
    }
  }

  if (!document.features || typeof document.features !== 'object' || Array.isArray(document.features)) {
    add('error', 'features.missing', 'Feature summary is required.', 'features');
  }

  if (document.unsupportedFeatures != null
      && (!Array.isArray(document.unsupportedFeatures)
        || document.unsupportedFeatures.some((feature) => typeof feature !== 'string'))) {
    add('error', 'features.unsupported', 'unsupportedFeatures must be an array of strings.', 'unsupportedFeatures');
  }

  return diagnostics;
}

export function runtimeDocumentHasErrors(document) {
  return validateRuntimeTerrainDocument(document).some((diagnostic) => diagnostic.status === 'error');
}
