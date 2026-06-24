import * as THREE from 'three';

const DEG = Math.PI / 180;
const PITCH_LIMIT = 70 * DEG;
const MAX_BANK = 70 * DEG;

const DEFAULT_PLANE_CONFIG = {
  gravity: 32,
  minSpeed: 18,
  cruiseSpeed: 95,
  maxSpeed: 240,
  acceleration: 55,
  drag: 0.34,
  lift: 0.0008,
  pitchRate: 1.35,
  yawRate: 0.62,
  rollRate: 1.8,
  mouseSensitivity: 0.0019,
  terrainClearance: 4,
  spawnClearance: 28,
  terminalVelocity: 170,
};

export class PlaneController {
  constructor({ camera, domElement, sampler = null, planetSampler = null, config = {} }) {
    this.camera = camera;
    this.dom = domElement;
    this.sampler = sampler;
    this.planetSampler = planetSampler;
    this.cfg = { ...DEFAULT_PLANE_CONFIG, ...config };
    this.isPlanet = !!planetSampler;

    this.throttle = 0.35;
    this.speedMultiplier = 1;
    this.state = 'flying';
    this.touch = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, throttle: this.throttle };
    this.touchActive = false;

    this._keys = new Set();
    this._locked = false;
    this._mouseX = 0;
    this._mouseY = 0;
    this._yaw = 0;
    this._pitch = 0;
    this._roll = 0;
    this._planetForward = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._vel = new THREE.Vector3();
    this.vel = this._vel;

    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');

    this._initPose();

    this._onClick = () => { if (!this._locked) this.dom.requestPointerLock(); };
    this._onLockChange = () => {
      this._locked = document.pointerLockElement === this.dom;
      if (!this._locked) {
        this._keys.clear();
        this._mouseX = 0;
        this._mouseY = 0;
      }
    };
    this._onMouseMove = (e) => {
      if (!this._locked) return;
      this._mouseX = Math.max(-1, Math.min(1, this._mouseX + e.movementX * this.cfg.mouseSensitivity));
      this._mouseY = Math.max(-1, Math.min(1, this._mouseY + e.movementY * this.cfg.mouseSensitivity));
    };
    this._onKeyDown = (e) => { if (this._locked) this._keys.add(e.code); };
    this._onKeyUp = (e) => this._keys.delete(e.code);
    this._onWheel = (e) => {
      e.preventDefault();
      this.speedMultiplier = Math.max(0.4, Math.min(2.5, this.speedMultiplier * Math.exp(-e.deltaY * 0.0012)));
    };

    this.dom.addEventListener('click', this._onClick);
    this.dom.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
  }

  dispose() {
    this.dom.removeEventListener('click', this._onClick);
    this.dom.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
    this._keys.clear();
  }

  get isLocked() { return this._locked; }
  get keys() { return this._keys; }

  setTouchInput({ moveX = 0, moveY = 0, lookX = 0, lookY = 0, throttle = this.throttle } = {}) {
    this.touch.moveX = moveX;
    this.touch.moveY = moveY;
    this.touch.lookX = lookX;
    this.touch.lookY = lookY;
    if (Number.isFinite(throttle)) this.throttle = Math.max(0, Math.min(1, throttle));
    this.touch.throttle = this.throttle;
    this.touchActive = Math.hypot(moveX, moveY) > 0.02 || Math.hypot(lookX, lookY) > 0.02;
  }

  _initPose() {
    if (this.isPlanet) {
      this._up.copy(this.camera.position).normalize();
      if (this._up.lengthSq() < 0.5) this._up.set(0, 1, 0);
      const r = this._surfaceRadius(this._up) + this.cfg.spawnClearance;
      this.camera.position.copy(this._up).multiplyScalar(r);
      const ref = Math.abs(this._up.y) < 0.95 ? this._tmp.set(0, 1, 0) : this._tmp.set(1, 0, 0);
      this._planetForward.copy(ref).addScaledVector(this._up, -ref.dot(this._up)).normalize();
      this._vel.copy(this._planetForward).multiplyScalar(this.cfg.minSpeed * 1.25);
      this._syncPlanetCamera();
      return;
    }

    const ground = this._flatGround(this.camera.position.x, this.camera.position.z);
    this.camera.position.y = Math.max(this.camera.position.y, ground + this.cfg.spawnClearance);
    const fwd = this.camera.getWorldDirection(this._tmp).normalize();
    this._yaw = Math.atan2(-fwd.x, -fwd.z);
    this._pitch = Math.asin(Math.max(-0.95, Math.min(0.95, fwd.y)));
    this._roll = 0;
    this._vel.copy(fwd).multiplyScalar(this.cfg.minSpeed * 1.25);
    this._syncFlatCamera();
  }

  update(dt) {
    if (this.isPlanet) this._updatePlanet(dt);
    else this._updateFlat(dt);
  }

  _updateFlat(dt) {
    const cfg = this.cfg;
    const input = this._input(dt);

    this._roll += input.roll * cfg.rollRate * dt;
    this._roll += (-this._roll * 1.8 + input.mouseX * 0.85) * dt;
    this._roll = Math.max(-MAX_BANK, Math.min(MAX_BANK, this._roll));
    this._pitch += (-input.mouseY * cfg.pitchRate + input.pitch * 0.75) * dt;
    this._pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this._pitch));
    this._yaw += (-Math.sin(this._roll) * cfg.yawRate + input.yaw * 0.35) * dt;

    const fwd = this._forward();
    const speed = this._vel.length();
    const target = Math.max(cfg.minSpeed * 0.4, cfg.cruiseSpeed * this.throttle * this.speedMultiplier);
    this._vel.addScaledVector(fwd, (target - speed) * cfg.acceleration * 0.015 * dt);
    this._vel.addScaledVector(this._vel, -cfg.drag * dt);
    const lift = Math.min(cfg.gravity * 1.35, speed * speed * cfg.lift * this.throttle);
    this._vel.y += (lift - cfg.gravity) * dt;
    if (this._vel.y < -cfg.terminalVelocity) this._vel.y = -cfg.terminalVelocity;

    this.camera.position.addScaledVector(this._vel, dt);
    const ground = this._flatGround(this.camera.position.x, this.camera.position.z);
    const clearance = this.camera.position.y - ground;
    const stall = speed < cfg.minSpeed || this.throttle < 0.08;
    this.state = clearance <= cfg.terrainClearance + 0.2 ? 'grounded' : stall ? 'stalling' : (this._vel.y < -12 ? 'falling' : 'flying');

    if (clearance < cfg.terrainClearance) {
      this.camera.position.y = ground + cfg.spawnClearance;
      this._vel.copy(fwd).multiplyScalar(Math.max(cfg.minSpeed * 1.1, speed * 0.35));
      this._pitch = Math.max(0.04, this._pitch);
      this._roll *= 0.3;
      this.state = 'grounded';
    }
    this._syncFlatCamera();
  }

  _updatePlanet(dt) {
    const cfg = this.cfg;
    const input = this._input(dt);
    const pos = this.camera.position;
    this._up.copy(pos).normalize();

    this._planetForward.addScaledVector(this._up, -this._planetForward.dot(this._up));
    if (this._planetForward.lengthSq() < 1e-6) this._planetForward.set(1, 0, 0).addScaledVector(this._up, -this._up.x).normalize();
    else this._planetForward.normalize();

    this._roll += input.roll * cfg.rollRate * dt;
    this._roll += (-this._roll * 1.8 + input.mouseX * 0.85) * dt;
    this._roll = Math.max(-MAX_BANK, Math.min(MAX_BANK, this._roll));
    this._pitch += (-input.mouseY * cfg.pitchRate + input.pitch * 0.75) * dt;
    this._pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this._pitch));

    this._q.setFromAxisAngle(this._up, (-Math.sin(this._roll) * cfg.yawRate + input.yaw * 0.35) * dt);
    this._planetForward.applyQuaternion(this._q).normalize();

    const right = this._tmp.copy(this._planetForward).cross(this._up).normalize();
    const fwd = this._tmp2.copy(this._planetForward).multiplyScalar(Math.cos(this._pitch)).addScaledVector(this._up, Math.sin(this._pitch)).normalize();
    const speed = this._vel.length();
    const target = Math.max(cfg.minSpeed * 0.4, cfg.cruiseSpeed * this.throttle * this.speedMultiplier);
    this._vel.addScaledVector(fwd, (target - speed) * cfg.acceleration * 0.015 * dt);
    this._vel.addScaledVector(this._vel, -cfg.drag * dt);
    const lift = Math.min(cfg.gravity * 1.35, speed * speed * cfg.lift * this.throttle);
    this._vel.addScaledVector(this._up, (lift - cfg.gravity) * dt);
    const inward = this._vel.dot(this._up);
    if (inward < -cfg.terminalVelocity) this._vel.addScaledVector(this._up, -cfg.terminalVelocity - inward);

    pos.addScaledVector(this._vel, dt);
    this._up.copy(pos).normalize();
    const surface = this._surfaceRadius(this._up);
    const altitude = pos.length() - surface;
    const stall = speed < cfg.minSpeed || this.throttle < 0.08;
    this.state = altitude <= cfg.terrainClearance + 0.2 ? 'grounded' : stall ? 'stalling' : (this._vel.dot(this._up) < -12 ? 'falling' : 'flying');
    if (altitude < cfg.terrainClearance) {
      pos.copy(this._up).multiplyScalar(surface + cfg.spawnClearance);
      this._vel.copy(fwd).multiplyScalar(Math.max(cfg.minSpeed * 1.1, speed * 0.35));
      this._pitch = Math.max(0.04, this._pitch);
      this._roll *= 0.3;
      this.state = 'grounded';
    }

    this._syncPlanetCamera(right);
  }

  _input(dt) {
    const canKeys = this._locked;
    if (canKeys) {
      if (this._keys.has('KeyW') || this._keys.has('KeyZ') || this._keys.has('ShiftLeft') || this._keys.has('ShiftRight')) {
        this.throttle = Math.min(1, this.throttle + dt * 0.45);
      }
      if (this._keys.has('KeyS') || this._keys.has('ControlLeft') || this._keys.has('ControlRight')) {
        this.throttle = Math.max(0, this.throttle - dt * 0.55);
      }
    }
    const t = this.touch;
    const touchRoll = Math.abs(t.moveX) > 0.02 ? t.moveX : 0;
    const touchPitch = Math.abs(t.moveY) > 0.02 ? -t.moveY : 0;
    const roll = (canKeys && (this._keys.has('KeyD') ? 1 : 0) - (this._keys.has('KeyA') || this._keys.has('KeyQ') ? 1 : 0)) + touchRoll;
    const pitch = touchPitch;
    const yaw = Math.abs(t.lookX) > 0.02 ? t.lookX : 0;
    const mouseX = this._mouseX + (Math.abs(t.lookX) > 0.02 ? t.lookX : 0);
    const mouseY = this._mouseY + (Math.abs(t.lookY) > 0.02 ? t.lookY : 0);
    this._mouseX *= Math.exp(-5 * dt);
    this._mouseY *= Math.exp(-5 * dt);
    return { roll, pitch, yaw, mouseX, mouseY };
  }

  _flatGround(x, z) {
    if (!this.sampler) return -Infinity;
    return this.sampler.heightAt(x, z);
  }

  _surfaceRadius(up) {
    return this.planetSampler?.surfaceRadius(up.x, up.y, up.z) ?? 0;
  }

  _forward() {
    return this._tmp.set(
      -Math.sin(this._yaw) * Math.cos(this._pitch),
      Math.sin(this._pitch),
      -Math.cos(this._yaw) * Math.cos(this._pitch)
    ).normalize();
  }

  _syncFlatCamera() {
    this._euler.set(this._pitch, this._yaw, this._roll, 'YXZ');
    this.camera.quaternion.setFromEuler(this._euler);
  }

  _syncPlanetCamera(rightArg = null) {
    this._up.copy(this.camera.position).normalize();
    this._planetForward.addScaledVector(this._up, -this._planetForward.dot(this._up)).normalize();
    const right = rightArg || this._tmp.copy(this._planetForward).cross(this._up).normalize();
    const lookDir = this._tmp2.copy(this._planetForward)
      .multiplyScalar(Math.cos(this._pitch))
      .addScaledVector(this._up, Math.sin(this._pitch))
      .normalize();
    this.camera.up.copy(this._up).applyAxisAngle(lookDir, this._roll * 0.35);
    this.camera.lookAt(this.camera.position.clone().add(lookDir));
    void right;
  }
}
