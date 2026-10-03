import * as THREE from 'three';
import { geoPointToCellWorld } from './RealWorldBuildings.js';

// Render at double resolution and fit the card to the place name. Sprite size
// stays constant on screen so distant labels remain readable when orbiting.
function placeLabel(name, scale = 1) {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '600 28px "Segoe UI", sans-serif';
  ctx.font = font;
  const width = Math.min(420, Math.max(72, Math.ceil(ctx.measureText(name).width) + 40));
  const height = 56;
  canvas.width = width * 2; canvas.height = height * 2;
  ctx.scale(2, 2);
  ctx.clearRect(0, 0, width, height);
  ctx.beginPath(); ctx.roundRect(1, 1, width - 2, height - 2, 14);
  ctx.fillStyle = 'rgba(15,23,32,0.86)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.24)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f5f7fa'; ctx.fillText(name, width / 2, height / 2 + 1, width - 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, toneMapped: false, sizeAttenuation: false }));
  label.scale.set(0.018 * scale * width / height, 0.018 * scale, 1);
  label.center.set(0.5, 0);
  return label;
}

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
    const markerRadius = size * 0.7 * ((state.markerSize ?? 100) / 100);
    const world = (point) => geoPointToCellWorld(point, geo.bbox0, geo.zoom, 0, 0, cellSize);
    const inside = ({ x, z }) => tiles.some((t) => Math.abs(x / cellSize - t.cx) <= 0.5 && Math.abs(z / cellSize - t.cz) <= 0.5);
    const height = (p) => (sampleHeight(p.x, p.z) || 0);
    const shown = (p) => p?.visible && (p.source !== 'city' || state.autoCities);
    for (const point of state.points.filter(shown)) {
      const p = world(point);
      if (!inside(p)) continue;
      const ground = height(p), y = ground + state.lift;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(markerRadius, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffca65', toneMapped: false }));
      dot.position.set(p.x, y, p.z);
      this.group.add(dot);
      dot.userData.markerId = point.id;
      this.pickTargets.push(dot);
      const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p.x, ground, p.z), new THREE.Vector3(p.x, y, p.z)]), new THREE.LineBasicMaterial({ color: '#ffca65', transparent: true, opacity: 0.38, depthWrite: false, toneMapped: false }));
      this.group.add(stem);
      if (!state.labels) continue;
      const label = placeLabel(point.name, (state.labelSize ?? 100) / 100);
      label.position.set(p.x, y + Math.max(size * 1.8, markerRadius * 1.5), p.z);
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
