import { describeTextureFilename } from './SurfaceTextureDetector.js';
import { SURFACE_TEXTURE_VARIANT_COUNT } from './SurfaceTextureRoles.js';

export const SURFACE_IMAGE_EXT_RE = /\.(png|jpe?g|webp|avif|gif|bmp)$/i;

export function mimeForSurfaceTexture(name) {
  const extension = name.toLowerCase().split('.').pop();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp' })[extension] || 'application/octet-stream';
}

// Entries can come from loose files or any depth inside a ZIP. The caller
// supplies the archive name as scope so separate archives cannot mix their maps.
// Group only by explicit path/name; never guess the target terrain role.
export function collectSurfaceTextureSets(entries, mapSlots) {
  const groups = new Map();
  const unmatched = [];
  for (const entry of entries) {
    const path = entry.name.replace(/\\/g, '/');
    const parts = path.split('/');
    if (parts.some((part) => part.startsWith('.') || part === '__MACOSX')) continue;
    const info = describeTextureFilename(path);
    if (!SURFACE_IMAGE_EXT_RE.test(path)) {
      if (info) unmatched.push(`${entry.name}: unsupported image format`);
      continue;
    }
    if (!info || !mapSlots.includes(info.slot)) {
      unmatched.push(`${entry.name}: unrecognized or unsupported map type`);
      continue;
    }
    const directory = parts.slice(0, -1).join('/').toLowerCase();
    const key = JSON.stringify([entry.scope || '', directory, info.setName]);
    if (!groups.has(key)) groups.set(key, { name: info.setName || directory || entry.scope || 'Material', maps: new Map() });
    const group = groups.get(key);
    if (group.maps.has(info.slot)) {
      unmatched.push(`${entry.name}: duplicate ${info.slot} in ${group.name}`);
      continue;
    }
    group.maps.set(info.slot, entry);
  }
  return { sets: [...groups.values()], unmatched };
}

// The first set belongs to the explicitly chosen variant. Additional sets use
// only wholly empty variants, including slots holding optional maps. Never
// overwrite another variant or wrap an overflowing pack back to V1.
export function planSurfaceTextureImport(sets, variantIndex, isEmpty) {
  const assignments = [];
  const unmatched = [];
  const available = Array.from({ length: SURFACE_TEXTURE_VARIANT_COUNT }, (_, index) => index)
    .filter((index) => index !== variantIndex && isEmpty(index));
  for (const [index, set] of sets.entries()) {
    const target = index === 0 ? variantIndex : available.shift();
    if (!Number.isInteger(target) || target < 0 || target >= SURFACE_TEXTURE_VARIANT_COUNT) {
      unmatched.push(`${set.name}: no empty variant available; open a variant to replace it`);
      continue;
    }
    for (const [slot, entry] of set.maps) assignments.push({ ...entry, slot, variantIndex: target });
  }
  return { assignments, unmatched };
}
