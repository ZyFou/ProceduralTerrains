import * as THREE from 'three';

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

function appendQuad(positions, indices, corners, order = [0, 1, 2, 0, 2, 3]) {
  const base = positions.length / 3;
  for (const p of corners) positions.push(p[0], p[1], p[2]);
  for (const i of order) indices.push(base + i);
}

function normalizeCells(cells) {
  const out = [];
  const seen = new Set();
  const src = Array.isArray(cells) && cells.length ? cells : [{ cx: 0, cz: 0 }];
  for (const cell of src) {
    const cx = Math.trunc(Number(cell?.cx));
    const cz = Math.trunc(Number(cell?.cz));
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
    const key = `${cx},${cz}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ cx, cz });
  }
  return out.length ? out : [{ cx: 0, cz: 0 }];
}

// Multi-tile plinth for square assemblies. Unlike one box per tile, this emits
// side walls only where the neighbouring cell is empty, so shared tile edges do
// not create visible dark strips through water or low terrain.
export function buildTileAssemblyPlinthGeometry(cells, cellSize, skirtDepth, topY = 0, outset = OUTSET) {
  const list = normalizeCells(cells);
  const occupied = new Set(list.map((cell) => `${cell.cx},${cell.cz}`));
  const has = (cx, cz) => occupied.has(`${cx},${cz}`);

  const half = cellSize / 2;
  const baseY = -skirtDepth;
  const positions = [];
  const indices = [];

  for (const cell of list) {
    const cx = cell.cx * cellSize;
    const cz = cell.cz * cellSize;

    const exposed = {
      left: !has(cell.cx - 1, cell.cz),
      right: !has(cell.cx + 1, cell.cz),
      bottom: !has(cell.cx, cell.cz - 1),
      top: !has(cell.cx, cell.cz + 1),
    };

    const x0 = cx - half - (exposed.left ? outset : 0);
    const x1 = cx + half + (exposed.right ? outset : 0);
    const z0 = cz - half - (exposed.bottom ? outset : 0);
    const z1 = cz + half + (exposed.top ? outset : 0);

    // Bottom cap under this occupied cell. Adjacent caps share an edge but have
    // no vertical faces between them.
    appendQuad(positions, indices, [
      [x0, baseY, z0],
      [x1, baseY, z0],
      [x1, baseY, z1],
      [x0, baseY, z1],
    ], [0, 3, 2, 0, 2, 1]);

    if (exposed.bottom) {
      appendQuad(positions, indices, [
        [x0, topY, z0],
        [x1, topY, z0],
        [x1, baseY, z0],
        [x0, baseY, z0],
      ]);
    }
    if (exposed.right) {
      appendQuad(positions, indices, [
        [x1, topY, z0],
        [x1, topY, z1],
        [x1, baseY, z1],
        [x1, baseY, z0],
      ]);
    }
    if (exposed.top) {
      appendQuad(positions, indices, [
        [x1, topY, z1],
        [x0, topY, z1],
        [x0, baseY, z1],
        [x1, baseY, z1],
      ]);
    }
    if (exposed.left) {
      appendQuad(positions, indices, [
        [x0, topY, z1],
        [x0, topY, z0],
        [x0, baseY, z0],
        [x0, baseY, z1],
      ]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Circular equivalent of buildBoardPlinthGeometry: just the flat bottom cap at
// the plinth base. The side wall is no longer a fixed-height cylinder — it is
// the dedicated radial wall (buildDiskWallGeometry) rendered with the terrain
// height shader, so its top follows the island/mountain silhouette. There is
// deliberately no top cap (a cap below sea level shows through lakes as a dark
// floor).
export function buildCircularPlinthGeometry(radius, skirtDepth) {
  const baseY = -skirtDepth;
  const bottom = new THREE.CircleGeometry(radius, 96);
  bottom.rotateX(-Math.PI / 2);
  bottom.translate(0, baseY, 0);
  return bottom;
}

// Dedicated circular outer wall for the studio disk assembly. Rendered with the
// SHARED terrain material: each top vertex (aSkirt 0, aWall 1) is displaced to
// the terrain height at that perimeter point by the vertex shader, and each
// base vertex (aSkirt 1, aWall 1) drops to the plinth base. This makes the wall
// top trace the exact generated silhouette instead of a level cylinder rim.
// Positions are world-space (the mesh has an identity transform at the disk
// centre); the shader reads wp.y, so the Y stored here is irrelevant.
export function buildDiskWallGeometry(radius, segments = 256) {
  const segCount = Math.max(16, Math.round(segments));
  const vertCount = (segCount + 1) * 2;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const skirt = new Float32Array(vertCount);
  const wall = new Float32Array(vertCount).fill(1);
  const lod = new Float32Array(vertCount).fill(3);

  for (let i = 0; i <= segCount; i++) {
    const a = (i / segCount) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    const top = i * 2;
    const bot = top + 1;
    positions[top * 3] = x; positions[top * 3 + 2] = z;     // top ring (terrain)
    positions[bot * 3] = x; positions[bot * 3 + 2] = z;     // base ring (plinth)
    uvs[top * 2] = i / segCount; uvs[top * 2 + 1] = 1;
    uvs[bot * 2] = i / segCount; uvs[bot * 2 + 1] = 0;
    skirt[top] = 0;
    skirt[bot] = 1;
  }

  const indices = [];
  for (let i = 0; i < segCount; i++) {
    const t0 = i * 2, b0 = t0 + 1, t1 = (i + 1) * 2, b1 = t1 + 1;
    indices.push(t0, b0, t1, t1, b0, b1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aSkirt', new THREE.BufferAttribute(skirt, 1));
  geo.setAttribute('aWall', new THREE.BufferAttribute(wall, 1));
  geo.setAttribute('aLod', new THREE.BufferAttribute(lod, 1));
  geo.setIndex(indices);
  return geo;
}
