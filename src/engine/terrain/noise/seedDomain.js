// Convert user-facing integer seeds into compact noise-domain offsets.
//
// Adding the seed itself (or seed * 31.7) to noise coordinates eventually
// pushes those coordinates far enough out that GPU float precision collapses
// visible samples into square cells. This 32-bit avalanche keeps adjacent
// seeds decorrelated while bounding every coordinate to the same safe range as
// the engine's global seeded domain offset.
const UINT32_RANGE = 0x100000000;
const DOMAIN_RADIUS = 1024;

export function seedDomainOffset(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const seed = Math.trunc(numeric);
  if (seed === 0) return 0;

  let hash = seed >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return Math.fround((hash / UINT32_RANGE) * DOMAIN_RADIUS * 2 - DOMAIN_RADIUS);
}

export { DOMAIN_RADIUS as SEED_DOMAIN_RADIUS };
