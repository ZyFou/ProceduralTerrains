import * as THREE from 'three';

// ============================================================================
// Orbit camera for Planet view mode. Orbits the planet center (origin):
//   - drag (any button) : orbit
//   - wheel             : zoom (clamped between just above the surface and a
//                         far orbit)
// Smooth-damped spherical camera, world-up +Y. Mirrors the math style of
// EditorControls but always targets the origin.
// ============================================================================

const DEG = Math.PI / 180;

export class PlanetOrbitControls {
  constructor(camera, domElement, radius) {
    this.camera = camera;
    this.dom = domElement;
    this.enabled = true;

    this.setRadius(radius);

    this.phi = 65 * DEG; this.goalPhi = 65 * DEG;
    this.theta = 35 * DEG; this.goalTheta = 35 * DEG;
    this.minPhi = 2 * DEG;
    this.maxPhi = 178 * DEG;

    this.onFirstInteract = null;
    this._interacted = false;
    this._drag = null;
    this._touches = new Map();
    this._pinch = null;

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onCtx = (e) => e.preventDefault();

    domElement.addEventListener('pointerdown', this._onDown);
    domElement.addEventListener('pointermove', this._onMove);
    domElement.addEventListener('pointerup', this._onUp);
    domElement.addEventListener('pointercancel', this._onUp);
    domElement.addEventListener('wheel', this._onWheel, { passive: false });
    domElement.addEventListener('contextmenu', this._onCtx);
  }

  setRadius(radius) {
    this.planetRadius = radius;
    this.minDist = radius * 1.02;
    this.maxDist = radius * 6.0;
    const def = radius * 2.6;
    this.dist = def; this.goalDist = def;
  }

  dispose() {
    const d = this.dom;
    d.removeEventListener('pointerdown', this._onDown);
    d.removeEventListener('pointermove', this._onMove);
    d.removeEventListener('pointerup', this._onUp);
    d.removeEventListener('pointercancel', this._onUp);
    d.removeEventListener('wheel', this._onWheel);
    d.removeEventListener('contextmenu', this._onCtx);
  }

  _markInteract() {
    if (!this._interacted) {
      this._interacted = true;
      if (this.onFirstInteract) this.onFirstInteract();
    }
  }

  _onDown(e) {
    if (!this.enabled) return;
    this._markInteract();
    if (e.pointerType === 'touch') {
      this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._pinch = this._getPinchState();
    } else {
      this._drag = { x: e.clientX, y: e.clientY };
    }
    this.dom.setPointerCapture(e.pointerId);
  }

  _orbitByPixels(dx, dy) {
    this.goalTheta -= dx * 0.005;
    this.goalPhi = Math.min(Math.max(this.goalPhi - dy * 0.004, this.minPhi), this.maxPhi);
  }

  _getPinchState() {
    const pts = Array.from(this._touches.values());
    if (pts.length < 2) return null;
    const [a, b] = pts;
    const dx = b.x - a.x, dy = b.y - a.y;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(dx, dy) || 1, zoom: this.goalDist };
  }

  _onMove(e) {
    if (e.pointerType === 'touch' && this._touches.has(e.pointerId)) {
      const prev = this._touches.get(e.pointerId);
      this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = Array.from(this._touches.values());
      if (pts.length >= 2) {
        const next = this._getPinchState();
        if (this._pinch && next) {
          this._orbitByPixels(next.x - this._pinch.x, next.y - this._pinch.y);
          this.goalDist = Math.min(Math.max(this._pinch.zoom * (this._pinch.dist / next.dist), this.minDist), this.maxDist);
          this._pinch.x = next.x;
          this._pinch.y = next.y;
        }
        return;
      }
      if (pts.length === 1 && this._pinch === null && prev) this._orbitByPixels(e.clientX - prev.x, e.clientY - prev.y);
      return;
    }
    if (!this._drag) return;
    const dx = e.clientX - this._drag.x;
    const dy = e.clientY - this._drag.y;
    this._drag.x = e.clientX;
    this._drag.y = e.clientY;
    this._orbitByPixels(dx, dy);
  }

  _onUp(e) {
    if (e.pointerType === 'touch') {
      this._touches.delete(e.pointerId);
      this._pinch = this._getPinchState();
      try { this.dom.releasePointerCapture(e.pointerId); } catch { /* ok */ }
      return;
    }
    if (this._drag) {
      this._drag = null;
      try { this.dom.releasePointerCapture(e.pointerId); } catch { /* ok */ }
    }
  }

  _onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this._markInteract();
    this.goalDist = Math.min(
      Math.max(this.goalDist * Math.exp(e.deltaY * 0.0011), this.minDist),
      this.maxDist
    );
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 9);
    this.dist += (this.goalDist - this.dist) * k;
    this.phi += (this.goalPhi - this.phi) * k;
    this.theta += (this.goalTheta - this.theta) * k;

    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.dist * sinPhi * Math.sin(this.theta),
      this.dist * Math.cos(this.phi),
      this.dist * sinPhi * Math.cos(this.theta)
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
  }

  get azimuthDeg() { return ((this.theta / DEG) % 360 + 360) % 360; }
  get elevationDeg() { return 90 - this.phi / DEG; }
  get distance() { return this.dist; }
}
