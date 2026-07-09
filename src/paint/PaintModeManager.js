import * as THREE from 'three';
import { PaintLayerManager } from './PaintLayerManager.js';
import { PaintBrushCursor } from './PaintBrushCursor.js';
import { TerrainHeightSampler } from '../engine/terrain/TerrainHeightSampler.js';
import { TerrainPicker } from '../engine/terrain/TerrainPicker.js';

const DEFAULT_STATE = {
  enabled: false,
  tool: 'raise',
  brushSize: 90,
  strength: 0.35,
  falloff: 0.75,
  brushShape: 'round',
  brushRotation: 0,
  brushScatter: 0.55,
  brushSpacing: 0.35,
  targetHeight: 120,
  riverDepth: 28,
  riverBankSoftness: 0.65,
  biome: 'desert',
  propType: 'mixed',
  layerOpacity: 1,
  // 'generated' = paint on top of the procedural terrain (default), 'flat' =
  // Empty Terrain (procedural base suppressed, only paint/water/erosion show).
  baseMode: 'generated',
  baseMultiplier: 1,
};

export class PaintModeManager {
  constructor({ scene, camera, domElement, uniforms, controls, getBoardSize, getParams, gpuTier, onChange, onToast }) {
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
    this.layers = new PaintLayerManager({ uniforms, boardSize: getBoardSize(), gpuTier });
    this.cursor = new PaintBrushCursor(scene);
    this.cpuSampler = new TerrainHeightSampler(uniforms, () => ({ octaves: Math.round(getParams().octaves), infinite: false }));
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hit = null;
    this.picker = new TerrainPicker({ camera, domElement, heightAt: (x, z) => this._heightAt(x, z), contains: (x, z) => {
      const half = this.getBoardSize() / 2; return Math.abs(x) <= half && Math.abs(z) <= half;
    } });
    this.isPainting = false;
    this._lastStamp = 0;
    this._lastPaintPoint = null;

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
    this.state.brushRotation = Math.max(-180, Math.min(180, this.state.brushRotation));
    this.state.brushScatter = Math.max(0.05, Math.min(1, this.state.brushScatter));
    this.state.brushSpacing = Math.max(0.08, Math.min(1, this.state.brushSpacing));
    this.state.riverDepth = Math.max(1, Math.min(220, this.state.riverDepth));
    this.state.riverBankSoftness = Math.max(0.05, Math.min(1, this.state.riverBankSoftness));
    this._syncUniforms();
    this._emit();
  }

  clear({ silent = false } = {}) {
    this.layers.clear();
    if (!silent) this.onToast?.('Paint layers cleared');
  }

  // Non-destructive: swap which procedural base the paint layers sit on top
  // of, without touching any existing strokes.
  setBaseMode(mode) {
    const baseMode = mode === 'flat' ? 'flat' : 'generated';
    this.state.baseMode = baseMode;
    this.state.baseMultiplier = baseMode === 'flat' ? 0 : 1;
    this._syncUniforms();
    this._emit();
  }

  // Destructive "start fresh" action: flatten the base AND wipe existing
  // paint strokes in one step, kept separate from setBaseMode so toggling
  // the base alone never silently discards work.
  startEmpty() {
    this.setBaseMode('flat');
    this.layers.clear();
    this.onToast?.('Empty Terrain — flat board, paint layers cleared');
  }

  serialize() { return this.layers.serialize(); }
  load(data) { return this.layers.load(data); }

  update() {
    if (!this.state.enabled) return;
    if (this.hit) this.cursor.update(this.hit, this.state.brushSize, this.state.brushShape, this.state.brushRotation);
    if (this.isPainting) this._stamp();
  }

  _syncUniforms() {
    this.layers.setBoardSize(this.getBoardSize());
    this.uniforms.uPaintEnabled.value = this.state.enabled ? 1 : 0;
    this.uniforms.uPaintBoardSize.value = this.getBoardSize();
    this.uniforms.uPaintOpacity.value = this.state.layerOpacity;
    this.uniforms.uPaintBaseMult.value = this.state.baseMultiplier;
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
    this._lastPaintPoint = null;
    this._stamp(true);
  }

  _onPointerUp() {
    const wasPainting = this.isPainting;
    this.isPainting = false;
    this._lastPaintPoint = null;
    // a finished stroke is one "stable action" — emit so the app can snapshot
    // it into the undo history (the layer revision has advanced).
    if (wasPainting) this._emit();
  }

  _onWheel(e) {
    if (!this.state.enabled || !e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    this.setState({ brushSize: Math.round(this.state.brushSize * factor) });
  }

  _updateHit(e) {
    this.hit = this.picker.pickEvent(e, { quality: this.isPainting ? 'preview' : 'final' });
    this.cursor.update(this.hit, this.state.brushSize, this.state.brushShape, this.state.brushRotation);
  }

  _heightAt(x, z, includePaint = true) {
    const half = this.getBoardSize() / 2;
    if (Math.abs(x) > half || Math.abs(z) > half) return null;
    const base = this.cpuSampler.heightAt(x, z) * this.state.baseMultiplier;
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
    const minStampMs = this.state.tool === 'smooth' ? 45 : 16;
    if (!force && now - this._lastStamp < minStampMs) return;
    this._lastStamp = now;

    const current = this.hit.clone();
    if (force || !this._lastPaintPoint) {
      this._stampAt(current);
      this._lastPaintPoint = current;
      return;
    }

    const spacing = Math.max(2, this.state.brushSize * this.state.brushSpacing);
    const dist = this._lastPaintPoint.distanceTo(current);
    if (dist < spacing) return;

    const steps = Math.min(64, Math.floor(dist / spacing));
    const start = this._lastPaintPoint.clone();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this._stampAt(start.clone().lerp(current, t));
    }
    this._lastPaintPoint = current;
  }

  _stampAt(point) {
    this.layers.stamp({
      x: point.x,
      z: point.z,
      radius: this.state.brushSize,
      strength: this.state.strength,
      falloff: this.state.falloff,
      tool: this.state.tool,
      targetHeight: this.state.targetHeight,
      biome: this.state.biome,
      propType: this.state.propType,
      brushShape: this.state.brushShape,
      brushRotation: THREE.MathUtils.degToRad(this.state.brushRotation),
      brushScatter: this.state.brushScatter,
      riverDepth: this.state.riverDepth,
      riverBankSoftness: this.state.riverBankSoftness,
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
