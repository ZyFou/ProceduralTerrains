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
    this.panCenter = new THREE.Vector3(0, 0, 0);   // assembly center for pan clamp

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
    this.autoOrbit = false;        // slow showcase spin (landing page)
    this.autoOrbitSpeed = 0.045;   // radians per second
    this.inputMode = 'all';        // 'all' or 'orbitOnly' while paint mode owns left drag
    this.primaryPointerFilter = null; // optional editor-mode gate for left mouse / primary touch
    this.wheelFilter = null;        // optional editor-mode gate for wheel gestures
    this._interacted = false;
    this._drag = null;             // { button, x, y }
    this._touches = new Map();      // active touch pointers for pan / pinch zoom
    this._pinch = null;             // { x, y, dist, radius }

    // bound handlers kept so dispose() can detach them (the canvas DOM node
    // outlives the engine across HMR / remounts — inline arrows would leak)
    this._onPointerDown = (e) => this._onDown(e);
    this._onPointerMove = (e) => this._onMove(e);
    this._onPointerUp = (e) => this._onUp(e);
    this._onContextMenu = (e) => e.preventDefault();
    this._onWheelBound = (e) => this._onWheel(e);

    domElement.addEventListener('pointerdown', this._onPointerDown);
    domElement.addEventListener('pointermove', this._onPointerMove);
    domElement.addEventListener('pointerup', this._onPointerUp);
    domElement.addEventListener('pointercancel', this._onPointerUp);
    domElement.addEventListener('wheel', this._onWheelBound, { passive: false });
    domElement.addEventListener('contextmenu', this._onContextMenu);
  }

  dispose() {
    const d = this.dom;
    d.removeEventListener('pointerdown', this._onPointerDown);
    d.removeEventListener('pointermove', this._onPointerMove);
    d.removeEventListener('pointerup', this._onPointerUp);
    d.removeEventListener('pointercancel', this._onPointerUp);
    d.removeEventListener('wheel', this._onWheelBound);
    d.removeEventListener('contextmenu', this._onContextMenu);
    this._drag = null;
    this._touches.clear();
    this._pinch = null;
    this.onFirstInteract = null;
    this.primaryPointerFilter = null;
    this.wheelFilter = null;
  }

  setBoardSize(boardSize, center = null) {
    this.panLimit = boardSize * 0.55;
    this.minRadius = Math.max(120, boardSize * 0.06);
    this.maxRadius = boardSize * 3.2;
    // pan clamp is centred on the assembly (origin for a single tile)
    if (center) this.panCenter.set(center.x, 0, center.z);
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
    // The landing showcase (autoOrbit) frames tighter and lower than the
    // editor default; previews reset the camera repeatedly while it's active.
    const showcase = this.autoOrbit;
    this.goalRadius = boardSize * (showcase ? 0.82 : 1.4);
    this.goalTheta = 45 * DEG;
    this.goalPhi = this.mode === 'topdown' ? 0.5 * DEG : (showcase ? 66 : 55) * DEG;

    this.target.copy(this.goalTarget);
    this.radius = this.goalRadius;
    this.theta = this.goalTheta;
    this.phi = this.goalPhi;
    this._smoothRate = null;
  }

  blendToDefault(boardSize) {
    this.goalTarget.set(0, 0, 0);
    this.goalRadius = boardSize * 1.4;
    const goalTheta = 45 * DEG;
    this.goalPhi = this.mode === 'topdown' ? 0.5 * DEG : 55 * DEG;
    let dTheta = goalTheta - this.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    this.goalTheta = this.theta + dTheta;
    this._smoothRate = 3.2;
  }

  get isSettling() {
    if (this._smoothRate == null) return false;
    return Math.abs(this.goalRadius - this.radius) > 2
      || this.target.distanceToSquared(this.goalTarget) > 4
      || Math.abs(this.goalPhi - this.phi) > 0.002
      || Math.abs(this.goalTheta - this.theta) > 0.002;
  }

  _nearGoals() {
    return Math.abs(this.goalRadius - this.radius) <= 2
      && this.target.distanceToSquared(this.goalTarget) <= 4
      && Math.abs(this.goalPhi - this.phi) <= 0.002
      && Math.abs(this.goalTheta - this.theta) <= 0.002;
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
    if ((e.button === 0 || e.pointerType === 'touch') && this.primaryPointerFilter && !this.primaryPointerFilter(e)) return;
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

  _orbitByPixels(dx, dy) {
    this.goalTheta -= dx * 0.005;
    if (this.mode !== 'topdown') {
      this.goalPhi = Math.min(Math.max(this.goalPhi - dy * 0.004, this.minPhi), this.maxPhi);
    }
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
        this._orbitByPixels(e.clientX - prevTouch.x, e.clientY - prevTouch.y);
      }
      return;
    }
    if (!this._drag) return;
    const dx = e.clientX - this._drag.x;
    const dy = e.clientY - this._drag.y;
    this._drag.x = e.clientX;
    this._drag.y = e.clientY;

    if (this._drag.button === 0) this._panByPixels(dx, dy);
    else this._orbitByPixels(dx, dy);
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
    if (this.wheelFilter && !this.wheelFilter(e)) return;
    e.preventDefault();
    this._markInteract();
    this.goalRadius = Math.min(
      Math.max(this.goalRadius * Math.exp(e.deltaY * 0.0011), this.minRadius),
      this.maxRadius
    );
  }

  _clampTarget() {
    const lim = this.panLimit;
    this.goalTarget.x = Math.min(Math.max(this.goalTarget.x, this.panCenter.x - lim), this.panCenter.x + lim);
    this.goalTarget.z = Math.min(Math.max(this.goalTarget.z, this.panCenter.z - lim), this.panCenter.z + lim);
    this.goalTarget.y = 0;
  }

  update(dt) {
    if (this.autoOrbit) this.goalTheta += dt * this.autoOrbitSpeed;

    const rate = this._smoothRate ?? 9;
    const k = 1 - Math.exp(-dt * rate);
    this.target.lerp(this.goalTarget, k);
    this.radius += (this.goalRadius - this.radius) * k;
    this.phi += (this.goalPhi - this.phi) * k;
    const dTheta = this.goalTheta - this.theta;
    this.theta += dTheta * k;

    if (this._smoothRate != null && this._nearGoals()) this._smoothRate = null;

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
