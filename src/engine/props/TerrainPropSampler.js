// ============================================================================
// TerrainPropSampler — one query surface for prop placement.
//
// Wraps the existing height fields (TerrainHeightSampler for flat Tile/Infinite,
// PlanetHeightSampler for Planet) and the paint layers, exposing a single rich
// sample record that the placement masks consume. We do NOT re-derive any height
// math here — every field comes from samplers that are already f32-exact ports
// of the rendered GLSL, so props land on the real visual surface.
//
//   FlatPropSampler.sampleAt(x, z)            → record
//   PlanetPropSampler.sampleAt3D(dx, dy, dz)  → record (dir must be unit length)
//
// record = {
//   height, position:[x,y,z], normal:{x,y,z}, slope (0..1),
//   biomeWeights:{desert,canyon,wetland,mountains}, moisture, temperature,
//   water (bool), shoreDistance (height - waterLevel), mask (paint props or null),
//   surfaceRadius? (planet only)
// }
// ============================================================================

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export class FlatPropSampler {
  /**
   * @param {object} opts
   * @param {TerrainHeightSampler} opts.cpu
   * @param {function} opts.getWaterLevel        () => number
   * @param {function} [opts.getHeightOffset]    (x,z) => number   paint height (studio)
   * @param {function} [opts.getPaintBiomeWeights] (x,z) => weights|null
   * @param {function} [opts.getPaintMask]        (x,z) => {grass,flowers,mixed}|null
   * @param {function} [opts.getPropExclusion]    (x,z) => 0..1 spline exclusion
   */
  constructor({ cpu, surfaceField, getWaterLevel, getHeightOffset, getPaintBiomeWeights, getPaintMask, getPropExclusion }) {
    this.cpu = cpu;
    this.surfaceField = surfaceField || null;   // GPU faceted-surface readback
    this.getWaterLevel = getWaterLevel;
    this.getHeightOffset = getHeightOffset || (() => 0);
    this.getPaintBiomeWeights = getPaintBiomeWeights || (() => null);
    this.getPaintMask = getPaintMask || (() => null);
    this.getPropExclusion = getPropExclusion || (() => 0);
  }

  /** Cheap paint-mask density (0..1) for the density pre-gate — no terrain eval. */
  paintDensityAt(x, z) {
    const m = this.getPaintMask(x, z);
    return m ? Math.max(m.grass, m.flowers, m.mixed) : 0;
  }

  /** Center the faceted-surface readback tile on the build area up-front. */
  prime(cx, cz) { this.surfaceField?.prime(cx, cz); }

  sampleAt(x, z) {
    const waterLevel = this.getWaterLevel();
    const paintOffset = this.getHeightOffset(x, z);
    const info = this.cpu.sampleSurfaceInfo(x, z, {
      waterLevel,
      paintHeightOffset: paintOffset,
      paintBiomeWeights: this.getPaintBiomeWeights(x, z),
      eps: 2.0,
    });
    const climate = this.cpu.climateAt(x, z);
    // Anchor height to the ACTUAL rendered (faceted) mesh so props sit on the
    // visible surface, not the smooth analytic field that floats above crests.
    // Slope/biome/climate stay analytic (smooth normals look better than the
    // faceted ones, and biome is a smooth field anyway).
    let height = info.height;
    if (this.surfaceField) {
      const surf = this.surfaceField.heightAt(x, z);
      if (Number.isFinite(surf)) height = surf + paintOffset;
    }
    return {
      x, z,
      height,
      position: [x, height, z],
      normal: info.normal,
      slope: info.slope,
      biomeWeights: info.biomeWeights,
      moisture: climate.moist,
      temperature: climate.temp,
      heightScale: this.cpu.u?.uHeightScale?.value ?? 560,
      water: height <= waterLevel + 0.01,
      shoreDistance: height - waterLevel,
      mask: this.getPaintMask(x, z),
      excludeProps: this.getPropExclusion(x, z),
    };
  }
}

export class PlanetPropSampler {
  /**
   * @param {object} opts
   * @param {PlanetHeightSampler} opts.planet
   * @param {function} opts.getWaterLevel   () => number
   * @param {function} opts.getPlanetRadius () => number
   */
  constructor({ planet, getWaterLevel, getPlanetRadius }) {
    this.planet = planet;
    this.getWaterLevel = getWaterLevel;
    this.getPlanetRadius = getPlanetRadius;
  }

  /** @param {number} dx,dy,dz unit direction from planet center. */
  sampleAt3D(dx, dy, dz) {
    const waterLevel = this.getWaterLevel();
    const radius = this.getPlanetRadius();
    const height = this.planet.heightAt3D(dx, dy, dz);
    const normal = this.planet.normalAt(dx, dy, dz);
    // radial "up" is the direction itself; slope = 1 - cos(angle to up)
    const slope = clamp(1 - (normal.x * dx + normal.y * dy + normal.z * dz), 0, 1);
    const { climate, weights } = this.planet.biomeInfoAt3D(dx, dy, dz);
    const surfaceRadius = radius + height;
    return {
      x: dx, z: dz,
      height,
      position: [dx * surfaceRadius, dy * surfaceRadius, dz * surfaceRadius],
      normal,
      slope,
      biomeWeights: weights,
      moisture: climate.moist,
      temperature: climate.temp,
      heightScale: this.planet.u?.uHeightScale?.value ?? 560,
      water: height <= waterLevel + 0.01,
      shoreDistance: height - waterLevel,
      mask: null,
      surfaceRadius,
    };
  }
}
