import * as THREE from 'three';

// Shared ray-to-heightfield picker used by creator tools.  It deliberately
// owns no terrain state; callers provide the final height function so paint,
// splines and future layers always pick the same surface they display.
export class TerrainPicker {
  constructor({ camera, domElement, heightAt, contains, maxDistance = 12000 }) {
    this.camera = camera;
    this.domElement = domElement;
    this.heightAt = heightAt;
    this.contains = contains || (() => true);
    this.maxDistance = maxDistance;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._scratch = new THREE.Vector3();
  }

  pickEvent(event, { quality = 'final' } = {}) {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.pickRay(this.raycaster.ray, { quality });
  }

  pickRay(ray, { quality = 'final' } = {}) {
    const steps = quality === 'preview' ? 48 : 112;
    const refine = quality === 'preview' ? 5 : 10;
    const max = this.maxDistance;
    let prevT = 0;
    let prev = this._signedDistance(ray, 0);
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * max;
      const d = this._signedDistance(ray, t);
      if (d != null && prev != null && d <= 0 && prev >= 0) {
        let a = prevT; let b = t;
        for (let n = 0; n < refine; n++) {
          const m = (a + b) * 0.5;
          if (this._signedDistance(ray, m) > 0) a = m; else b = m;
        }
        const hit = ray.at((a + b) * 0.5, new THREE.Vector3());
        hit.y = this.heightAt(hit.x, hit.z);
        return hit;
      }
      prevT = t;
      prev = d;
    }
    return null;
  }

  _signedDistance(ray, t) {
    const p = ray.at(t, this._scratch);
    if (!this.contains(p.x, p.z)) return null;
    const h = this.heightAt(p.x, p.z);
    return Number.isFinite(h) ? p.y - h : null;
  }
}
