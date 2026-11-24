// Shared by the studio and the npm runtime. No DOM, storage or render-loop ownership.
function mulberry32(a) {
  return function () {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function terrainSeedOffset(seed) {
  const rng = mulberry32(seed >>> 0);
  return { x: rng() * 2048 - 1024, y: rng() * 2048 - 1024 };
}

export function applyTerrainShapeUniforms(u, p, size) {
  const offset = terrainSeedOffset(p.seed);
  u.uSeedOffset.value.set(offset.x, offset.y);

  u.uFrequency.value = (p.noiseScale * 0.1) / size;
  if (u.uDryCanyon) u.uDryCanyon.value = p.preset === 'dryCanyon' ? 1 : 0;
  u.uHeightScale.value = p.heightScale;
  u.uSeaLevel.value = p.seaLevel;
  u.uTerrainFormationSeaLevel.value = p.terrainFormationSeaLevel;
  u.uAmplitude.value = p.noiseStrength;
  u.uTerrainSmoothing.value = p.terrainSmoothing ?? 0;
  if (u.uTerrainDetailCut) u.uTerrainDetailCut.value = 1 - Math.min(1, Math.max(0, p.terrainDetail ?? 1));
  u.uPersistence.value = p.persistence;
  u.uLacunarity.value = p.lacunarity;
  u.uRidge.value = p.ridge;
  u.uWarp.value = p.warp;
  u.uFalloff.value = p.falloff;
  u.uEdgeFalloffMode.value = p.edgeFalloffMode === 'mountains' ? 1 : 0;
  u.uBoardHalf.value = size / 2;
  u.uChunkSize.value = p.chunkSize;
}

export function applyTerrainShadingUniforms(u, p, { size, skirtDepth, wallThickness }) {
  u.uMoistScale.value = p.moistScale;
  u.uMoistBias.value = p.moistBias;
  u.uBiomeScale.value = p.biomeScale;
  u.uTempBias.value = p.tempBias;
  u.uBiomeDebug.value = p.biomeDebug ? 1 : 0;
  u.uSnowLine.value = p.snowLine;
  u.uNormalStrength.value = p.normalStrength;
  u.uAO.value = p.aoStrength;
  u.uAORidge.value = p.aoRidge ?? 0;
  // Slope gates — keep each pair ordered so the smoothstep edges stay valid
  // whatever the two sliders are set to.
  {
    const rockLo = p.rockSlopeLo ?? 0.42;
    const snowMin = p.snowSlopeMin ?? 0.30;
    u.uRockSlopeLo.value = rockLo;
    u.uRockSlopeHi.value = Math.max(p.rockSlopeHi ?? 0.72, rockLo + 0.01);
    u.uSnowSlopeMin.value = snowMin;
    u.uSnowSlopeMax.value = Math.max(p.snowSlopeMax ?? 0.62, snowMin + 0.01);
  }
  u.uGrid.value = p.chunkGrid ? 1 : 0;
  u.uLodDebug.value = p.lodDebug ? 1 : 0;
  u.uEps.value = Math.max(0.35, size / 4096);
  u.uSkirtDepth.value = skirtDepth;
  u.uPlinthBaseY.value = -skirtDepth;   // perimeter wall drops to plinth base
  u.uWallThickness.value = wallThickness;
}
