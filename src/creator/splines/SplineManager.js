import * as THREE from 'three';
import { SplineMaskBaker } from './SplineMaskBaker.js';
import { SplineEditor } from './SplineEditor.js';
import { resampleSpline, nearestSegment } from './SplinePath.js';
import { migrateSplines, serializeSplines } from './SplineSerializer.js';

const uid = (prefix) => `${prefix}-${crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
const defaultSpline = (type) => ({
  id: uid('spline'), name: type === 'river' ? 'River' : 'Road', type, enabled: true, visible: true, locked: false,
  controlPoints: [], closed: false, interpolation: 'catmull-rom', resolution: 'auto', width: type === 'river' ? 34 : 24,
  falloff: type === 'river' ? 16 : 18, heightMode: type === 'river' ? 'carve' : 'flatten', targetHeight: 0, heightOffset: 0,
  depth: type === 'river' ? 14 : 0, bankWidth: type === 'river' ? 18 : 0, bankSoftness: .7, materialMask: true,
  biome: type === 'river' ? 'wetland' : 'canyon', clearProps: true, propClearRadius: 0,
  renderSettings: { water: type === 'river' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});

export class SplineManager {
  constructor({ scene, camera, domElement, controls, uniforms, getBounds, getBaseHeight, picker, gpuTier, onChange, onStableAction, onToast }) {
    this.scene = scene; this.camera = camera; this.controls = controls; this.onChange = onChange; this.onStableAction = onStableAction; this.toast = onToast;
    this.splines = []; this.selectedId = null; this.draft = null; this.enabled = false;
    this.group = new THREE.Group(); this.group.name = 'Spline overlays'; this.group.renderOrder = 20; scene.add(this.group);
    this.baker = new SplineMaskBaker({ uniforms, getBounds, getBaseHeight, resolution: gpuTier === 'low' ? 256 : gpuTier === 'medium' ? 384 : 512 });
    this.editor = new SplineEditor({ domElement, picker, manager: this, controls });
  }
  setEditingEnabled(enabled) { this.enabled = !!enabled; this.editor.setEnabled(enabled); this._render(); this._emit(); }
  createSpline(type) { if (this.editor.creatingType) return; this.editor.begin(type === 'river' ? 'river' : 'road'); }
  createDraft(type) { this.draft = defaultSpline(type); this._render(); }
  addDraftPoint(hit) { if (!this.draft) return; this.draft.controlPoints.push(this._point(hit)); this._render(); this._emit(); }
  removeDraftPoint() { this.draft?.controlPoints.pop(); this._render(); this._emit(); }
  cancelDraft() { this.draft = null; this._render(); }
  finishDraft() {
    if (!this.draft || this.draft.controlPoints.length < 2) { this.cancelDraft(); return; }
    this.draft.name = `${this.draft.type === 'river' ? 'River' : 'Road'} ${this.splines.filter((s) => s.type === this.draft.type).length + 1}`;
    this.splines.push(this.draft); this.selectedId = this.draft.id; this.draft = null; this.bake(); this._stable('Added spline');
  }
  updateSpline(id, patch, { preview = false } = {}) {
    const s = this._find(id); if (!s || s.locked) return;
    Object.assign(s, patch, { updatedAt: new Date().toISOString() }); this.bake({ preview }); if (!preview) this._scheduleStable(`Changed ${s.type}`);
  }
  deleteSpline(id) { const i = this.splines.findIndex((s) => s.id === id); if (i < 0) return; this.splines.splice(i, 1); if (this.selectedId === id) this.selectedId = null; this.bake(); this._stable('Deleted spline'); }
  duplicateSpline(id) { const s = this._find(id); if (!s) return; const clone = JSON.parse(JSON.stringify(s)); clone.id = uid('spline'); clone.name = `${s.name} copy`; clone.controlPoints.forEach((p) => { p.id = uid('point'); p.x += 10; p.z += 10; }); this.splines.push(clone); this.selectedId = clone.id; this.bake(); this._stable('Duplicated spline'); }
  selectSpline(id) { this.selectedId = id; this._render(); this._emit(); }
  movePoint(splineId, pointId, hit, { preview = false } = {}) { const s = this._find(splineId); const p = s?.controlPoints.find((q) => q.id === pointId); if (!p || s.locked) return; p.x = hit.x; p.z = hit.z; if (p.lockedToTerrain) p.y = hit.y; s.updatedAt = new Date().toISOString(); this.bake({ preview }); }
  finishPointMove(id) { this.bake(); this._stable('Moved spline point'); }
  deleteSelected() { const s = this._find(this.selectedId); if (s) this.deleteSpline(s.id); }
  findHandle(hit, radius) { const s = this._find(this.selectedId); if (!s) return null; for (const p of s.controlPoints) if (Math.hypot(p.x - hit.x, p.z - hit.z) <= radius) return { splineId: s.id, pointId: p.id }; return null; }
  findSpline(hit, radius) { let best = null; for (const s of this.splines) { const points = resampleSpline(s.controlPoints, { interpolation: s.interpolation, closed: s.closed, spacing: 8 }); if (points.length < 2) continue; const n = nearestSegment(points, hit.x, hit.z); if (n.distance < radius && (!best || n.distance < best.distance)) best = { id: s.id, distance: n.distance }; } return best; }
  bake(opts) { this.baker.bake(this.splines, opts); this._render(); this._emit(); }
  getHeightOffset(x, z) { return this.baker.sampleHeightOffset(x, z); }
  getPropExclusion(x, z) { return this.baker.samplePropExclusion(x, z); }
  serialize() { return serializeSplines(this.splines); }
  clear() {
    this.editor.cancel();
    this.splines = [];
    this.selectedId = null;
    this.bake();
  }
  load(value) { this.splines = migrateSplines(value); this.selectedId = null; this.bake(); }
  _point(hit) { return { id: uid('point'), x: hit.x, y: hit.y, z: hit.z, widthMultiplier: 1, depthMultiplier: 1, lockedToTerrain: true }; }
  _find(id) { return this.splines.find((s) => s.id === id); }
  _stable(label) { this._emit(); this.onStableAction?.(label); }
  _scheduleStable(label) {
    clearTimeout(this._stableTimer);
    this._stableTimer = setTimeout(() => { this._stableTimer = null; this._stable(label); }, 450);
  }
  _emit() { this.onChange?.({ enabled: this.enabled, selectedId: this.selectedId, creatingType: this.editor?.creatingType ?? null, draftPointCount: this.draft?.controlPoints?.length ?? 0, splines: this.serialize() }); }
  _render() {
    while (this.group.children.length) { const c = this.group.children.pop(); c.geometry?.dispose?.(); c.material?.dispose?.(); }
    const all = this.draft ? [...this.splines, this.draft] : this.splines;
    for (const s of all) {
      if (!s.visible) continue; const pts = resampleSpline(s.controlPoints, { interpolation: s.interpolation, closed: s.closed, spacing: 6 }); if (pts.length < 2) continue;
      const selected = s.id === this.selectedId || s === this.draft; const color = s.type === 'river' ? 0x4dc9ff : 0xf2b552;
      const verts = pts.flatMap((p) => [p.x, p.y + 1.5, p.z]); const line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: selected ? 1 : .66 })); this.group.add(line);
      if (!selected && !this.enabled) continue;
      for (const p of s.controlPoints) { const handle = new THREE.Mesh(new THREE.SphereGeometry(selected ? 5 : 3.5, 10, 8), new THREE.MeshBasicMaterial({ color: selected ? 0xffffff : color })); handle.position.set(p.x, p.y + 3, p.z); this.group.add(handle); }
      if (s.type === 'river' && s.renderSettings?.water) this._riverRibbon(s, pts);
    }
    this.group.visible = this.enabled || all.some((s) => s.visible);
  }
  _riverRibbon(s, points) {
    if (points.length < 2) return; const v = [], uv = [], ind = []; let len = 0;
    points.forEach((p, i) => { const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)]; const dx = next.x - prev.x, dz = next.z - prev.z, l = Math.hypot(dx, dz) || 1; const nx = -dz / l, nz = dx / l; const w = s.width * .82; if (i) len += Math.hypot(p.x - prev.x, p.z - prev.z); const y = p.y - s.depth * .45 + .45; v.push(p.x + nx * w, y, p.z + nz * w, p.x - nx * w, y, p.z - nz * w); uv.push(0, len / 16, 1, len / 16); if (i) { const a = (i - 1) * 2; ind.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ind); const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2b91c5, transparent: true, opacity: .58, depthWrite: false, side: THREE.DoubleSide })); mesh.renderOrder = 12; this.group.add(mesh);
  }
  dispose() { clearTimeout(this._stableTimer); this.editor.dispose(); this.baker.dispose(); this.scene.remove(this.group); this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
}
