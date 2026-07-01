import * as THREE from 'three';

// ============================================================================
// First-person flying camera for Infinite World Mode.
//   - ZQSD  : forward / left / backward / right
//   - Space  : ascend    Shift : descend
//   - Mouse  : look (pointer-locked)
//   - Wheel  : adjust movement speed
// The camera floats freely (no gravity / ground clamping).
// ============================================================================

const DEG = Math.PI / 180;
const PITCH_LIMIT = 89 * DEG;

export class FPSControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    this.yaw = 0;          // radians, 0 = looking toward -Z (north)
    this.pitch = 0;        // radians, positive = looking up
    this.moveSpeed = 200;  // world units per second
    this.minSpeed = 10;
    this.maxSpeed = 5000;
    this.mouseSensitivity = 0.0018;

    this._keys = new Set();
    this._locked = false;
    this.touch = { moveX: 0, moveY: 0, lookX: 0, lookY: 0 };
    this.touchActive = false;

    // When a PlayerController drives the body, FPSControls only applies
    // mouse-look orientation; movement keys are read by the controller.
    this.externalMove = false;
    // Debug freecam can be entered from a UI toggle. Pointer lock may be denied
    // until the canvas is clicked, but keyboard fly movement should start
    // immediately.
    this.allowKeyboardWithoutLock = false;
    // Optional wheel hook: receives the speed factor instead of moveSpeed.
    this.onSpeedWheel = null;

    // event handlers (bound so we can remove them)
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onLockChange = this._onLockChange.bind(this);

    this._attach();
  }

  _attach() {
    this.dom.addEventListener('click', this._onClick);
    this.dom.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  dispose() {
    this.dom.removeEventListener('click', this._onClick);
    this.dom.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    if (document.pointerLockElement === this.dom) {
      document.exitPointerLock();
    }
    this._keys.clear();
  }

  get isLocked() { return this._locked; }

  setTouchInput({ moveX = 0, moveY = 0, lookX = 0, lookY = 0 } = {}) {
    this.touch.moveX = moveX;
    this.touch.moveY = moveY;
    this.touch.lookX = lookX;
    this.touch.lookY = lookY;
    this.touchActive = Math.hypot(moveX, moveY) > 0.02
      || Math.hypot(lookX, lookY) > 0.02;
  }

  // ---- event handlers ----

  _onClick() {
    if (!this._locked) {
      this.dom.requestPointerLock();
    }
  }

  _onLockChange() {
    this._locked = document.pointerLockElement === this.dom;
    if (!this._locked && !this.allowKeyboardWithoutLock) this._keys.clear();
  }

  _onMouseMove(e) {
    if (!this._locked) return;
    this.yaw -= e.movementX * this.mouseSensitivity;
    this.pitch -= e.movementY * this.mouseSensitivity;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  }

  _onWheel(e) {
    e.preventDefault();
    // logarithmic speed scaling
    const factor = Math.exp(-e.deltaY * 0.0015);
    if (this.onSpeedWheel) {
      this.onSpeedWheel(factor);
      return;
    }
    this.moveSpeed = Math.max(this.minSpeed, Math.min(this.maxSpeed, this.moveSpeed * factor));
  }

  _onKeyDown(e) {
    if (!this._locked && !this.allowKeyboardWithoutLock) return;
    this._keys.add(e.code);
  }

  _onKeyUp(e) {
    this._keys.delete(e.code);
  }

  // ---- update ----

  _applyTouchLook(dt) {
    const { lookX, lookY } = this.touch;
    if (Math.abs(lookX) < 0.02 && Math.abs(lookY) < 0.02) return;
    const rate = this.mouseSensitivity * 220 * (dt || 0.016);
    this.yaw -= lookX * rate;
    this.pitch -= lookY * rate;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  }

  update(dt) {
    this._applyTouchLook(dt);

    if (this.externalMove) {
      this._applyOrientation();
      return;
    }

    const canMove = this._locked || this.touchActive || this.allowKeyboardWithoutLock;
    if (!canMove) {
      this._applyOrientation();
      return;
    }

    const speed = this.moveSpeed * dt;
    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    let dx = 0, dy = 0, dz = 0;

    if (this._keys.has('KeyW') || this._keys.has('KeyZ')) { dx += fwdX; dz += fwdZ; }
    if (this._keys.has('KeyS')) { dx -= fwdX; dz -= fwdZ; }
    if (this._keys.has('KeyA') || this._keys.has('KeyQ')) { dx -= rightX; dz -= rightZ; }
    if (this._keys.has('KeyD')) { dx += rightX; dz += rightZ; }
    if (this._keys.has('Space')) { dy += 1; }
    if (this._keys.has('ShiftLeft') || this._keys.has('ShiftRight')) { dy -= 1; }

    if (this.touchActive) {
      const { moveX, moveY } = this.touch;
      dx += fwdX * moveY + rightX * moveX;
      dz += fwdZ * moveY + rightZ * moveX;
    }

    const hLen = Math.hypot(dx, dz);
    if (hLen > 1e-6) {
      dx = dx / hLen * speed;
      dz = dz / hLen * speed;
    }
    dy *= speed;

    this.camera.position.x += dx;
    this.camera.position.y += dy;
    this.camera.position.z += dz;

    this._applyOrientation();
  }

  _applyOrientation() {
    // Build a quaternion from yaw (Y axis) then pitch (local X axis)
    const q = this.camera.quaternion;
    const qYaw = _qA.setFromAxisAngle(_yAxis, this.yaw);
    const qPitch = _qB.setFromAxisAngle(_xAxis, this.pitch);
    q.copy(qYaw).multiply(qPitch);
  }

  // For the status bar / HUD
  get keys() { return this._keys; }
  get position() { return this.camera.position; }
  get yawDeg() { return ((this.yaw / DEG) % 360 + 360) % 360; }
  get pitchDeg() { return this.pitch / DEG; }
}

// reusable quaternion temporaries
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _xAxis = new THREE.Vector3(1, 0, 0);
