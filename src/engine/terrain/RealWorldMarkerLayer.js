import * as THREE from 'three';
import { geoPointToCellWorld } from './RealWorldBuildings.js';

export class RealWorldMarkerLayer {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'real-world-markers';
    scene.add(this.group);
  }
  clear() {
    this.pickTargets = [];
    for (const child of [...this.group.children]) {
      child.geometry?.dispose();
      child.material?.map?.dispose();
      child.material?.dispose();
      this.group.remove(child);
    }
  }
  rebuild({ state, geo, cellSize, tiles, sampleHeight, visible }) {
    this.clear();
    this.group.visible = visible && state.visible;
    if (!geo?.bbox0 || !visible) return;
    const size = Math.max(1, cellSize * 0.004);
    const world = (point) => geoPointToCellWorld(point, geo.bbox0, geo.zoom, 0, 0, cellSize);
    const inside = ({ x, z }) => tiles.some((t) => Math.abs(x / cellSize - t.cx) <= 0.5 && Math.abs(z / cellSize - t.cz) <= 0.5);
    const height = (p) => (sampleHeight(p.x, p.z) || 0);
    const shown = (p) => p?.visible && (p.source !== 'city' || state.autoCities);
    for (const point of state.points.filter(shown)) {
      const p = world(point);
      if (!inside(p)) continue;
      const ground = height(p), y = ground + state.lift;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffca65' }));
      dot.position.set(p.x, y, p.z);
      this.group.add(dot);
      dot.userData.markerId = point.id;
      this.pickTargets.push(dot);
      const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p.x, ground, p.z), new THREE.Vector3(p.x, y, p.z)]), new THREE.LineBasicMaterial({ color: '#ffca65', transparent: true, opacity: 0.6 }));
      this.group.add(stem);
      if (!state.labels) continue;
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(512, 64) : Object.assign(document.createElement('canvas'), { width: 512, height: 64 });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(18,24,32,0.9)'; ctx.fillRect(0, 0, 512, 64);
      ctx.font = '24px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.fillText(point.name, 256, 41, 490);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
      label.position.set(p.x, y + size * 4, p.z); label.scale.set(size * 32, size * 4, 1);
      this.group.add(label);
      label.userData.markerId = point.id;
      this.pickTargets.push(label);
    }
    for (const route of state.routes.filter((r) => r.visible)) {
      const from = state.points.find((p) => p.id === route.from), to = state.points.find((p) => p.id === route.to);
      if (!shown(from) || !shown(to)) continue;
      const a = world(from), b = world(to);
      let segment = [];
      const flush = () => {
        if (segment.length > 1) this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(segment), new THREE.LineBasicMaterial({ color: '#69d7ff' })));
        segment = [];
      };
      for (let i = 0; i <= 256; i++) {
        const t = i / 256, p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        if (!inside(p)) { flush(); continue; }
        segment.push(new THREE.Vector3(p.x, height(p) + Math.max(size, state.lift * 0.12), p.z));
      }
      flush();
    }
  }
  pick(raycaster) {
    if (!this.group.visible) return null;
    this.group.updateMatrixWorld(true);
    return raycaster.intersectObjects(this.pickTargets || [], false)[0]?.object.userData.markerId || null;
  }
  select(id) {
    for (const object of this.pickTargets || []) {
      object.material.color.set(object.userData.markerId === id ? '#69d7ff' : object.isSprite ? '#ffffff' : '#ffca65');
    }
  }
  dispose() { this.clear(); this.group.removeFromParent(); }
}
