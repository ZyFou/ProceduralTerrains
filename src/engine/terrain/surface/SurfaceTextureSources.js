export const SURFACE_TEXTURE_SOURCE = Object.freeze({
  PROCEDURAL: 'procedural',
  // Shader-only like Procedural, with layered-rock relief, strata banding and
  // soil / vegetation breakup from the shared V2 noise volume.
  PROCEDURAL_V2: 'proceduralV2',
  PBR: 'pbrLibrary',
  DEFAULT: 'defaultTextures',
  CUSTOM: 'customTextures',
  BUILT_IN: 'builtInTextures',
});

const SOURCE_VALUES = new Set(Object.values(SURFACE_TEXTURE_SOURCE));

export function isSurfaceTextureSource(value) {
  return SOURCE_VALUES.has(value);
}

/** Sources that shade from shader code alone (no material atlas). */
export function isProceduralSurfaceSource(source) {
  return source === SURFACE_TEXTURE_SOURCE.PROCEDURAL
    || source === SURFACE_TEXTURE_SOURCE.PROCEDURAL_V2;
}

export function normalizeSurfaceTextureSource(params = {}) {
  if (params.surfaceTextureSource === SURFACE_TEXTURE_SOURCE.PBR) return SURFACE_TEXTURE_SOURCE.PBR;
  if (params.surfaceTextureSource === SURFACE_TEXTURE_SOURCE.PROCEDURAL) return SURFACE_TEXTURE_SOURCE.PROCEDURAL;
  if (params.surfaceTextureSource === SURFACE_TEXTURE_SOURCE.PROCEDURAL_V2) return SURFACE_TEXTURE_SOURCE.PROCEDURAL_V2;
  if (params.surfaceTextureSource === SURFACE_TEXTURE_SOURCE.CUSTOM) return SURFACE_TEXTURE_SOURCE.CUSTOM;
  if (params.surfaceTextureSource === SURFACE_TEXTURE_SOURCE.BUILT_IN) return SURFACE_TEXTURE_SOURCE.BUILT_IN;
  // defaultTextures is kept only as a save-compatibility value. The active
  // product surface now has two modes: procedural shader or custom materials.
  if (params.surfaceTextureSource === SURFACE_TEXTURE_SOURCE.DEFAULT) return SURFACE_TEXTURE_SOURCE.CUSTOM;
  return params.surfaceTextureMode ? SURFACE_TEXTURE_SOURCE.CUSTOM : SURFACE_TEXTURE_SOURCE.PROCEDURAL;
}

export function normalizeSurfaceTextureParams(params = {}, source = params) {
  const surfaceTextureSource = normalizeSurfaceTextureSource(source);
  return {
    ...params,
    surfaceTextureSource,
    surfaceTextureMode: !isProceduralSurfaceSource(surfaceTextureSource),
  };
}

export function sourceUsesTextureAtlas(source) {
  return !isProceduralSurfaceSource(normalizeSurfaceTextureSource({ surfaceTextureSource: source }));
}
