import * as THREE from 'three';

// ============================================================================
// Editor camera controls, mouse only:
//   - left-drag  : pan across the board (clamped to board bounds)
//   - right-drag : orbit around the focus point
//   - wheel      : zoom (clamped min/max distance)
// Smooth-damped spherical camera around a target point on the board plane.
// Modes: 'orbit' (free angle) and 'topdown' (locked overhead).
// ============================================================================

const DEG = Math.PI / 180;

export class EditorControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    this.target = new THREE.Vector3(0, 0, 0);
    this.goalTarget = new THREE.Vector3(0, 0, 0);

    // spherical state: radius, phi (from +Y), theta (azimuth)
    this.radius = 2850; this.goalRadius = 2850;
    this.phi = 55 * DEG; this.goalPhi = 55 * DEG;
    this.theta = 45 * DEG; this.goalTheta = 45 * DEG;

    this.mode = 'orbit';
    this.minRadius = 180;
    this.maxRadius = 7000;
    this.minPhi = 8 * DEG;
    this.maxPhi = 80 * DEG;
    this.panLimit = 1024;          // set from board size

    this.onFirstInteract = null;
    this.enabled = true;           // false while the studio player walks
    this.inputMode = 'all';        // 'all' or 'orbitOnly' while paint mode owns left drag
    this._interacted = false;
    this._drag = null;             // { button, x, y }
    this._touches = new Map();      // active touch pointers for pan / pinch zoom
    this._pinch = null;             // { x, y, dist, radius }

    domElement.addEventListener('pointerdown', (e) => this._onDown(e));
    domElement.addEventListener('pointermove', (e) => this._onMove(e));
    domElement.addEventListener('pointerup', (e) => this._onUp(e));
    domElement.addEventListener('pointercancel', (e) => this._onUp(e));
    domElement.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setBoardSize(boardSize) {
    this.panLimit = boardSize * 0.55;
    this.minRadius = Math.max(120, boardSize * 0.06);
    this.maxRadius = boardSize * 3.2;
    this.goalRadius = Math.min(Math.max(this.goalRadius, this.minRadius), this.maxRadius);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'topdown') {
      this.goalPhi = 0.5 * DEG;
    } else if (this.goalPhi < this.minPhi) {
      this.goalPhi = 55 * DEG;
    }
  }

  setView(view) {
    if (view === 'top') {
      this.setMode('topdown');
    } else if (view === 'angled') {
      this.mode = 'orbit';
      this.goalPhi = 55 * DEG;
      this.goalTheta = 45 * DEG;
    }
  }

  reset(boardSize) {
    this.goalTarget.set(0, 0, 0);
    this.goalRadius = boardSize * 1.4;
    this.goalTheta = 45 * DEG;
    this.goalPhi = this.mode === 'topdown' ? 0.5 * DEG : 55 * DEG;

    this.target.copy(this.goalTarget);
    this.radius = this.goalRadius;
    this.theta = this.goalTheta;
    this.phi = this.goalPhi;
  }

  focusCenter() { this.goalTarget.set(0, 0, 0); }

  _markInteract() {
    if (!this._interacted) {
      this._interacted = true;
      if (this.onFirstInteract) this.onFirstInteract();
    }
  }

  _onDown(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'touch') {
      if (this.inputMode === 'orbitOnly') return;
      this._markInteract();
      this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._pinch = this._getPinchState();
      this.dom.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    if (this.inputMode === 'orbitOnly' && e.button !== 2) return;
    this._markInteract();
    this._drag = { button: e.button, x: e.clientX, y: e.clientY };
    this.dom.setPointerCapture(e.pointerId);
  }

  _panByPixels(dx, dy) {
    // pan in the ground plane, screen-relative, scaled by zoom + FOV
    const h = this.dom.clientHeight || 1;
    const worldPerPx = (2 * this.radius * Math.tan(this.camera.fov * DEG / 2)) / h;
    const sin = Math.sin(this.theta), cos = Math.cos(this.theta);
    // screen right in world XZ
    const rx = cos, rz = -sin;
    // screen up projected onto ground (away from camera)
    const fx = -sin, fz = -cos;
    this.goalTarget.x += (-dx * rx + dy * fx) * worldPerPx;
    this.goalTarget.z += (-dx * rz + dy * fz) * worldPerPx;
    this._clampTarget();
  }

  _getPinchState() {
    const pts = Array.from(this._touches.values());
    if (pts.length < 2) return null;
    const [a, b] = pts;
    const dx = b.x - a.x, dy = b.y - a.y;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(dx, dy) || 1, radius: this.goalRadius };
  }

  _onMove(e) {
    if (e.pointerType === 'touch' && this._touches.has(e.pointerId)) {
      const prevTouch = this._touches.get(e.pointerId);
      this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = Array.from(this._touches.values());
      if (pts.length >= 2) {
        const next = this._getPinchState();
        if (this._pinch && next) {
          this._panByPixels(next.x - this._pinch.x, next.y - this._pinch.y);
          this.goalRadius = Math.min(Math.max(this._pinch.radius * (this._pinch.dist / next.dist), this.minRadius), this.maxRadius);
          this._pinch.x = next.x;
          this._pinch.y = next.y;
        }
        return;
      }
      if (pts.length === 1 && this._pinch === null && prevTouch) {
        this._panByPixels(e.clientX - prevTouch.x, e.clientY - prevTouch.y);
      }
      return;
    }
    if (!this._drag) return;
    const dx = e.clientX - this._drag.x;
    const dy = e.clientY - this._drag.y;
    this._drag.x = e.clientX;
    this._drag.y = e.clientY;

    if (this._drag.button === 0) this._panByPixels(dx, dy);
    else {
      // orbit
      this.goalTheta -= dx * 0.005;
      if (this.mode !== 'topdown') this.goalPhi = Math.min(Math.max(this.goalPhi - dy * 0.004, this.minPhi), this.maxPhi);
    }
  }

  _onUp(e) {
    if (e.pointerType === 'touch') {
      this._touches.delete(e.pointerId);
      this._pinch = this._getPinchState();
      try { this.dom.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      return;
    }
    if (this._drag) {
      this._drag = null;
      try { this.dom.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    }
  }

  _onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this._markInteract();
    this.goalRadius = Math.min(
      Math.max(this.goalRadius * Math.exp(e.deltaY * 0.0011), this.minRadius),
      this.maxRadius
    );
  }

  _clampTarget() {
    const lim = this.panLimit;
    this.goalTarget.x = Math.min(Math.max(this.goalTarget.x, -lim), lim);
    this.goalTarget.z = Math.min(Math.max(this.goalTarget.z, -lim), lim);
    this.goalTarget.y = 0;
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 9);
    this.target.lerp(this.goalTarget, k);
    this.radius += (this.goalRadius - this.radius) * k;
    this.phi += (this.goalPhi - this.phi) * k;
    // shortest-path theta blend
    let dTheta = this.goalTheta - this.theta;
    this.theta += dTheta * k;

    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sinPhi * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sinPhi * Math.cos(this.theta)
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
  }

  // For the camera info panel
  get azimuthDeg() { return ((this.theta / DEG) % 360 + 360) % 360; }
  get elevationDeg() { return -(90 - this.phi / DEG); }
  get distance() { return this.radius; }
}
