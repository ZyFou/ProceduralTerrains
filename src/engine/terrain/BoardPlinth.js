import * as THREE from 'three';

// Clean diorama base for the studio board: four outward walls + flat bottom.
// Sits slightly outside the terrain perimeter so chunk skirts never overlap it.

const PLINTH_COLOR = 0x231e19;
const OUTSET = 0.35;

export function createBoardPlinthMaterial() {
  return new THREE.MeshStandardMaterial({
    color: PLINTH_COLOR,
    roughness: 0.92,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 4,
  });
}

export function buildBoardPlinthGeometry(boardSize, skirtDepth, topY = 0) {
  const half = boardSize / 2;
  const baseY = -skirtDepth;
  const x0 = -half - OUTSET;
  const x1 = half + OUTSET;
  const z0 = -half - OUTSET;
  const z1 = half + OUTSET;

  const positions = new Float32Array([
    x0, topY, z0,  x1, topY, z0,  x1, topY, z1,  x0, topY, z1,
    x0, baseY, z0, x1, baseY, z0, x1, baseY, z1, x0, baseY, z1,
  ]);

  const indices = [
    0, 1, 5,  0, 5, 4,
    1, 2, 6,  1, 6, 5,
    2, 3, 7,  2, 7, 6,
    3, 0, 4,  3, 4, 7,
    4, 7, 6,  4, 6, 5,
  ];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
