import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { TerrainPicker } from '../engine/terrain/TerrainPicker.js';
import { PaintBrushCursor } from '../paint/PaintBrushCursor.js';
import { ManualTerrainField } from './ManualTerrainField.js';
import { ManualSurfacePaintField } from './ManualSurfacePaintField.js';
import {
  MANUAL_SURFACE_MATERIAL_IDS,
  getManualSurfaceMaterial,
} from './ManualSurfaceCatalog.js';
import {
  MAX_MANUAL_SHAPE_LAYERS,
  createManualShapeLayer,
  createManualShape,
  getManualShapeDefinition,
  normalizeManualShapeLayer,
  normalizeManualShape,
  normalizeManualTerrainDocument,
} from './ManualShapeCatalog.js';

const TRANSFORM_MODES = new Set(['translate', 'rotate', 'scale']);
const SCULPT_TOOLS = new Set([
  'raise',
  'lower',
  'smooth',
  'flatten',
  'erode',
  'crease',
  'ridge',
  'detail',
  'terrace',
  'erase',
]);
const SCULPT_CURSOR_COLORS = Object.freeze({
  lower: 0xfca5a5,
  erode: 0xfbbf24,
  crease: 0xc084fc,
  ridge: 0x818cf8,
  detail: 0x34d399,
  terrace: 0xfb923c,
  erase: 0xf8fafc,
});
const SURFACE_TOOLS = new Set(['paint', 'blend', 'erase']);
const DEFAULT_SCULPT_STATE = Object.freeze({
  enabled: false,
  tool: 'raise',
  brushSize: 110,
  strength: 0.32,
  falloff: 0.72,
  targetHeight: 120,
  creaseWidth: 0.2,
  detailScale: 32,
  detailRoughness: 0.55,
  detailSeed: 1337,
  terraceStep: 24,
  erosionIterations: 3,
  erosionDeposition: 0.65,
  erosionTalus: 1.5,
});
const DEFAULT_TEXTURE_PAINT_STATE = Object.freeze({
  enabled: false,
  tool: 'paint',
  material: 'grass',
  brushSize: 110,
  strength: 0.45,
  falloff: 0.72,
});

function isTypingTarget(target) {
  const tag = target?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
}

function cloneShapes(shapes) {
  return shapes.map((shape) => ({
    ...shape,
    position: { ...shape.position },
    scale: { ...shape.scale },
    mask: { ...shape.mask },
    layers: (shape.layers || []).map((layer) => ({
      ...layer,
      params: { ...layer.params },
    })),
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
    this.sculpt = { ...DEFAULT_SCULPT_STATE };
    this.texturePaint = { ...DEFAULT_TEXTURE_PAINT_STATE };
    this._sculpting = false;
    this._surfacePainting = false;
    this._lastSculptPoint = null;
    this._lastSurfacePoint = null;
    this._lastSculptStampAt = 0;
    this._lastSurfaceStampAt = 0;
    this._draggingTransform = false;
    this._visuals = new Map();

    this.field = new ManualTerrainField({ uniforms, getBounds, gpuTier });
    this.surfaceField = new ManualSurfacePaintField({ getBounds, gpuTier });
    this.cursor = new PaintBrushCursor(scene);
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
    this._onPointerUp = () => this._handlePointerUp();
    this._onWheel = (event) => this._handleWheel(event);
    this._onKeyDown = (event) => this._handleKeyDown(event);
    this.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.domElement.addEventListener('pointermove', this._onPointerMove);
    this.domElement.addEventListener('dragover', this._onDragOver);
    this.domElement.addEventListener('drop', this._onDrop);
    this.domElement.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('pointerup', this._onPointerUp);
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
    this.uniforms.uManualEnabled.value = this.enabled && (this.shapes.length || !this.field.isSculptEmpty()) ? 1 : 0;
  }

  _state() {
    return {
      enabled: this.enabled,
      selectedId: this.selectedId,
      transformMode: this.transformMode,
      placementType: this.placementType,
      revision: this.field.revision,
      sculpt: {
        ...this.sculpt,
        revision: this.field.sculptRevision,
        hasData: !this.field.isSculptEmpty(),
      },
      texturePaint: {
        ...this.texturePaint,
        revision: this.surfaceField.revision,
        hasData: !this.surfaceField.isEmpty(),
      },
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
    this._previousPrimaryPointerFilter = this.controls.primaryPointerFilter ?? null;
    this._previousWheelFilter = this.controls.wheelFilter ?? null;
    this.controls.inputMode = 'all';
    this.controls.primaryPointerFilter = (event) => this._canCameraPan(event);
    this.controls.wheelFilter = (event) => !((this.sculpt.enabled || this.texturePaint.enabled) && event.shiftKey);
    this.group.visible = true;
    this._syncVisuals();
    this._emit();
    if (!silent) this.onToast?.('Manual Terrain — drag a shape onto the terrain, then use M / R / S to transform it');
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.placementType = null;
    this.dragType = null;
    this.sculpt.enabled = false;
    this.texturePaint.enabled = false;
    this._sculpting = false;
    this._surfacePainting = false;
    this._lastSculptPoint = null;
    this._lastSurfacePoint = null;
    this.controls.inputMode = this._previousControlInputMode ?? 'all';
    this.controls.primaryPointerFilter = this._previousPrimaryPointerFilter ?? null;
    this.controls.wheelFilter = this._previousWheelFilter ?? null;
    this.controls.enabled = true;
    this.group.visible = false;
    this.preview.visible = false;
    this.cursor.setVisible(false);
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
    if (this.sculpt.enabled) this.setSculptEnabled(false, { silent: true });
    if (this.texturePaint.enabled) this.setTexturePaintEnabled(false, { silent: true });
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
    if (type && this.sculpt.enabled) this.setSculptEnabled(false, { silent: true });
    if (type && this.texturePaint.enabled) this.setTexturePaintEnabled(false, { silent: true });
    this.placementType = type ? getManualShapeDefinition(type).id : null;
    this.dragType = null;
    this.preview.visible = false;
    this._emit();
  }

  beginDrag(type) {
    if (this.sculpt.enabled) this.setSculptEnabled(false, { silent: true });
    if (this.texturePaint.enabled) this.setTexturePaintEnabled(false, { silent: true });
    this.dragType = getManualShapeDefinition(type).id;
    this.placementType = null;
    this._emit();
  }

  endDrag() {
    this.dragType = null;
    this.preview.visible = false;
    this._emit();
  }

  setSculptEnabled(enabled, { silent = false } = {}) {
    const next = !!enabled;
    if (next === this.sculpt.enabled) {
      if (next) this._emit({ inspectorRequested: true });
      return;
    }
    this.sculpt.enabled = next;
    if (next && this.texturePaint.enabled) this.setTexturePaintEnabled(false, { silent: true });
    this.placementType = null;
    this.dragType = null;
    this.preview.visible = false;
    this._sculpting = false;
    this._lastSculptPoint = null;
    if (next) {
      this.selectedId = null;
      this._syncSculptCursorStyle();
      this._syncVisuals();
    } else {
      this.cursor.setVisible(false);
    }
    this._syncAnchor();
    this._emit({ inspectorRequested: next });
    if (!silent) {
      this.onToast?.(next
        ? 'Manual Sculpt — left drag sculpts · Alt + left drag pans · right drag orbits'
        : 'Exited Manual Sculpt');
    }
  }

  setSculptSetting(key, value) {
    if (key === 'tool') {
      this.sculpt.tool = SCULPT_TOOLS.has(value) ? value : 'raise';
      this._syncSculptCursorStyle();
    }
    else if (key === 'brushSize') this.sculpt.brushSize = Math.max(4, Math.min(900, Number(value) || 4));
    else if (key === 'strength') this.sculpt.strength = Math.max(0.01, Math.min(1, Number(value) || 0.01));
    else if (key === 'falloff') this.sculpt.falloff = Math.max(0.02, Math.min(1, Number(value) || 0.02));
    else if (key === 'targetHeight') this.sculpt.targetHeight = Math.max(-3000, Math.min(3000, Number(value) || 0));
    else if (key === 'creaseWidth') this.sculpt.creaseWidth = Math.max(0.04, Math.min(0.8, Number(value) || 0.04));
    else if (key === 'detailScale') this.sculpt.detailScale = Math.max(2, Math.min(240, Number(value) || 2));
    else if (key === 'detailRoughness') this.sculpt.detailRoughness = Math.max(0, Math.min(1, Number(value) || 0));
    else if (key === 'detailSeed') this.sculpt.detailSeed = Math.max(0, Math.min(2147483647, Math.round(Number(value) || 0)));
    else if (key === 'terraceStep') this.sculpt.terraceStep = Math.max(1, Math.min(400, Number(value) || 1));
    else if (key === 'erosionIterations') this.sculpt.erosionIterations = Math.max(1, Math.min(10, Math.round(Number(value) || 1)));
    else if (key === 'erosionDeposition') this.sculpt.erosionDeposition = Math.max(0, Math.min(1, Number(value) || 0));
    else if (key === 'erosionTalus') this.sculpt.erosionTalus = Math.max(0, Math.min(20, Number(value) || 0));
    this._emit();
  }

  setTexturePaintEnabled(enabled, { silent = false } = {}) {
    const next = !!enabled;
    if (next === this.texturePaint.enabled) {
      if (next) this._emit({ inspectorRequested: true });
      return;
    }
    this.texturePaint.enabled = next;
    if (next && this.sculpt.enabled) this.setSculptEnabled(false, { silent: true });
    this.placementType = null;
    this.dragType = null;
    this.preview.visible = false;
    this._surfacePainting = false;
    this._lastSurfacePoint = null;
    if (next) {
      this.selectedId = null;
      this._syncSurfaceCursorStyle();
      this._syncVisuals();
    } else {
      this.cursor.setVisible(false);
    }
    this._syncAnchor();
    this._emit({ inspectorRequested: next });
    if (!silent) {
      this.onToast?.(next
        ? 'Texture Paint ? left drag paints ? Alt + left drag pans ? right drag orbits'
        : 'Exited Texture Paint');
    }
  }

  setTexturePaintSetting(key, value) {
    if (key === 'tool') this.texturePaint.tool = SURFACE_TOOLS.has(value) ? value : 'paint';
    else if (key === 'material') this.texturePaint.material = MANUAL_SURFACE_MATERIAL_IDS.has(value) ? value : 'grass';
    else if (key === 'brushSize') this.texturePaint.brushSize = Math.max(4, Math.min(900, Number(value) || 4));
    else if (key === 'strength') this.texturePaint.strength = Math.max(0.01, Math.min(1, Number(value) || 0.01));
    else if (key === 'falloff') this.texturePaint.falloff = Math.max(0.02, Math.min(1, Number(value) || 0.02));
    this._syncSurfaceCursorStyle();
    this._emit();
  }

  clearTexturePaint() {
    if (this.surfaceField.isEmpty()) return false;
    this.surfaceField.clear();
    this.cursor.setVisible(false);
    this._emit({ documentChanged: true, surfaceChanged: true, label: 'Cleared terrain textures' });
    this.onStableAction?.('Cleared terrain textures');
    return true;
  }

  clearSculpt() {
    if (this.field.isSculptEmpty()) return false;
    this.field.clearSculpt();
    this.cursor.setVisible(false);
    this._emit({ terrainChanged: true, documentChanged: true, sculptChanged: true, label: 'Cleared sculpt layer' });
    this.onStableAction?.('Cleared sculpt layer');
    return true;
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
      mask: { ...current.mask, ...(patch.mask || {}) },
    }, index);
    this.shapes[index] = next;
    const terrainChanged = Object.keys(patch).some((key) => key !== 'name');
    if (terrainChanged) this._rebuildTerrain();
    this._syncVisuals();
    this._emit({ terrainChanged, documentChanged: true, label: `Updated ${next.name}` });
    if (stable) this.onStableAction?.(`Updated ${next.name}`);
    return next;
  }

  _commitShapeLayers(shapeIndex, layers, label) {
    if (shapeIndex < 0 || shapeIndex >= this.shapes.length) return null;
    const current = this.shapes[shapeIndex];
    const next = normalizeManualShape({ ...current, layers }, shapeIndex);
    this.shapes[shapeIndex] = next;
    this._rebuildTerrain();
    this._syncVisuals();
    this._emit({ terrainChanged: true, documentChanged: true, label });
    this.onStableAction?.(label);
    return next;
  }

  addShapeLayer(shapeId, type) {
    const shapeIndex = this.shapes.findIndex((shape) => shape.id === shapeId);
    if (shapeIndex < 0) return null;
    const shape = this.shapes[shapeIndex];
    if (shape.layers.length >= MAX_MANUAL_SHAPE_LAYERS) {
      this.onToast?.(`A shape can contain up to ${MAX_MANUAL_SHAPE_LAYERS} modifier layers`);
      return null;
    }
    const layer = createManualShapeLayer(type, { seedOffset: shape.seed + shape.layers.length * 1013 });
    this._commitShapeLayers(shapeIndex, [...shape.layers, layer], `Added ${layer.name} to ${shape.name}`);
    return layer;
  }

  updateShapeLayer(shapeId, layerId, patch = {}) {
    const shapeIndex = this.shapes.findIndex((shape) => shape.id === shapeId);
    if (shapeIndex < 0) return null;
    const shape = this.shapes[shapeIndex];
    const layerIndex = shape.layers.findIndex((layer) => layer.id === layerId);
    if (layerIndex < 0) return null;
    const current = shape.layers[layerIndex];
    const nextLayer = normalizeManualShapeLayer({
      ...current,
      ...patch,
      params: { ...current.params, ...(patch.params || {}) },
    }, layerIndex);
    const layers = shape.layers.map((layer, index) => index === layerIndex ? nextLayer : layer);
    this._commitShapeLayers(shapeIndex, layers, `Updated ${nextLayer.name} on ${shape.name}`);
    return nextLayer;
  }

  deleteShapeLayer(shapeId, layerId) {
    const shapeIndex = this.shapes.findIndex((shape) => shape.id === shapeId);
    if (shapeIndex < 0) return false;
    const shape = this.shapes[shapeIndex];
    const layer = shape.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return false;
    this._commitShapeLayers(
      shapeIndex,
      shape.layers.filter((candidate) => candidate.id !== layerId),
      `Deleted ${layer.name} from ${shape.name}`,
    );
    return true;
  }

  duplicateShapeLayer(shapeId, layerId) {
    const shapeIndex = this.shapes.findIndex((shape) => shape.id === shapeId);
    if (shapeIndex < 0) return null;
    const shape = this.shapes[shapeIndex];
    if (shape.layers.length >= MAX_MANUAL_SHAPE_LAYERS) {
      this.onToast?.(`A shape can contain up to ${MAX_MANUAL_SHAPE_LAYERS} modifier layers`);
      return null;
    }
    const layerIndex = shape.layers.findIndex((layer) => layer.id === layerId);
    if (layerIndex < 0) return null;
    const source = shape.layers[layerIndex];
    const copy = createManualShapeLayer(source.type, {
      ...source,
      id: undefined,
      name: `${source.name} Copy`,
      seedOffset: source.seedOffset + 1,
      params: { ...source.params },
    });
    const layers = [...shape.layers];
    layers.splice(layerIndex + 1, 0, copy);
    this._commitShapeLayers(shapeIndex, layers, `Duplicated ${source.name} on ${shape.name}`);
    return copy;
  }

  moveShapeLayer(shapeId, layerId, direction) {
    const shapeIndex = this.shapes.findIndex((shape) => shape.id === shapeId);
    if (shapeIndex < 0) return false;
    const shape = this.shapes[shapeIndex];
    const layerIndex = shape.layers.findIndex((layer) => layer.id === layerId);
    const nextIndex = Math.max(0, Math.min(shape.layers.length - 1, layerIndex + Math.sign(direction)));
    if (layerIndex < 0 || nextIndex === layerIndex) return false;
    const layers = [...shape.layers];
    const [layer] = layers.splice(layerIndex, 1);
    layers.splice(nextIndex, 0, layer);
    this._commitShapeLayers(shapeIndex, layers, `Reordered ${layer.name} on ${shape.name}`);
    return true;
  }

  selectShape(id, { requestInspector = false } = {}) {
    const nextId = this.shapes.some((shape) => shape.id === id) ? id : null;
    if (nextId && this.sculpt.enabled) this.setSculptEnabled(false, { silent: true });
    if (nextId && this.texturePaint.enabled) this.setTexturePaintEnabled(false, { silent: true });
    if (nextId === this.selectedId) {
      if (requestInspector && nextId) this._emit({ inspectorRequested: true });
      return;
    }
    this.selectedId = nextId;
    this._syncVisuals();
    this._emit({ inspectorRequested: requestInspector && !!nextId });
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

  moveShape(id, direction) {
    const index = this.shapes.findIndex((shape) => shape.id === id);
    const nextIndex = Math.max(0, Math.min(this.shapes.length - 1, index + Math.sign(direction)));
    if (index < 0 || nextIndex === index) return false;
    const [shape] = this.shapes.splice(index, 1);
    this.shapes.splice(nextIndex, 0, shape);
    this._rebuildTerrain();
    this._syncVisuals();
    this._emit({ terrainChanged: true, documentChanged: true, label: `Reordered ${shape.name}` });
    this.onStableAction?.(`Reordered ${shape.name}`);
    return true;
  }

  clear({ emit = true } = {}) {
    this.shapes = [];
    this.selectedId = null;
    this.placementType = null;
    this.dragType = null;
    this.sculpt.enabled = false;
    this.texturePaint.enabled = false;
    this._sculpting = false;
    this._surfacePainting = false;
    this.preview.visible = false;
    this.cursor.setVisible(false);
    this.field.clearSculpt();
    this.surfaceField.clear();
    this._rebuildTerrain();
    this._syncVisuals();
    if (emit) this._emit({ terrainChanged: true, label: 'Cleared manual terrain' });
  }

  serialize({ includeSculpt = true, includeSurface = true } = {}) {
    return {
      version: 4,
      shapes: cloneShapes(this.shapes),
      ...(includeSculpt ? { sculpt: this.field.serializeSculpt() } : {}),
      ...(includeSurface ? { surfacePaint: this.surfaceField.serialize() } : {}),
    };
  }

  serializeSculpt() {
    return this.field.serializeSculpt();
  }

  serializeSurfacePaint() {
    return this.surfaceField.serialize();
  }

  load(input, { emit = true } = {}) {
    const document = normalizeManualTerrainDocument(input);
    this.shapes = document.shapes;
    this.selectedId = null;
    this.placementType = null;
    this.dragType = null;
    this.sculpt = { ...DEFAULT_SCULPT_STATE };
    this.texturePaint = { ...DEFAULT_TEXTURE_PAINT_STATE };
    this._sculpting = false;
    this._surfacePainting = false;
    this.preview.visible = false;
    this.cursor.setVisible(false);
    this.field.loadSculpt(document.sculpt);
    this.surfaceField.load(document.surfacePaint);
    this._rebuildTerrain();
    this._syncVisuals();
    if (emit) this._emit({ terrainChanged: true, label: 'Loaded manual terrain' });
    return true;
  }

  _rebuildTerrain() {
    this.field.rebuild(this.shapes);
    this._syncUniforms();
  }

  syncBounds() {
    const terrainChanged = this.field.syncBounds(this.shapes);
    const surfaceChanged = this.surfaceField.syncBounds();
    if (!terrainChanged && !surfaceChanged) return { terrainChanged: false, surfaceChanged: false };
    this._syncUniforms();
    this._syncVisuals();
    return { terrainChanged, surfaceChanged };
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
      visual.material.opacity = shape.enabled === false ? 0.14 : shape.id === this.selectedId ? 0.95 : 0.38;
    }

    this._syncAnchor();
  }

  _syncAnchor() {
    const shape = this.selectedShape;
    if (!this.enabled || !shape || this.sculpt.enabled || this.texturePaint.enabled) {
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
      if (shape.enabled === false) continue;
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

  _canCameraPan(event) {
    if (this.sculpt.enabled || this.texturePaint.enabled) return !!event.altKey;
    if (!this.enabled || this.placementType || this.dragType || this._draggingTransform || this.transform.axis) return false;
    const point = this.picker.pickEvent(event);
    return !point || !this._pickShapeAt(point);
  }

  _handlePointerDown(event) {
    if (!this.enabled || event.button !== 0 || this._draggingTransform || this.transform.axis) return;
    if (this.texturePaint.enabled) {
      if (event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      const point = this.picker.pickEvent(event);
      if (!point) return;
      this._surfacePainting = true;
      this._lastSurfacePoint = null;
      this._lastSurfaceStampAt = 0;
      this._updateSurfaceHit(point);
      this._stampSurface(point, true);
      return;
    }
    if (this.sculpt.enabled) {
      if (event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      const point = this.picker.pickEvent(event);
      if (!point) return;
      this._sculpting = true;
      this._lastSculptPoint = null;
      this._lastSculptStampAt = 0;
      this._updateSculptHit(point);
      this._stampSculpt(point, true);
      return;
    }
    const point = this.picker.pickEvent(event);
    if (!point) return;
    if (this.placementType) {
      event.preventDefault();
      event.stopPropagation();
      this.addShape(this.placementType, point);
      return;
    }
    const shape = this._pickShapeAt(point);
    if (shape) {
      event.preventDefault();
      event.stopPropagation();
      this.selectShape(shape.id, { requestInspector: true });
      return;
    }
    this.selectShape(null);
  }

  _handlePointerMove(event) {
    if (this.enabled && this.texturePaint.enabled) {
      const point = this.picker.pickEvent(event, { quality: this._surfacePainting ? 'preview' : 'final' });
      this._updateSurfaceHit(point);
      if (this._surfacePainting && point) this._stampSurface(point);
      return;
    }
    if (this.enabled && this.sculpt.enabled) {
      const point = this.picker.pickEvent(event, { quality: this._sculpting ? 'preview' : 'final' });
      this._updateSculptHit(point);
      if (this._sculpting && point) this._stampSculpt(point);
      return;
    }
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

  _handlePointerUp() {
    if (this._surfacePainting) {
      this._surfacePainting = false;
      this._lastSurfacePoint = null;
      this._lastSurfaceStampAt = 0;
      this._emit({
        documentChanged: true,
        surfaceChanged: true,
        label: `Painted terrain texture (${this.texturePaint.tool})`,
      });
      this.onStableAction?.(`Painted terrain texture (${this.texturePaint.tool})`);
      return;
    }
    if (!this._sculpting) return;
    this._sculpting = false;
    this._lastSculptPoint = null;
    this._lastSculptStampAt = 0;
    this._emit({
      terrainChanged: true,
      documentChanged: true,
      sculptChanged: true,
      label: `Sculpted terrain (${this.sculpt.tool})`,
    });
    this.onStableAction?.(`Sculpted terrain (${this.sculpt.tool})`);
  }

  _handleWheel(event) {
    if (!this.enabled || (!this.sculpt.enabled && !this.texturePaint.enabled) || !event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    if (this.texturePaint.enabled) {
      this.setTexturePaintSetting('brushSize', Math.round(this.texturePaint.brushSize * factor));
    } else {
      this.setSculptSetting('brushSize', Math.round(this.sculpt.brushSize * factor));
    }
  }

  _updateSculptHit(point) {
    this.cursor.update(point, this.sculpt.brushSize);
  }

  _syncSculptCursorStyle() {
    this.cursor.setColor(SCULPT_CURSOR_COLORS[this.sculpt.tool] ?? 0x7dd3fc);
  }

  _stampSculpt(point, force = false) {
    if (!point) return;
    const now = performance.now();
    const minStampMs = this.sculpt.tool === 'erode' ? 32 : 16;
    if (!force && now - this._lastSculptStampAt < minStampMs) return;
    const current = point.clone();
    const spacingFactor = this.sculpt.tool === 'crease' || this.sculpt.tool === 'ridge'
      ? 0.1
      : this.sculpt.tool === 'detail' ? 0.16 : 0.22;
    const spacing = Math.max(2, this.sculpt.brushSize * spacingFactor);
    if (!force && this._lastSculptPoint && this._lastSculptPoint.distanceTo(current) < spacing) return;
    if (!force && this._lastSculptPoint) {
      const start = this._lastSculptPoint.clone();
      const distance = start.distanceTo(current);
      const steps = Math.min(48, Math.max(1, Math.floor(distance / spacing)));
      for (let index = 1; index <= steps; index++) {
        this._stampSculptAt(start.clone().lerp(current, index / steps));
      }
    } else {
      this._stampSculptAt(current);
    }
    this._lastSculptPoint = current;
    this._lastSculptStampAt = now;
  }

  _stampSculptAt(point) {
    this.field.stamp({
      x: point.x,
      z: point.z,
      radius: this.sculpt.brushSize,
      strength: this.sculpt.strength,
      falloff: this.sculpt.falloff,
      tool: this.sculpt.tool,
      targetHeight: this.sculpt.targetHeight,
      creaseWidth: this.sculpt.creaseWidth,
      detailScale: this.sculpt.detailScale,
      detailRoughness: this.sculpt.detailRoughness,
      detailSeed: this.sculpt.detailSeed,
      terraceStep: this.sculpt.terraceStep,
      erosionIterations: this.sculpt.erosionIterations,
      erosionDeposition: this.sculpt.erosionDeposition,
      erosionTalus: this.sculpt.erosionTalus,
    });
    this._syncUniforms();
  }

  _updateSurfaceHit(point) {
    this.cursor.update(point, this.texturePaint.brushSize);
  }

  _syncSurfaceCursorStyle() {
    const material = getManualSurfaceMaterial(this.texturePaint.material);
    const color = this.texturePaint.tool === 'erase'
      ? 0xf8fafc
      : this.texturePaint.tool === 'blend'
        ? 0x60a5fa
        : material.color;
    this.cursor.setColor(color);
  }

  _stampSurface(point, force = false) {
    if (!point) return;
    const now = performance.now();
    const minStampMs = this.texturePaint.tool === 'blend' ? 32 : 16;
    if (!force && now - this._lastSurfaceStampAt < minStampMs) return;
    const current = point.clone();
    const spacing = Math.max(2, this.texturePaint.brushSize * 0.18);
    if (!force && this._lastSurfacePoint && this._lastSurfacePoint.distanceTo(current) < spacing) return;
    if (!force && this._lastSurfacePoint) {
      const start = this._lastSurfacePoint.clone();
      const distance = start.distanceTo(current);
      const steps = Math.min(48, Math.max(1, Math.floor(distance / spacing)));
      for (let index = 1; index <= steps; index++) {
        this._stampSurfaceAt(start.clone().lerp(current, index / steps));
      }
    } else {
      this._stampSurfaceAt(current);
    }
    this._lastSurfacePoint = current;
    this._lastSurfaceStampAt = now;
  }

  _stampSurfaceAt(point) {
    const material = getManualSurfaceMaterial(this.texturePaint.material);
    this.surfaceField.stamp({
      x: point.x,
      z: point.z,
      radius: this.texturePaint.brushSize,
      strength: this.texturePaint.strength,
      falloff: this.texturePaint.falloff,
      tool: this.texturePaint.tool,
      materialChannel: material.channel,
    });
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
      if (this.texturePaint.enabled) {
        event.preventDefault();
        this.setTexturePaintEnabled(false);
        return;
      }
      if (this.sculpt.enabled) {
        event.preventDefault();
        this.setSculptEnabled(false);
        return;
      }
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
    if (key === 'b') {
      event.preventDefault();
      this.setSculptEnabled(!this.sculpt.enabled);
      return;
    }
    if (key === 't') {
      event.preventDefault();
      this.setTexturePaintEnabled(!this.texturePaint.enabled);
      return;
    }
    if (key === 'm' || key === 'r' || key === 's') {
      event.preventDefault();
      if (key === 'm') this.setTransformMode('translate');
      else if (key === 'r') this.setTransformMode('rotate');
      else this.setTransformMode('scale');
    }
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

  flushUploads() {
    const height = this.field.flushUploads();
    const surface = this.surfaceField.flushUploads();
    return height || surface;
  }

  dispose() {
    if (this.enabled) {
      this.controls.inputMode = this._previousControlInputMode ?? 'all';
      this.controls.primaryPointerFilter = this._previousPrimaryPointerFilter ?? null;
      this.controls.wheelFilter = this._previousWheelFilter ?? null;
      this.controls.enabled = true;
    }
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.domElement.removeEventListener('dragover', this._onDragOver);
    this.domElement.removeEventListener('drop', this._onDrop);
    window.removeEventListener('keydown', this._onKeyDown, true);
    window.removeEventListener('pointerup', this._onPointerUp);
    this.domElement.removeEventListener('wheel', this._onWheel);
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
    this.cursor.dispose();
    this.field.dispose();
    this.surfaceField.dispose();
  }
}
