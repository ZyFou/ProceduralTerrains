import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { TerrainPicker } from '../engine/terrain/TerrainPicker.js';
import { ManualTerrainField } from './ManualTerrainField.js';
import {
  createManualShape,
  getManualShapeDefinition,
  normalizeManualShape,
  normalizeManualTerrainDocument,
} from './ManualShapeCatalog.js';

const TRANSFORM_MODES = new Set(['translate', 'rotate', 'scale']);

function isTypingTarget(target) {
  const tag = target?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
}

function cloneShapes(shapes) {
  return shapes.map((shape) => ({
    ...shape,
    position: { ...shape.position },
    scale: { ...shape.scale },
  }));
}

export class ManualTerrainModeManager {
  constructor({
    scene,
    camera,
    domElement,
    uniforms,
    controls,
    getBounds,
    getHeightAt,
    gpuTier,
    onChange,
    onStableAction,
    onToast,
  }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.uniforms = uniforms;
    this.controls = controls;
    this.getBounds = getBounds;
    this.getHeightAt = getHeightAt;
    this.onChange = onChange;
    this.onStableAction = onStableAction;
    this.onToast = onToast;
    this.shapes = [];
    this.selectedId = null;
    this.enabled = false;
    this.transformMode = 'translate';
    this.placementType = null;
    this.dragType = null;
    this._draggingTransform = false;
    this._visuals = new Map();

    this.field = new ManualTerrainField({ uniforms, getBounds, gpuTier });
    this.picker = new TerrainPicker({
      camera,
      domElement,
      heightAt: (x, z) => this.getHeightAt(x, z),
      contains: (x, z) => {
        const bounds = getBounds();
        return x >= bounds.origin.x && x <= bounds.origin.x + bounds.span.x
          && z >= bounds.origin.z && z <= bounds.origin.z + bounds.span.z;
      },
    });

    this.group = new THREE.Group();
    this.group.name = 'manual-terrain-shape-helpers';
    this.scene.add(this.group);

    this.anchor = new THREE.Object3D();
    this.anchor.name = 'manual-terrain-transform-anchor';
    this.scene.add(this.anchor);

    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
      depthTest: false,
      depthWrite: false,
    });
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(7, 18, 12), markerMaterial);
    this.marker.renderOrder = 10001;
    this.marker.visible = false;
    this.anchor.add(this.marker);

    this.transform = new TransformControls(camera, domElement);
    this.transform.size = 0.82;
    this.transform.space = 'local';
    this.transform.visible = false;
    this.scene.add(this.transform);
    this.transform.addEventListener('dragging-changed', (event) => {
      this._draggingTransform = !!event.value;
      this.controls.enabled = !event.value;
      if (!event.value) {
        this._applyAnchorTransform();
        this.onStableAction?.(`Transformed ${this.selectedShape?.name ?? 'terrain shape'}`);
      }
    });
    this.transform.addEventListener('objectChange', () => this._applyAnchorTransform());

    this.preview = this._createFootprint(0x93c5fd, 0.8);
    this.preview.visible = false;
    this.preview.renderOrder = 10002;
    this.group.add(this.preview);

    this._onPointerDown = (event) => this._handlePointerDown(event);
    this._onPointerMove = (event) => this._handlePointerMove(event);
    this._onDragOver = (event) => this._handleDragOver(event);
    this._onDrop = (event) => this._handleDrop(event);
    this._onKeyDown = (event) => this._handleKeyDown(event);
    this.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.domElement.addEventListener('pointermove', this._onPointerMove);
    this.domElement.addEventListener('dragover', this._onDragOver);
    this.domElement.addEventListener('drop', this._onDrop);
    window.addEventListener('keydown', this._onKeyDown, true);
    this._syncUniforms();
  }

  get selectedShape() {
    return this.shapes.find((shape) => shape.id === this.selectedId) ?? null;
  }

  _createFootprint(color, opacity = 0.72) {
    const points = [];
    for (let index = 0; index < 96; index++) {
      const angle = (index / 96) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
    });
    const line = new THREE.LineLoop(geometry, material);
    line.renderOrder = 10000;
    return line;
  }

  _syncUniforms() {
    this.uniforms.uManualEnabled.value = this.enabled && this.shapes.length ? 1 : 0;
  }

  _state() {
    return {
      enabled: this.enabled,
      selectedId: this.selectedId,
      transformMode: this.transformMode,
      placementType: this.placementType,
      revision: this.field.revision,
      shapes: cloneShapes(this.shapes),
    };
  }

  _emit(meta = {}) {
    this._syncUniforms();
    this.onChange?.(this._state(), meta);
  }

  enable({ silent = false } = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this._previousControlInputMode = this.controls.inputMode ?? 'all';
    this.controls.inputMode = 'orbitOnly';
    this.group.visible = true;
    this._syncVisuals();
    this._emit();
    if (!silent) this.onToast?.('Manual Terrain — drag a shape onto the terrain, then use W / E / R to transform it');
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.placementType = null;
    this.dragType = null;
    this.controls.inputMode = this._previousControlInputMode ?? 'all';
    this.controls.enabled = true;
    this.group.visible = false;
    this.preview.visible = false;
    this.transform.detach();
    this.transform.visible = false;
    this.marker.visible = false;
    this._emit();
  }

  setEnabled(enabled, options) {
    if (enabled) this.enable(options);
    else this.disable();
  }

  setTransformMode(mode) {
    this.transformMode = TRANSFORM_MODES.has(mode) ? mode : 'translate';
    this.transform.setMode(this.transformMode);
    this.transform.space = this.transformMode === 'translate' ? 'world' : 'local';
    this.transform.showX = this.transformMode !== 'rotate';
    this.transform.showY = this.transformMode === 'rotate';
    this.transform.showZ = this.transformMode !== 'rotate';
    this._syncAnchor();
    this._emit();
  }

  setPlacementType(type) {
    this.placementType = type ? getManualShapeDefinition(type).id : null;
    this.dragType = null;
    this.preview.visible = false;
    this._emit();
  }

  beginDrag(type) {
    this.dragType = getManualShapeDefinition(type).id;
    this.placementType = null;
    this._emit();
  }

  endDrag() {
    this.dragType = null;
    this.preview.visible = false;
    this._emit();
  }

  addShape(type, position, overrides = {}) {
    const shape = createManualShape(type, position, overrides);
    this.shapes.push(shape);
    this.selectedId = shape.id;
    this.placementType = null;
    this.dragType = null;
    this.preview.visible = false;
    this._rebuildTerrain();
    this._syncVisuals();
    this._emit({ terrainChanged: true, label: `Added ${shape.name}` });
    this.onStableAction?.(`Added ${shape.name}`);
    return shape;
  }

  updateShape(id, patch = {}, { stable = true } = {}) {
    const index = this.shapes.findIndex((shape) => shape.id === id);
    if (index < 0) return null;
    const current = this.shapes[index];
    const next = normalizeManualShape({
      ...current,
      ...patch,
      position: { ...current.position, ...(patch.position || {}) },
      scale: { ...current.scale, ...(patch.scale || {}) },
    }, index);
    this.shapes[index] = next;
    const terrainChanged = Object.keys(patch).some((key) => key !== 'name');
    if (terrainChanged) this._rebuildTerrain();
    this._syncVisuals();
    this._emit({ terrainChanged, documentChanged: true, label: `Updated ${next.name}` });
    if (stable) this.onStableAction?.(`Updated ${next.name}`);
    return next;
  }

  selectShape(id) {
    const nextId = this.shapes.some((shape) => shape.id === id) ? id : null;
    if (nextId === this.selectedId) return;
    this.selectedId = nextId;
    this._syncVisuals();
    this._emit();
  }

  deleteShape(id = this.selectedId) {
    const index = this.shapes.findIndex((shape) => shape.id === id);
    if (index < 0) return false;
    const [removed] = this.shapes.splice(index, 1);
    this.selectedId = this.shapes[Math.min(index, this.shapes.length - 1)]?.id ?? null;
    this._rebuildTerrain();
    this._syncVisuals();
    this._emit({ terrainChanged: true, label: `Deleted ${removed.name}` });
    this.onStableAction?.(`Deleted ${removed.name}`);
    return true;
  }

  duplicateShape(id = this.selectedId) {
    const source = this.shapes.find((shape) => shape.id === id);
    if (!source) return null;
    return this.addShape(source.type, {
      x: source.position.x + Math.min(80, source.scale.x * 0.16),
      z: source.position.z + Math.min(80, source.scale.z * 0.16),
    }, {
      ...source,
      id: undefined,
      name: `${source.name} Copy`,
      seed: source.seed + 1,
      scale: { ...source.scale },
    });
  }

  clear({ emit = true } = {}) {
    this.shapes = [];
    this.selectedId = null;
    this.placementType = null;
    this.dragType = null;
    this.preview.visible = false;
    this._rebuildTerrain();
    this._syncVisuals();
    if (emit) this._emit({ terrainChanged: true, label: 'Cleared manual terrain' });
  }

  serialize() {
    return { version: 1, shapes: cloneShapes(this.shapes) };
  }

  load(input, { emit = true } = {}) {
    const document = normalizeManualTerrainDocument(input);
    this.shapes = document.shapes;
    this.selectedId = null;
    this.placementType = null;
    this.dragType = null;
    this.preview.visible = false;
    this._rebuildTerrain();
    this._syncVisuals();
    if (emit) this._emit({ terrainChanged: true, label: 'Loaded manual terrain' });
    return true;
  }

  _rebuildTerrain() {
    this.field.rebuild(this.shapes);
    this._syncUniforms();
  }

  _shapeHeight(shape) {
    const value = this.getHeightAt(shape.position.x, shape.position.z);
    return Number.isFinite(value) ? value + 10 : 10;
  }

  _shapeFootprintHeight(shape) {
    const edgeX = shape.position.x + Math.cos(shape.rotation) * shape.scale.x;
    const edgeZ = shape.position.z + Math.sin(shape.rotation) * shape.scale.x;
    const value = this.getHeightAt(edgeX, edgeZ);
    return Number.isFinite(value) ? value + 7 : 7;
  }

  _syncVisuals() {
    const liveIds = new Set(this.shapes.map((shape) => shape.id));
    for (const [id, visual] of this._visuals) {
      if (liveIds.has(id)) continue;
      visual.parent?.remove(visual);
      visual.geometry.dispose();
      visual.material.dispose();
      this._visuals.delete(id);
    }

    for (const shape of this.shapes) {
      let visual = this._visuals.get(shape.id);
      if (!visual) {
        visual = this._createFootprint(shape.id === this.selectedId ? 0x60a5fa : 0x94a3b8);
        visual.userData.manualShapeId = shape.id;
        this.group.add(visual);
        this._visuals.set(shape.id, visual);
      }
      visual.position.set(shape.position.x, this._shapeFootprintHeight(shape), shape.position.z);
      visual.rotation.y = -shape.rotation;
      visual.scale.set(shape.scale.x, 1, shape.scale.z);
      visual.material.color.setHex(shape.id === this.selectedId ? 0x60a5fa : 0x94a3b8);
      visual.material.opacity = shape.id === this.selectedId ? 0.95 : 0.38;
    }

    this._syncAnchor();
  }

  _syncAnchor() {
    const shape = this.selectedShape;
    if (!this.enabled || !shape) {
      this.transform.detach();
      this.transform.visible = false;
      this.marker.visible = false;
      return;
    }
    if (!this._draggingTransform) {
      const definition = getManualShapeDefinition(shape.type);
      this.anchor.position.set(shape.position.x, this._shapeHeight(shape), shape.position.z);
      this.anchor.rotation.set(0, -shape.rotation, 0);
      this.anchor.scale.set(
        shape.scale.x / definition.size.x,
        1,
        shape.scale.z / definition.size.z,
      );
    }
    this.marker.visible = true;
    this.transform.attach(this.anchor);
    this.transform.visible = true;
    this.transform.setMode(this.transformMode);
    this.transform.space = this.transformMode === 'translate' ? 'world' : 'local';
    this.transform.showX = this.transformMode !== 'rotate';
    this.transform.showY = this.transformMode === 'rotate';
    this.transform.showZ = this.transformMode !== 'rotate';
  }

  _applyAnchorTransform() {
    const shape = this.selectedShape;
    if (!shape) return;
    const definition = getManualShapeDefinition(shape.type);
    const patch = {};
    if (this.transformMode === 'translate') {
      patch.position = { x: this.anchor.position.x, z: this.anchor.position.z };
    } else if (this.transformMode === 'rotate') {
      patch.rotation = -this.anchor.rotation.y;
    } else if (this.transformMode === 'scale') {
      patch.scale = {
        x: Math.max(8, definition.size.x * Math.abs(this.anchor.scale.x)),
        z: Math.max(8, definition.size.z * Math.abs(this.anchor.scale.z)),
      };
    }
    this.updateShape(shape.id, patch, { stable: false });
  }

  _pickShapeAt(point) {
    for (let index = this.shapes.length - 1; index >= 0; index--) {
      const shape = this.shapes[index];
      const dx = point.x - shape.position.x;
      const dz = point.z - shape.position.z;
      const cos = Math.cos(shape.rotation);
      const sin = Math.sin(shape.rotation);
      const x = (dx * cos + dz * sin) / shape.scale.x;
      const z = (-dx * sin + dz * cos) / shape.scale.z;
      if (x * x + z * z <= 1.08) return shape;
    }
    return null;
  }

  _handlePointerDown(event) {
    if (!this.enabled || event.button !== 0 || this._draggingTransform || this.transform.axis) return;
    const point = this.picker.pickEvent(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.placementType) {
      this.addShape(this.placementType, point);
      return;
    }
    this.selectShape(this._pickShapeAt(point)?.id ?? null);
  }

  _handlePointerMove(event) {
    if (!this.enabled || !this.placementType) return;
    const point = this.picker.pickEvent(event, { quality: 'preview' });
    if (!point) {
      this.preview.visible = false;
      return;
    }
    this._updatePreview(this.placementType, point);
  }

  _handleDragOver(event) {
    if (!this.enabled || !this.dragType) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const point = this.picker.pickEvent(event, { quality: 'preview' });
    if (point) this._updatePreview(this.dragType, point);
  }

  _handleDrop(event) {
    if (!this.enabled || !this.dragType) return;
    event.preventDefault();
    event.stopPropagation();
    const point = this.picker.pickEvent(event);
    if (point) this.addShape(this.dragType, point);
    else this.endDrag();
  }

  _updatePreview(type, point) {
    const definition = getManualShapeDefinition(type);
    this.preview.position.set(point.x, point.y + 8, point.z);
    this.preview.rotation.y = 0;
    this.preview.scale.set(definition.size.x, 1, definition.size.z);
    this.preview.visible = true;
  }

  _handleKeyDown(event) {
    if (!this.enabled || isTypingTarget(event.target)) return;
    if (event.key === 'Escape') {
      this.setPlacementType(null);
      this.selectShape(null);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedId) {
      event.preventDefault();
      this.deleteShape();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && this.selectedId) {
      event.preventDefault();
      this.duplicateShape();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'w') this.setTransformMode('translate');
    else if (key === 'e') this.setTransformMode('rotate');
    else if (key === 'r') this.setTransformMode('scale');
  }

  update() {
    if (!this.enabled || this._draggingTransform) return;
    // Keep helpers sitting above a terrain whose combined height may have
    // changed because another selected shape was edited.
    for (const shape of this.shapes) {
      const visual = this._visuals.get(shape.id);
      if (visual) visual.position.y = this._shapeFootprintHeight(shape);
    }
    if (this.selectedShape) {
      this.anchor.position.y = this._shapeHeight(this.selectedShape);
    }
  }

  dispose() {
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.domElement.removeEventListener('dragover', this._onDragOver);
    this.domElement.removeEventListener('drop', this._onDrop);
    window.removeEventListener('keydown', this._onKeyDown, true);
    this.transform.detach();
    this.transform.dispose();
    this.transform.parent?.remove(this.transform);
    this.group.parent?.remove(this.group);
    this.anchor.parent?.remove(this.anchor);
    for (const visual of this._visuals.values()) {
      visual.geometry.dispose();
      visual.material.dispose();
    }
    this.preview.geometry.dispose();
    this.preview.material.dispose();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
    this.field.dispose();
  }
}
