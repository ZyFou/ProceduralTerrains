import * as THREE from 'three';
import { PaintLayerManager } from './PaintLayerManager.js';
import { PaintBrushCursor } from './PaintBrushCursor.js';
import { TerrainHeightSampler } from '../engine/terrain/TerrainHeightSampler.js';

const DEFAULT_STATE = {
  enabled: false,
  tool: 'raise',
  brushSize: 90,
  strength: 0.35,
  falloff: 0.75,
  targetHeight: 120,
  biome: 'desert',
  layerOpacity: 1,
};

export class PaintModeManager {
  constructor({ scene, camera, domElement, uniforms, controls, getBoardSize, getParams, onChange, onToast }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.uniforms = uniforms;
    this.controls = controls;
    this.getBoardSize = getBoardSize;
    this.getParams = getParams;
    this.onChange = onChange;
    this.onToast = onToast;
    this.state = { ...DEFAULT_STATE };
    this.layers = new PaintLayerManager({ uniforms, boardSize: getBoardSize() });
    this.cursor = new PaintBrushCursor(scene);
    this.cpuSampler = new TerrainHeightSampler(uniforms, () => ({ octaves: Math.round(getParams().octaves), infinite: false }));
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hit = null;
    this.isPainting = false;
    this._lastStamp = 0;

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onContextMenu = (e) => this.state.enabled && e.preventDefault();
    this.domElement.addEventListener('pointermove', this._onPointerMove);
    this.domElement.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointerup', this._onPointerUp);
    this.domElement.addEventListener('wheel', this._onWheel, { passive: false });
    this.domElement.addEventListener('contextmenu', this._onContextMenu);
    this._syncUniforms();
  }

  enable() {
    if (this.state.enabled) return;
    this.state.enabled = true;
    this._previousControlInputMode = this.controls.inputMode ?? 'all';
    this.controls.enabled = true;
    this.controls.inputMode = 'orbitOnly';
    this._syncUniforms();
    this.onToast?.('Paint Mode — left drag paints · right drag orbits · Shift + wheel changes brush size');
    this._emit();
  }

  disable() {
    if (!this.state.enabled) return;
    this.state.enabled = false;
    this.isPainting = false;
    this.controls.enabled = true;
    this.controls.inputMode = this._previousControlInputMode ?? 'all';
    this.cursor.setVisible(false);
    this._syncUniforms();
    this.onToast?.('Exited Paint Mode');
    this._emit();
  }

  setEnabled(enabled) { enabled ? this.enable() : this.disable(); }

  setState(patch) {
    Object.assign(this.state, patch);
    this.state.brushSize = Math.max(4, Math.min(900, this.state.brushSize));
    this.state.strength = Math.max(0.01, Math.min(1, this.state.strength));
    this.state.falloff = Math.max(0, Math.min(1, this.state.falloff));
    this._syncUniforms();
    this._emit();
  }

  clear() {
    this.layers.clear();
    this.onToast?.('Paint layers cleared');
  }

  serialize() { return this.layers.serialize(); }
  load(data) { return this.layers.load(data); }

  update() {
    if (!this.state.enabled) return;
    if (this.hit) this.cursor.update(this.hit, this.state.brushSize);
    if (this.isPainting) this._stamp();
  }

  _syncUniforms() {
    this.layers.setBoardSize(this.getBoardSize());
    this.uniforms.uPaintEnabled.value = this.state.enabled ? 1 : 1;
    this.uniforms.uPaintBoardSize.value = this.getBoardSize();
    this.uniforms.uPaintOpacity.value = this.state.layerOpacity;
  }

  _emit() { this.onChange?.({ ...this.state }); }

  _onPointerMove(e) {
    if (!this.state.enabled) return;
    this._updateHit(e);
  }

  _onPointerDown(e) {
    if (!this.state.enabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.domElement.setPointerCapture?.(e.pointerId);
    this._updateHit(e);
    this.isPainting = true;
    this._stamp(true);
  }

  _onPointerUp() { this.isPainting = false; }

  _onWheel(e) {
    if (!this.state.enabled || !e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    this.setState({ brushSize: Math.round(this.state.brushSize * factor) });
  }

  _updateHit(e) {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.hit = this._intersectHeightField(this.raycaster.ray);
    this.cursor.update(this.hit, this.state.brushSize);
  }

  _heightAt(x, z, includePaint = true) {
    const half = this.getBoardSize() / 2;
    if (Math.abs(x) > half || Math.abs(z) > half) return null;
    const base = this.cpuSampler.heightAt(x, z);
    return includePaint ? base + this.layers.sampleHeightOffset(x, z) * this.state.layerOpacity : base;
  }

  _intersectHeightField(ray) {
    const maxDist = Math.max(3000, this.getBoardSize() * 4);
    let prevT = 0;
    let prevD = ray.origin.y - (this._heightAt(ray.origin.x, ray.origin.z) ?? -Infinity);
    const steps = 96;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * maxDist;
      const p = ray.at(t, new THREE.Vector3());
      const h = this._heightAt(p.x, p.z);
      if (h == null) continue;
      const d = p.y - h;
      if (d <= 0 && prevD >= 0) {
        let a = prevT, b = t;
        for (let k = 0; k < 8; k++) {
          const m = (a + b) * 0.5;
          const q = ray.at(m, new THREE.Vector3());
          const mh = this._heightAt(q.x, q.z);
          if (q.y - mh > 0) a = m; else b = m;
        }
        const hit = ray.at((a + b) * 0.5, new THREE.Vector3());
        hit.y = this._heightAt(hit.x, hit.z);
        return hit;
      }
      prevT = t;
      prevD = d;
    }
    return null;
  }

  _stamp(force = false) {
    if (!this.hit) return;
    const now = performance.now();
    const minStampMs = this.state.tool === 'smooth' ? 80 : 24;
    if (!force && now - this._lastStamp < minStampMs) return;
    this._lastStamp = now;
    this.layers.stamp({
      x: this.hit.x,
      z: this.hit.z,
      radius: this.state.brushSize,
      strength: this.state.strength,
      falloff: this.state.falloff,
      tool: this.state.tool,
      targetHeight: this.state.targetHeight,
      biome: this.state.biome,
      baseHeightAt: (x, z) => this._heightAt(x, z, false) ?? 0,
    });
  }

  dispose() {
    this.disable();
    this.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointerup', this._onPointerUp);
    this.domElement.removeEventListener('wheel', this._onWheel);
    this.domElement.removeEventListener('contextmenu', this._onContextMenu);
    this.cursor.dispose();
    this.layers.dispose();
  }
}
