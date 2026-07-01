export const SURFACE_TEXTURE_SOURCE = Object.freeze({
  PROCEDURAL: 'procedural',
  DEFAULT: 'defaultTextures',
  CUSTOM: 'customTextures',
});

const SOURCE_VALUES = new Set(Object.values(SURFACE_TEXTURE_SOURCE));

export function isSurfaceTextureSource(value) {
  return SOURCE_VALUES.has(value);
}

export function normalizeSurfaceTextureSource(params = {}) {
  if (params.surfaceTextureSource === SURFACE_TEXTURE_SOURCE.PROCEDURAL) return SURFACE_TEXTURE_SOURCE.PROCEDURAL;
  if (params.surfaceTextureSource === SURFACE_TEXTURE_SOURCE.CUSTOM) return SURFACE_TEXTURE_SOURCE.CUSTOM;
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
    surfaceTextureMode: surfaceTextureSource !== SURFACE_TEXTURE_SOURCE.PROCEDURAL,
  };
}

export function sourceUsesTextureAtlas(source) {
  return normalizeSurfaceTextureSource({ surfaceTextureSource: source }) === SURFACE_TEXTURE_SOURCE.CUSTOM;
}
