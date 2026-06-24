import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Clean diorama base for the studio board: four outward walls + flat bottom.
// Sits slightly outside the terrain perimeter so chunk skirts never overlap it.
//
// The terrain's own outer-edge skirt drops to this plinth's base and is shaded
// with the plinth colour (see TerrainMaterial), forming the contoured wall that
// masks the under-the-map view. This box just closes off the bottom and the
// below-water sides with a clean rectangular silhouette.

const PLINTH_COLOR = 0x231e19;
const OUTSET = 0.35;   // default; Engine passes the wall flare so the box caps it

export function createBoardPlinthMaterial() {
  return new THREE.MeshStandardMaterial({
    color: PLINTH_COLOR,
    roughness: 0.92,
    metalness: 0.02,
    // DoubleSide so the far walls still mask when looking across the board over a
    // low (underwater) near edge — FrontSide culls them and the band between the
    // underwater terrain edge and the waterline shows through to the background.
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 4,
  });
}

export function buildBoardPlinthGeometry(boardSize, skirtDepth, topY = 0, outset = OUTSET, center = { x: 0, z: 0 }) {
  const half = boardSize / 2;
  const baseY = -skirtDepth;
  const x0 = center.x - half - outset;
  const x1 = center.x + half + outset;
  const z0 = center.z - half - outset;
  const z1 = center.z + half + outset;

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

// Circular equivalent of buildBoardPlinthGeometry: an outer wall and a bottom,
// deliberately without a top cap. A top cap sits directly below sea level and
// shows through lakes as a solid dark floor.
export function buildCircularPlinthGeometry(radius, skirtDepth, topY = 0) {
  const baseY = -skirtDepth;
  const height = topY - baseY;

  const wall = new THREE.CylinderGeometry(radius, radius, height, 96, 1, true);
  wall.translate(0, baseY + height * 0.5, 0);

  const bottom = new THREE.CircleGeometry(radius, 96);
  bottom.rotateX(-Math.PI / 2);
  bottom.translate(0, baseY, 0);

  const geo = mergeGeometries([wall, bottom]);
  wall.dispose();
  bottom.dispose();
  return geo;
}
