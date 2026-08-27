import * as THREE from 'three';
import { TerrainPicker } from '../terrain/TerrainPicker.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const DEFAULT_EXPLODE_SETTINGS = Object.freeze({
  shape: 'bowl',
  resolution: 'auto',
  radius: 4.5,
  strength: 0.72,
  rim: 0.42,
  falloff: 0.72,
  scorch: 0.68,
  debris: true,
  sound: true,
  cameraShake: true,
});

const SHAPES = new Set(['bowl', 'punch', 'ragged']);
const RESOLUTIONS = new Set(['auto', '512', '768', '1024']);
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function resolveExplosionResolution(value, gpuTier = 'high') {
  const normalized = RESOLUTIONS.has(String(value)) ? String(value) : 'auto';
  if (normalized !== 'auto') return Number(normalized);
  if (gpuTier === 'low') return 384;
  if (gpuTier === 'medium') return 512;
  return 640;
}

export function explosionProcessingForResolution(resolution) {
  const resolved = clamp(Math.round(Number(resolution)) || 512, 384, 1024);
  if (resolved >= 1024) return { sampleGrid: 4, angularSteps: 128, iterations: 3, blend: 0.18, padding: 5 };
  if (resolved >= 768) return { sampleGrid: 3, angularSteps: 96, iterations: 2, blend: 0.22, padding: 4 };
  if (resolved >= 640) return { sampleGrid: 2, angularSteps: 72, iterations: 2, blend: 0.24, padding: 4 };
  if (resolved >= 512) return { sampleGrid: 2, angularSteps: 64, iterations: 1, blend: 0.28, padding: 3 };
  return { sampleGrid: 1, angularSteps: 48, iterations: 1, blend: 0.32, padding: 3 };
}

export function normalizeExplodeSettings(value = {}) {
  return {
    shape: SHAPES.has(value.shape) ? value.shape : DEFAULT_EXPLODE_SETTINGS.shape,
    resolution: RESOLUTIONS.has(String(value.resolution)) ? String(value.resolution) : DEFAULT_EXPLODE_SETTINGS.resolution,
    radius: clamp(finiteOr(value.radius, DEFAULT_EXPLODE_SETTINGS.radius), 0.5, 18),
    strength: clamp(finiteOr(value.strength, DEFAULT_EXPLODE_SETTINGS.strength), 0.1, 2),
    rim: clamp(finiteOr(value.rim, DEFAULT_EXPLODE_SETTINGS.rim), 0, 1),
    falloff: clamp(finiteOr(value.falloff, DEFAULT_EXPLODE_SETTINGS.falloff), 0.1, 1),
    scorch: clamp(finiteOr(value.scorch, DEFAULT_EXPLODE_SETTINGS.scorch), 0, 1),
    debris: value.debris !== false,
    sound: value.sound !== false,
    cameraShake: value.cameraShake !== false,
  };
}

function makeParticleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.36, 'rgba(255,255,255,.8)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class ExplodeTool {
  constructor({ scene, camera, domElement, field, getBounds, getHeightAt, getHeightScale, gpuTier, settings, onChange }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.field = field;
    this.getBounds = getBounds;
    this.getHeightAt = getHeightAt;
    this.getHeightScale = getHeightScale;
    this.gpuTier = gpuTier;
    this.onChange = onChange;
    this.enabled = false;
    this.settings = normalizeExplodeSettings(settings);
    this.effects = [];
    this._pointerDown = null;
    this._particleTexture = makeParticleTexture();
    this._audioContext = null;
    this._shake = 0;
    this._shakeScale = 0;
    this._shakeOffset = new THREE.Vector3();
    this._reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    this._picker = new TerrainPicker({
      camera,
      domElement,
      heightAt: getHeightAt,
      contains: (x, z) => {
        const { origin, span } = getBounds();
        return x >= origin.x && x <= origin.x + span.x && z >= origin.z && z <= origin.z + span.z;
      },
    });
    this._reticle = this._makeReticle();
    this._onPointerMove = (event) => this._pointerMove(event);
    this._onPointerDown = (event) => this._pointerStart(event);
    this._onPointerUp = (event) => this._pointerEnd(event);
    this._onPointerLeave = () => { this._reticle.visible = false; };
  }

  _makeReticle() {
    const geometry = new THREE.RingGeometry(0.82, 1, 56);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff7a24,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const reticle = new THREE.Mesh(geometry, material);
    reticle.renderOrder = 120;
    reticle.visible = false;
    this.scene.add(reticle);
    return reticle;
  }

  state(extra = {}) {
    return {
      enabled: this.enabled,
      settings: { ...this.settings },
      hasDamage: this.field.hasDamage(),
      revision: this.field.revision,
      ...extra,
    };
  }

  _emit(extra) { this.onChange?.(this.state(extra)); }

  setEnabled(enabled) {
    const next = !!enabled;
    if (next === this.enabled) return;
    this.enabled = next;
    if (next) {
      this.domElement.addEventListener('pointermove', this._onPointerMove);
      this.domElement.addEventListener('pointerdown', this._onPointerDown);
      this.domElement.addEventListener('pointerup', this._onPointerUp);
      this.domElement.addEventListener('pointerleave', this._onPointerLeave);
    } else {
      this._reticle.visible = false;
      this._pointerDown = null;
      this.domElement.removeEventListener('pointermove', this._onPointerMove);
      this.domElement.removeEventListener('pointerdown', this._onPointerDown);
      this.domElement.removeEventListener('pointerup', this._onPointerUp);
      this.domElement.removeEventListener('pointerleave', this._onPointerLeave);
    }
    this._emit();
  }

  setSettings(patch) {
    this.settings = normalizeExplodeSettings({ ...this.settings, ...patch });
    this._emit({ settingsChanged: true });
    return this.settings;
  }

  _metrics() {
    const { span } = this.getBounds();
    const worldSize = Math.max(1, Math.min(span.x, span.z));
    const radius = Math.max(4, worldSize * this.settings.radius * 0.01);
    const depth = Math.max(this.getHeightScale() * 0.012, radius * 0.34) * this.settings.strength;
    return { radius, depth, rimHeight: depth * this.settings.rim * 0.55 };
  }

  _pointerMove(event) {
    if (!this.enabled) return;
    const point = this._picker.pickEvent(event, { quality: 'preview' });
    if (!point) { this._reticle.visible = false; return; }
    const { radius } = this._metrics();
    this._reticle.visible = true;
    this._reticle.position.set(point.x, point.y + Math.max(1, radius * 0.012), point.z);
    this._reticle.scale.setScalar(radius);
  }

  _pointerStart(event) {
    if (!this.enabled || event.button !== 0) return;
    this._pointerDown = { x: event.clientX, y: event.clientY };
  }

  _pointerEnd(event) {
    if (!this.enabled || event.button !== 0 || !this._pointerDown) return;
    const moved = Math.hypot(event.clientX - this._pointerDown.x, event.clientY - this._pointerDown.y);
    this._pointerDown = null;
    if (moved > 5) return;
    const point = this._picker.pickEvent(event);
    if (point) this.explode(point);
  }

  explode(target) {
    if (!this.enabled || !target) return false;
    const metrics = this._metrics();
    const processing = explosionProcessingForResolution(this.field.resolution);
    const patch = this.field.stampCrater({
      x: target.x,
      z: target.z,
      radius: metrics.radius,
      depth: metrics.depth,
      rimHeight: metrics.rimHeight,
      scorch: this.settings.scorch,
      shape: this.settings.shape,
      falloff: this.settings.falloff,
      seed: ((performance.now() * 1000) | 0) ^ this.field.revision,
      sampleGrid: processing.sampleGrid,
      angularSteps: processing.angularSteps,
      processingPadding: processing.padding,
    });
    this.field.finalizeCrater(patch, processing);
    this._spawnEffect(target, metrics);
    this._playSound();
    if (this.settings.cameraShake && !this._reducedMotion) {
      this._shake = Math.min(1.25, 0.22 + this.settings.strength * 0.38);
      this._shakeScale = metrics.radius;
    }
    this._emit({ terrainChanged: true });
    return true;
  }

  clear() {
    if (!this.field.hasDamage()) return false;
    this.field.clear();
    this._emit({ terrainChanged: true });
    return true;
  }

  smoothEdges() {
    if (!this.field.smoothEdges()) return false;
    this._emit({ terrainChanged: true, edgesSmoothed: true });
    return true;
  }

  _spawnEffect(position, metrics) {
    const tier = this.gpuTier === 'low' ? 0.35 : this.gpuTier === 'medium' ? 0.65 : 1;
    const motion = this._reducedMotion ? 0.3 : 1;
    const count = this.settings.debris ? Math.max(10, Math.round(150 * tier * motion)) : 0;
    let particles = null;
    let velocities = null;
    if (count) {
      const positions = new Float32Array(count * 3);
      velocities = new Float32Array(count * 3);
      for (let index = 0; index < count; index++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = metrics.radius * (0.3 + Math.random() * 1.15);
        velocities[index * 3] = Math.cos(angle) * speed;
        velocities[index * 3 + 1] = metrics.radius * (0.65 + Math.random() * 1.8);
        velocities[index * 3 + 2] = Math.sin(angle) * speed;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: 0x9a6847,
        size: Math.max(3, metrics.radius * 0.045),
        map: this._particleTexture,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      });
      particles = new THREE.Points(geometry, material);
      particles.position.copy(position);
      particles.renderOrder = 125;
      this.scene.add(particles);
    }

    const ringGeometry = new THREE.RingGeometry(0.88, 1, 64);
    ringGeometry.rotateX(-Math.PI / 2);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xff7a24,
      transparent: true,
      opacity: this._reducedMotion ? 0.35 : 0.82,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.copy(position).add(new THREE.Vector3(0, Math.max(2, metrics.radius * 0.02), 0));
    ring.scale.setScalar(metrics.radius * 0.08);
    ring.renderOrder = 126;
    this.scene.add(ring);

    const flashGeometry = new THREE.SphereGeometry(1, 16, 10);
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffa14f,
      transparent: true,
      opacity: this._reducedMotion ? 0.25 : 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.position.copy(position);
    flash.scale.setScalar(metrics.radius * 0.12);
    flash.renderOrder = 127;
    this.scene.add(flash);
    this.effects.push({ particles, velocities, ring, flash, radius: metrics.radius, age: 0, life: 1.7 });
  }

  _playSound() {
    if (!this.settings.sound) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      this._audioContext ||= new AudioContextClass();
      const context = this._audioContext;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(92, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(28, context.currentTime + 0.58);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, context.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.68);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.7);
    } catch { /* Sound is optional and may be browser-blocked. */ }
  }

  update(dt) {
    if (!this.effects.length && this._shake <= 0.01) return false;
    if (this._shakeOffset.lengthSq() > 0) {
      this.camera.position.sub(this._shakeOffset);
      this._shakeOffset.set(0, 0, 0);
    }
    for (let index = this.effects.length - 1; index >= 0; index--) {
      const effect = this.effects[index];
      effect.age += dt;
      const progress = clamp(effect.age / effect.life, 0, 1);
      if (effect.particles) {
        const positions = effect.particles.geometry.attributes.position.array;
        for (let particle = 0; particle < positions.length / 3; particle++) {
          effect.velocities[particle * 3 + 1] -= 9.8 * effect.radius * 0.18 * dt;
          positions[particle * 3] += effect.velocities[particle * 3] * dt;
          positions[particle * 3 + 1] += effect.velocities[particle * 3 + 1] * dt;
          positions[particle * 3 + 2] += effect.velocities[particle * 3 + 2] * dt;
        }
        effect.particles.geometry.attributes.position.needsUpdate = true;
        effect.particles.material.opacity = 0.92 * (1 - progress);
      }
      effect.ring.scale.setScalar(effect.radius * (0.08 + progress * 1.1));
      effect.ring.material.opacity *= Math.max(0, 1 - dt * 4.5);
      effect.flash.scale.setScalar(effect.radius * (0.12 + progress * 0.38));
      effect.flash.material.opacity = 0.82 * (1 - clamp(progress * 3.2, 0, 1));
      if (progress >= 1) {
        for (const object of [effect.particles, effect.ring, effect.flash]) {
          if (!object) continue;
          this.scene.remove(object);
          object.geometry.dispose();
          object.material.dispose();
        }
        this.effects.splice(index, 1);
      }
    }
    if (this._shake > 0.01) {
      const amount = this._shake * Math.max(0.18, this._shakeScale * 0.005);
      this._shakeOffset.set((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
      this.camera.position.add(this._shakeOffset);
      this._shake *= Math.exp(-8 * dt);
    }
    return true;
  }

  dispose() {
    this.setEnabled(false);
    if (this._shakeOffset.lengthSq() > 0) this.camera.position.sub(this._shakeOffset);
    this.scene.remove(this._reticle);
    this._reticle.geometry.dispose();
    this._reticle.material.dispose();
    for (const effect of this.effects) {
      for (const object of [effect.particles, effect.ring, effect.flash]) {
        if (!object) continue;
        this.scene.remove(object);
        object.geometry.dispose();
        object.material.dispose();
      }
    }
    this.effects.length = 0;
    this._particleTexture.dispose();
    this._audioContext?.close?.();
  }
}
