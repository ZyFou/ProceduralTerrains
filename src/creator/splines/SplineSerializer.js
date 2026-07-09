export const SPLINE_VERSION = 1;

export function serializeSplines(splines) {
  return (splines || []).map((s) => JSON.parse(JSON.stringify(s)));
}

export function migrateSplines(value) {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => ({
    id: raw.id || `spline-${index + 1}`,
    name: raw.name || `${raw.type === 'river' ? 'River' : 'Road'} ${index + 1}`,
    type: raw.type === 'river' ? 'river' : 'road', enabled: raw.enabled !== false,
    visible: raw.visible !== false, locked: !!raw.locked, controlPoints: Array.isArray(raw.controlPoints) ? raw.controlPoints.map((p, pIndex) => ({
      id: p.id || `${raw.id || `spline-${index + 1}`}-point-${pIndex + 1}`,
      x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0,
      widthMultiplier: Number.isFinite(p.widthMultiplier) ? p.widthMultiplier : 1,
      depthMultiplier: Number.isFinite(p.depthMultiplier) ? p.depthMultiplier : 1,
      lockedToTerrain: p.lockedToTerrain !== false,
    })) : [],
    closed: !!raw.closed, interpolation: raw.interpolation === 'linear' ? 'linear' : 'catmull-rom',
    resolution: raw.resolution || 'auto', width: Math.max(1, Number(raw.width) || (raw.type === 'river' ? 34 : 24)),
    falloff: Math.max(0, Number(raw.falloff) ?? 18), heightMode: raw.heightMode || (raw.type === 'river' ? 'carve' : 'flatten'),
    targetHeight: Number(raw.targetHeight) || 0, heightOffset: Number(raw.heightOffset) || 0,
    depth: Math.max(0, Number(raw.depth) || (raw.type === 'river' ? 14 : 0)),
    bankWidth: Math.max(0, Number(raw.bankWidth) ?? 18), bankSoftness: Math.max(0, Number(raw.bankSoftness) ?? .7),
    materialMask: raw.materialMask !== false, biome: raw.biome || (raw.type === 'river' ? 'wetland' : 'canyon'),
    clearProps: raw.clearProps !== false, propClearRadius: Math.max(0, Number(raw.propClearRadius) || 0),
    renderSettings: { water: raw.type === 'river' ? raw.renderSettings?.water !== false : false },
    createdAt: raw.createdAt || new Date().toISOString(), updatedAt: raw.updatedAt || new Date().toISOString(),
  }));
}
