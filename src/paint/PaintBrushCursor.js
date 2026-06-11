import * as THREE from 'three';

export class PaintBrushCursor {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'paint-brush-cursor';
    this.group.visible = false;
    this.group.renderOrder = 9999;

    const ringGeo = new THREE.RingGeometry(0.96, 1.0, 96);
    ringGeo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(ringGeo, mat);
    this.ring.renderOrder = 9999;
    this.group.add(this.ring);
    scene.add(this.group);
  }

  setVisible(visible) { this.group.visible = !!visible; }

  update(point, radius) {
    if (!point) return this.setVisible(false);
    this.group.position.set(point.x, point.y + 2, point.z);
    this.group.scale.setScalar(Math.max(1, radius));
    this.setVisible(true);
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.ring.geometry.dispose();
    this.ring.material.dispose();
  }
}
