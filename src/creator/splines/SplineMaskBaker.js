import * as THREE from 'three';
import { resampleSpline } from './SplinePath.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// CPU baker is intentionally small and deterministic. It is the fallback
// implementation for all WebGL tiers and exposes DataTextures with the same
// contract a GPU strip baker would use, so it can be replaced later without
// changing terrain/props/material integration.
export class SplineMaskBaker {
  constructor({ uniforms, getBounds, getBaseHeight, resolution = 512 }) {
    this.uniforms = uniforms; this.getBounds = getBounds; this.getBaseHeight = getBaseHeight;
    this.resolution = resolution;
    this.height = new Float32Array(resolution * resolution * 4);
    this.surface = new Uint8Array(resolution * resolution * 4);
    this.aux = new Uint8Array(resolution * resolution * 4);
    this.heightTexture = this._texture(this.height, THREE.FloatType);
    this.surfaceTexture = this._texture(this.surface, THREE.UnsignedByteType);
    this.auxTexture = this._texture(this.aux, THREE.UnsignedByteType);
    this.revision = 0;
    this._bind();
  }
  _texture(data, type) {
    const t = new THREE.DataTexture(data, this.resolution, this.resolution, THREE.RGBAFormat, type);
    t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
  }
  _bind() {
    this.uniforms.uSplineHeightTexture.value = this.heightTexture;
    this.uniforms.uSplineMaskTexture.value = this.surfaceTexture;
    this.uniforms.uSplineAuxTexture.value = this.auxTexture;
    this.uniforms.uSplineResolution.value = this.resolution;
  }
  bake(splines, { preview = false } = {}) {
    this.height.fill(0); this.surface.fill(0); this.aux.fill(0);
    const { origin, span } = this.getBounds();
    const scale = this.resolution / Math.max(span.x, span.z, 1);
    for (const spline of splines) {
      if (!spline.enabled || spline.controlPoints.length < 2) continue;
      const samples = resampleSpline(spline.controlPoints, { interpolation: spline.interpolation, closed: spline.closed, spacing: preview ? 16 : 6 });
      const target = spline.heightMode === 'fixed' ? spline.targetHeight : (samples[0]?.y || 0) + spline.heightOffset;
      for (let s = 0; s < samples.length; s++) {
        const p = samples[s];
        const width = spline.width * (this._pointMultiplier(spline, p) || 1);
        const outer = width + spline.falloff + (spline.type === 'river' ? spline.bankWidth : 0);
        const px = (p.x - origin.x) / span.x * (this.resolution - 1);
        const py = (p.z - origin.z) / span.z * (this.resolution - 1);
        const rad = Math.ceil(outer * scale) + 1;
        for (let y = Math.max(0, Math.floor(py - rad)); y <= Math.min(this.resolution - 1, Math.ceil(py + rad)); y++) {
          for (let x = Math.max(0, Math.floor(px - rad)); x <= Math.min(this.resolution - 1, Math.ceil(px + rad)); x++) {
            const wx = origin.x + x / (this.resolution - 1) * span.x;
            const wz = origin.z + y / (this.resolution - 1) * span.z;
            const d = Math.hypot(wx - p.x, wz - p.z);
            if (d > outer) continue;
            const core = clamp(1 - d / Math.max(width, 0.001), 0, 1);
            const fade = d <= width ? 1 : clamp(1 - (d - width) / Math.max(outer - width, .001), 0, 1);
            const soft = fade * fade * (3 - 2 * fade);
            const i = (y * this.resolution + x) * 4;
            let delta = 0;
            if (spline.type === 'river') delta = -spline.depth * core * core - spline.depth * .18 * (1 - core) * soft;
            else if (spline.heightMode === 'follow') delta = spline.heightOffset * soft;
            else delta = (target - this.getBaseHeight(wx, wz)) * soft;
            // strongest overlapping authoring layer wins at a pixel; this is
            // predictable and prevents crossing splines from exploding upward.
            if (Math.abs(delta) > Math.abs(this.height[i])) this.height[i] = delta;
            this.surface[i] = Math.max(this.surface[i], Math.round(core * 255));
            this.surface[i + 1] = Math.max(this.surface[i + 1], Math.round(soft * 255));
            this.surface[i + 2] = Math.max(this.surface[i + 2], spline.type === 'river' ? 255 : 0);
            this.aux[i] = Math.max(this.aux[i], spline.clearProps ? Math.round(soft * 255) : 0);
            this.aux[i + 1] = Math.max(this.aux[i + 1], spline.type === 'river' ? Math.round(soft * 255) : 0);
          }
        }
      }
    }
    this.uniforms.uSplineEnabled.value = splines.some((s) => s.enabled) ? 1 : 0;
    this.uniforms.uSplineOrigin.value.set(origin.x, origin.z); this.uniforms.uSplineSpan.value.set(span.x, span.z);
    this.heightTexture.needsUpdate = this.surfaceTexture.needsUpdate = this.auxTexture.needsUpdate = true;
    this.revision++;
  }
  _pointMultiplier(spline, sample) {
    const points = spline.controlPoints; if (!points?.length) return 1;
    let closest = points[0], d = Infinity;
    for (const p of points) { const q = Math.hypot(sample.x - p.x, sample.z - p.z); if (q < d) { d = q; closest = p; } }
    return closest.widthMultiplier || 1;
  }
  sampleHeightOffset(x, z) { return this._sample(this.height, x, z, 0); }
  samplePropExclusion(x, z) { return this._sample(this.aux, x, z, 0) / 255; }
  sampleSurfaceMask(x, z) { return this._sample(this.surface, x, z, 0) / 255; }
  _sample(data, x, z, channel) {
    const { origin, span } = this.getBounds(); const u = (x - origin.x) / span.x, v = (z - origin.z) / span.z;
    if (u < 0 || v < 0 || u > 1 || v > 1) return 0;
    const px = Math.round(u * (this.resolution - 1)), py = Math.round(v * (this.resolution - 1));
    return data[(py * this.resolution + px) * 4 + channel];
  }
  dispose() { this.heightTexture.dispose(); this.surfaceTexture.dispose(); this.auxTexture.dispose(); }
}
