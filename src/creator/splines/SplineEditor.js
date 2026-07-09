import * as THREE from 'three';
import { nearestSegment } from './SplinePath.js';

export class SplineEditor {
  constructor({ domElement, picker, manager, controls }) {
    this.domElement = domElement; this.picker = picker; this.manager = manager; this.controls = controls;
    this.enabled = false; this.creatingType = null; this.drag = null;
    this._move = this._move.bind(this); this._down = this._down.bind(this); this._up = this._up.bind(this); this._key = this._key.bind(this);
    domElement.addEventListener('pointerdown', this._down); domElement.addEventListener('pointermove', this._move); window.addEventListener('pointerup', this._up); window.addEventListener('keydown', this._key);
  }
  setEnabled(value) { this.enabled = !!value; if (!value) this.cancel(); }
  begin(type) { this.enabled = true; this.creatingType = type; this.manager.createDraft(type); this.manager.toast(`${type === 'river' ? 'River' : 'Road'}: click terrain to place points · Enter to finish`); }
  cancel() { this.creatingType = null; this.drag = null; this.manager.cancelDraft(); }
  _down(e) {
    if (!this.enabled || e.button !== 0) return;
    const hit = this.picker.pickEvent(e, { quality: 'preview' }); if (!hit) return;
    if (this.creatingType) { this.manager.addDraftPoint(hit); e.preventDefault(); return; }
    const point = this.manager.findHandle(hit, 22);
    if (point) { this.drag = point; this.controls.inputMode = 'orbitOnly'; e.preventDefault(); return; }
    const selected = this.manager.findSpline(hit, 18);
    if (selected) { this.manager.selectSpline(selected.id); e.preventDefault(); }
  }
  _move(e) {
    if (!this.enabled || !this.drag) return;
    const hit = this.picker.pickEvent(e, { quality: 'preview' }); if (!hit) return;
    this.manager.movePoint(this.drag.splineId, this.drag.pointId, hit, { preview: true });
  }
  _up() { if (!this.drag) return; this.manager.finishPointMove(this.drag.splineId); this.drag = null; this.controls.inputMode = 'all'; }
  _key(e) {
    if (!this.enabled || /INPUT|TEXTAREA/.test(e.target?.tagName || '')) return;
    if (e.key === 'Enter') { this.manager.finishDraft(); this.creatingType = null; }
    else if (e.key === 'Escape') this.cancel();
    else if (e.key === 'Backspace' && this.creatingType) this.manager.removeDraftPoint();
    else if (e.key === 'Delete') this.manager.deleteSelected();
  }
  dispose() { this.domElement.removeEventListener('pointerdown', this._down); this.domElement.removeEventListener('pointermove', this._move); window.removeEventListener('pointerup', this._up); window.removeEventListener('keydown', this._key); }
}
