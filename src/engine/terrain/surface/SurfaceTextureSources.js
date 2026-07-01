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
  if (isSurfaceTextureSource(params.surfaceTextureSource)) return params.surfaceTextureSource;
  return params.surfaceTextureMode ? SURFACE_TEXTURE_SOURCE.DEFAULT : SURFACE_TEXTURE_SOURCE.PROCEDURAL;
}

export function normalizeSurfaceTextureParams(params = {}, source = params) {
  const surfaceTextureSource = isSurfaceTextureSource(source.surfaceTextureSource)
    ? source.surfaceTextureSource
    : normalizeSurfaceTextureSource(source);
  return {
    ...params,
    surfaceTextureSource,
    surfaceTextureMode: surfaceTextureSource !== SURFACE_TEXTURE_SOURCE.PROCEDURAL,
  };
}

export function sourceUsesTextureAtlas(source) {
  return source === SURFACE_TEXTURE_SOURCE.DEFAULT || source === SURFACE_TEXTURE_SOURCE.CUSTOM;
}
