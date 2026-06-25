import * as THREE from 'three';

const DEG = Math.PI / 180;
const PITCH_LIMIT = 70 * DEG;
const MAX_BANK = 70 * DEG;

const DEFAULT_PLANE_CONFIG = {
  gravity: 32,
  minSpeed: 25,
  cruiseSpeed: 95,
  maxSpeed: 240,
  engineAccel: 45,
  drag: 0.08,
  diveGain: 1.2,
  pitchRate: 1.35,
  yawRate: 0.62,
  rollRate: 1.8,
  mouseSensitivity: 0.0019,
  terrainClearance: 4,
  spawnClearance: 28,
  defaultThrottle: 0.65,
  throttleUpRate: 1.05,
  throttleDownRate: 0.75,
  spawnSpeedFactor: 0.8,
  spawnPitch: 0.08,
  stallThrottle: 0.15,
  groundRecoveryFactor: 0.45,
};

export class PlaneController {
  constructor({ camera, domElement, sampler = null, planetSampler = null, config = {} }) {
    this.camera = camera;
    this.dom = domElement;
    this.sampler = sampler;
    this.planetSampler = planetSampler;
    this.cfg = { ...DEFAULT_PLANE_CONFIG, ...config };
    this.isPlanet = !!planetSampler;

    this.throttle = this.cfg.defaultThrottle;
    this.speedMultiplier = 1;
    this.airspeed = 0;
    this.state = 'flying';
    this.altitude = 0;
    this.verticalSpeed = 0;
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
  get pitchDeg() { return this._pitch * (180 / Math.PI); }
  get rollDeg() { return (-this._roll) * (180 / Math.PI); }

  getHudData() {
    return {
      throttle: this.throttle,
      pitch: this.pitchDeg,
      roll: this.rollDeg,
      heading: this._headingDeg(),
      altitude: this.altitude,
      airspeed: this.airspeed,
      speed: this._vel.length(),
      verticalSpeed: this.verticalSpeed,
      state: this.state,
    };
  }

  _headingDeg() {
    if (this.isPlanet) {
      const fwd = this._tmp.copy(this._planetForward);
      const east = this._tmp2.set(0, 1, 0).cross(this._up);
      if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
      else east.normalize();
      const north = this._tmp2.copy(this._up).cross(east).normalize();
      const h = Math.atan2(fwd.dot(east), fwd.dot(north)) * (180 / Math.PI);
      return ((h % 360) + 360) % 360;
    }
    return ((this._yaw * (180 / Math.PI) % 360) + 360) % 360;
  }

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
      this._pitch = this.cfg.spawnPitch;
      this.airspeed = this._spawnSpeed();
      const lookDir = this._tmp2.copy(this._planetForward)
        .multiplyScalar(Math.cos(this._pitch))
        .addScaledVector(this._up, Math.sin(this._pitch))
        .normalize();
      this._vel.copy(lookDir).multiplyScalar(this.airspeed);
      this._syncPlanetCamera();
      return;
    }

    const ground = this._flatGround(this.camera.position.x, this.camera.position.z);
    this.camera.position.y = Math.max(this.camera.position.y, ground + this.cfg.spawnClearance);
    const fwd = this.camera.getWorldDirection(this._tmp).normalize();
    this._yaw = Math.atan2(-fwd.x, -fwd.z);
    this._pitch = Math.asin(Math.max(-0.95, Math.min(0.95, fwd.y)));
    this._pitch = Math.max(this._pitch, this.cfg.spawnPitch);
    this._roll = 0;
    this.airspeed = this._spawnSpeed();
    this._vel.copy(this._forward()).multiplyScalar(this.airspeed);
    this._syncFlatCamera();
  }

  update(dt) {
    if (this.isPlanet) this._updatePlanet(dt);
    else this._updateFlat(dt);
  }

  _integrateArcadeFlight(fwd, dt) {
    const cfg = this.cfg;
    const maxSpeed = Math.max(cfg.minSpeed, cfg.maxSpeed * this.speedMultiplier);
    const idleSpeed = cfg.minSpeed * 0.3;
    const targetSpeed = THREE.MathUtils.lerp(idleSpeed, maxSpeed, this.throttle);
    const accelStep = cfg.engineAccel * dt;
    const delta = targetSpeed - this.airspeed;
    if (Math.abs(delta) <= accelStep) {
      this.airspeed = targetSpeed;
    } else {
      this.airspeed += Math.sign(delta) * accelStep;
    }

    this.airspeed += cfg.gravity * Math.max(0, -Math.sin(this._pitch)) * cfg.diveGain * dt;
    const dragRatio = this.airspeed / Math.max(1, maxSpeed);
    this.airspeed -= cfg.drag * dragRatio * dragRatio * cfg.maxSpeed * dt;
    this.airspeed = THREE.MathUtils.clamp(this.airspeed, 0, maxSpeed);
    this._vel.copy(fwd).multiplyScalar(this.airspeed);
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
    this._integrateArcadeFlight(fwd, dt);

    this.camera.position.addScaledVector(this._vel, dt);
    const ground = this._flatGround(this.camera.position.x, this.camera.position.z);
    const clearance = this.camera.position.y - ground;
    this.altitude = Math.max(0, clearance);
    this.verticalSpeed = this._vel.y;
    this.airspeed = this._vel.length();
    const stall = this.airspeed < cfg.minSpeed && this.throttle < cfg.stallThrottle;
    this.state = clearance <= cfg.terrainClearance + 0.2 ? 'grounded' : (stall ? 'stalling' : 'flying');

    if (clearance < cfg.terrainClearance) {
      this.camera.position.y = ground + cfg.spawnClearance;
      this.airspeed = Math.max(cfg.minSpeed * 1.1, this.airspeed * cfg.groundRecoveryFactor);
      this._pitch = Math.max(cfg.spawnPitch, this._pitch);
      this._roll *= 0.3;
      this._vel.copy(this._forward()).multiplyScalar(this.airspeed);
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
    this._integrateArcadeFlight(fwd, dt);

    pos.addScaledVector(this._vel, dt);
    this._up.copy(pos).normalize();
    const surface = this._surfaceRadius(this._up);
    const altitude = pos.length() - surface;
    this.altitude = Math.max(0, altitude);
    this.verticalSpeed = this._vel.dot(this._up);
    this.airspeed = this._vel.length();
    const stall = this.airspeed < cfg.minSpeed && this.throttle < cfg.stallThrottle;
    this.state = altitude <= cfg.terrainClearance + 0.2 ? 'grounded' : (stall ? 'stalling' : 'flying');
    if (altitude < cfg.terrainClearance) {
      pos.copy(this._up).multiplyScalar(surface + cfg.spawnClearance);
      this.airspeed = Math.max(cfg.minSpeed * 1.1, this.airspeed * cfg.groundRecoveryFactor);
      this._pitch = Math.max(cfg.spawnPitch, this._pitch);
      this._roll *= 0.3;
      const recoverDir = this._tmp2.copy(this._planetForward)
        .multiplyScalar(Math.cos(this._pitch))
        .addScaledVector(this._up, Math.sin(this._pitch))
        .normalize();
      this._vel.copy(recoverDir).multiplyScalar(this.airspeed);
      this.state = 'grounded';
    }

    this._syncPlanetCamera(right);
  }

  _input(dt) {
    const canKeys = this._locked;
    if (canKeys) {
      if (this._keys.has('KeyW') || this._keys.has('KeyZ') || this._keys.has('ShiftLeft') || this._keys.has('ShiftRight')) {
        this.throttle = Math.min(1, this.throttle + dt * this.cfg.throttleUpRate);
      }
      if (this._keys.has('KeyS') || this._keys.has('ControlLeft') || this._keys.has('ControlRight')) {
        this.throttle = Math.max(0, this.throttle - dt * this.cfg.throttleDownRate);
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

  _spawnSpeed() {
    const cruise = this.cfg.cruiseSpeed * this.throttle * this.speedMultiplier;
    return Math.min(this.cfg.maxSpeed * this.speedMultiplier, Math.max(this.cfg.minSpeed * 1.35, cruise * this.cfg.spawnSpeedFactor));
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
    this._euler.set(this._pitch, this._yaw, -this._roll, 'YXZ');
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
    this.camera.up.copy(this._up).applyAxisAngle(lookDir, -this._roll * 0.35);
    this.camera.lookAt(this.camera.position.clone().add(lookDir));
    void right;
  }
}
