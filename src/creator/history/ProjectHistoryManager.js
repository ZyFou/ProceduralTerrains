const DB = 'procedural-terrains-creator-history'; const STORE = 'snapshots';
const clone = (value) => JSON.parse(JSON.stringify(value));
import { APP_VERSION } from '../../constants/app.js';

export class ProjectHistoryManager {
  constructor({ getState, restoreState, getThumbnail, onChange, limit = 100 }) { this.getState = getState; this.restoreState = restoreState; this.getThumbnail = getThumbnail; this.onChange = onChange; this.limit = limit; this.actions = []; this.cursor = -1; this.snapshots = []; this._open(); }
  record(type, label) {
    const after = clone(this.getState()); const before = this.cursor >= 0 ? this.actions[this.cursor].after : null;
    this.actions.splice(this.cursor + 1); this.actions.push({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, type, label, timestamp: Date.now(), before, after, affectedSystems: [type] });
    if (this.actions.length > this.limit) this.actions.shift(); this.cursor = this.actions.length - 1; this._emit();
  }
  canUndo() { return this.cursor > 0; } canRedo() { return this.cursor < this.actions.length - 1; }
  undo() { if (!this.canUndo()) return false; this.cursor--; this.restoreState(clone(this.actions[this.cursor].after)); this._emit(); return true; }
  redo() { if (!this.canRedo()) return false; this.cursor++; this.restoreState(clone(this.actions[this.cursor].after)); this._emit(); return true; }
  restoreAction(id) {
    const index = this.actions.findIndex((action) => action.id === id);
    if (index < 0) return false;
    this.cursor = index;
    this.restoreState(clone(this.actions[index].after));
    this._emit();
    return true;
  }
  async createSnapshot(name, { description = '', automatic = false, tags = [] } = {}) {
    const snap = { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, name: name || 'Untitled snapshot', description, timestamp: Date.now(), appVersion: APP_VERSION, thumbnail: await this.getThumbnail?.(), projectState: clone(this.getState()), tags, automatic };
    this.snapshots.push(snap); if (automatic) { const autos = this.snapshots.filter((s) => s.automatic); while (autos.length > 5) { const old = autos.shift(); this.snapshots = this.snapshots.filter((s) => s.id !== old.id); } }
    await this._put(snap); this._emit(); return snap;
  }
  restoreSnapshot(id) { const s = this.snapshots.find((x) => x.id === id); if (!s) return false; this.restoreState(clone(s.projectState)); this.record('snapshot', `Restored ${s.name}`); return true; }
  deleteSnapshot(id) { this.snapshots = this.snapshots.filter((s) => s.id !== id); this._delete(id); this._emit(); }
  renameSnapshot(id, name) { const s = this.snapshots.find((x) => x.id === id); if (!s) return; s.name = name; this._put(s); this._emit(); }
  serializeMetadata() { return this.snapshots.filter((s) => !s.automatic).map(({ projectState, ...meta }) => meta); }
  _emit() {
    const actions = this.actions.map(({ before, after, ...action }) => action);
    const snapshots = this.snapshots.map(({ projectState, ...snapshot }) => snapshot);
    this.onChange?.({ actions, cursor: this.cursor, snapshots });
  }
  async _open() { if (!globalThis.indexedDB) return; try { const db = await new Promise((resolve, reject) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' }); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); this.db = db; const all = await new Promise((resolve) => { const r = db.transaction(STORE).objectStore(STORE).getAll(); r.onsuccess = () => resolve(r.result || []); r.onerror = () => resolve([]); }); this.snapshots = all; this._emit(); } catch { /* snapshots remain memory-only */ } }
  _put(v) { if (!this.db) return Promise.resolve(); return new Promise((resolve) => { const r = this.db.transaction(STORE, 'readwrite').objectStore(STORE).put(v); r.onsuccess = r.onerror = () => resolve(); }); }
  _delete(id) { if (!this.db) return; this.db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id); }
}
