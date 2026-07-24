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

  setColor(color) {
    this.ring.material.color.set(color);
  }

  update(point, radius, shape = 'round', rotationDeg = 0) {
    if (!point) return this.setVisible(false);
    this.group.position.set(point.x, point.y + 2, point.z);
    const r = Math.max(1, radius);
    let sx = r;
    let sz = r;
    if (shape === 'ellipse') {
      sx = r * 1.65;
      sz = r * 0.84;
    } else if (shape === 'ribbon') {
      sx = r * 2.4;
      sz = r * 0.74;
    } else if (shape === 'scatter') {
      sx = r * 1.1;
      sz = r * 1.1;
    }
    this.group.scale.set(sx, 1, sz);
    this.group.rotation.y = THREE.MathUtils.degToRad(rotationDeg);
    this.setVisible(true);
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.ring.geometry.dispose();
    this.ring.material.dispose();
  }
}
