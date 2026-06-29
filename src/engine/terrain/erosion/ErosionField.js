import * as THREE from 'three';

// ============================================================================
// Erosion height-offset field (studio / tile mode).
//
// The terrain height in this project is fully ANALYTIC — there is no stored
// heightmap grid to carve. Erosion is therefore expressed as an additive,
// world-space SIGNED height-offset texture (delta = erodedHeight - baseHeight)
// that heightAt() adds on top of the analytic field, exactly like the paint
// height-offset path. Because every consumer (mesh vertex displacement, the
// fragment normal/colour, the GPU collision readback, prop sampling and the
// GLB export) flows through heightAt(), they all pick up erosion for free, and
// the base field is never mutated (toggle = drop the texture).
//
// This module is the container for that delta field: a Float32Array grid plus a
// HalfFloat DataTexture (R = delta in world units) and the world-XZ region it
// covers. The erosion simulation (later slices) fills the grid; for now
// bakeIdentity() proves the full round-trip with an all-zero delta — a visual
// no-op — so the plumbing can be verified before any erosion math exists.
// ============================================================================

export class ErosionField {
  constructor() {
    this.res = 0;            // grid resolution (res × res samples)
    this.delta = null;       // Float32Array, signed world-unit height delta
    this.texture = null;     // HalfFloat DataTexture, R = delta
    this.enabled = false;
    // Bumped on every change to the baked result (delta replaced or cleared).
    // The undo/redo history uses this as a dedupe key, exactly like the paint
    // layer revision — the heavy delta grid is referenced by revision, not
    // copied into every snapshot string.
    this.revision = 0;
    // Analysis masks from the last bake (normalized [0,1] Float32 grids). Stored
    // for downstream texturing / prop placement (a later slice); null until a
    // real erosion bake runs. { flow, erosionMask, depositionMask, sedimentMap,
    // slopeMap, res }.
    this.masks = null;
    // World-XZ region the grid covers:
    //   [originX, originX + sizeX] × [originZ, originZ + sizeZ]
    // Matches the uErosionOffsetTex sampling in GLSL (uBakeOrigin / uBakeSpan).
    this.originX = 0;
    this.originZ = 0;
    this.sizeX = 1;
    this.sizeZ = 1;
  }

  setRegion(originX, originZ, sizeX, sizeZ) {
    this.originX = originX;
    this.originZ = originZ;
    this.sizeX = Math.max(1e-3, sizeX);
    this.sizeZ = Math.max(1e-3, sizeZ);
  }

  _ensureTexture(res) {
    if (this.texture && this.texture.image.width === res) return;
    this.texture?.dispose();
    // RGBA HalfFloat (matches the import-map path); only R carries the delta.
    const data = new Uint16Array(res * res * 4);
    this.texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.HalfFloatType);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }

  _ensureGrid(res) {
    res = Math.max(2, Math.round(res));
    if (this.res === res && this.delta && this.texture) return;
    this.res = res;
    this.delta = new Float32Array(res * res);
    this._ensureTexture(res);
  }

  /** Adopt a real eroded delta grid (eroded - base, world units) and upload it. */
  setDelta(delta, res) {
    this.res = Math.max(2, Math.round(res));
    this.delta = delta;
    this._ensureTexture(this.res);
    this._upload();
    this.revision++;
  }

  /** Store the analysis masks from a bake (for later texturing / props). */
  setMasks(masks, res) {
    this.masks = masks ? { ...masks, res } : null;
  }

  hasResult() { return !!(this.delta && this.res > 0); }

  /** Upload the current Float32 delta grid into the HalfFloat texture R channel. */
  _upload() {
    const toHalf = THREE.DataUtils.toHalfFloat;
    const out = this.texture.image.data;
    const d = this.delta;
    for (let i = 0; i < d.length; i++) out[i * 4] = toHalf(d[i]);
    this.texture.needsUpdate = true;
  }

  /**
   * No-op identity bake: zero delta over the given region. Proves the offset
   * round-trip (mesh, normals, CPU sampler, export) without changing terrain.
   * @param {{originX:number,originZ:number,sizeX:number,sizeZ:number}} [region]
   * @param {number} [res] grid resolution
   */
  bakeIdentity(region, res = 512) {
    if (region) this.setRegion(region.originX, region.originZ, region.sizeX, region.sizeZ);
    this._ensureGrid(res);
    this.delta.fill(0);
    this._upload();
    this.enabled = true;
    this.revision++;
    return this;
  }

  /**
   * Bilinear sample of the delta grid at world (x, z) — the CPU mirror of the
   * GLSL erosionOffsetAt(), using the same texel-centre mapping as
   * LinearFilter. Returns 0 outside the region or when disabled.
   */
  offsetAt(x, z) {
    if (!this.enabled || !this.delta) return 0;
    const u = (x - this.originX) / this.sizeX;
    const v = (z - this.originZ) / this.sizeZ;
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    const N = this.res;
    const fx = u * N - 0.5;
    const fz = v * N - 0.5;
    const x0 = Math.max(0, Math.min(N - 1, Math.floor(fx)));
    const z0 = Math.max(0, Math.min(N - 1, Math.floor(fz)));
    const x1 = Math.min(N - 1, x0 + 1);
    const z1 = Math.min(N - 1, z0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0));
    const tz = Math.max(0, Math.min(1, fz - z0));
    const d = this.delta;
    const h00 = d[z0 * N + x0], h10 = d[z0 * N + x1];
    const h01 = d[z1 * N + x0], h11 = d[z1 * N + x1];
    const top = h00 + (h10 - h00) * tx;
    const bot = h01 + (h11 - h01) * tx;
    return top + (bot - top) * tz;
  }

  setEnabled(on) { this.enabled = !!on && this.hasResult(); }

  /** Fully drop the baked result (offset + masks). hasResult() → false. */
  clear() {
    const had = this.hasResult();
    this.enabled = false;
    this.delta = null;
    this.masks = null;
    this.res = 0;
    if (had) this.revision++;
  }

  /**
   * Snapshot the baked result for the undo/redo history. The heavy delta /
   * mask grids are referenced (not copied) — a new bake replaces the arrays
   * rather than mutating them in place, so sharing the reference is safe and
   * keeps history lightweight. Returns null when nothing is baked.
   */
  serialize() {
    if (!this.hasResult()) return null;
    return {
      res: this.res,
      delta: this.delta,
      masks: this.masks,
      enabled: this.enabled,
      originX: this.originX,
      originZ: this.originZ,
      sizeX: this.sizeX,
      sizeZ: this.sizeZ,
    };
  }

  /** Restore a snapshot produced by serialize(). A null blob clears the field. */
  restore(blob) {
    if (!blob || !blob.delta) { this.clear(); return; }
    this.setRegion(blob.originX, blob.originZ, blob.sizeX, blob.sizeZ);
    this.setDelta(blob.delta, blob.res);
    this.masks = blob.masks ?? null;
    this.enabled = !!blob.enabled && this.hasResult();
  }

  /** Push the texture + enable flag into the shared terrain uniforms. */
  applyTo(uniforms) {
    if (uniforms.uErosionOffsetTex) uniforms.uErosionOffsetTex.value = this.enabled ? this.texture : null;
    if (uniforms.uErosionEnabled) uniforms.uErosionEnabled.value = this.enabled ? 1 : 0;
  }

  dispose() {
    this.texture?.dispose();
    this.texture = null;
    this.delta = null;
    this.res = 0;
    this.enabled = false;
  }
}
