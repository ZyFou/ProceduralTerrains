import * as THREE from 'three';

// ============================================================================
// One chunk geometry = a unit grid in local space ([0,1] on X/Z, Y handled
// entirely in the vertex shader) plus a duplicated border ring ("skirt").
// The shader drops skirt vertices down by uSkirtDepth, which hides any
// T-junction cracks between neighbouring chunks at different LOD levels.
// Geometries are shared: every chunk currently at LOD n uses the same one.
// ============================================================================

export function buildChunkGeometry(res, lodIndex) {
  const vps = res + 1;                  // vertices per side
  const gridCount = vps * vps;

  // border ring vertex indices, walked clockwise around the perimeter
  const ring = [];
  for (let x = 0; x < res; x++) ring.push(x);                       // top row →
  for (let z = 0; z < res; z++) ring.push(z * vps + res);           // right col ↓
  for (let x = res; x > 0; x--) ring.push(res * vps + x);           // bottom row ←
  for (let z = res; z > 0; z--) ring.push(z * vps);                 // left col ↑
  const ringCount = ring.length;        // 4 * res

  const total = gridCount + ringCount;
  const positions = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  const skirt = new Float32Array(total);          // 0 = surface, 1 = skirt
  const lod = new Float32Array(total).fill(lodIndex);

  let i = 0;
  for (let z = 0; z < vps; z++) {
    for (let x = 0; x < vps; x++) {
      positions[i * 3 + 0] = x / res;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = z / res;
      uvs[i * 2 + 0] = x / res;
      uvs[i * 2 + 1] = z / res;
      i++;
    }
  }
  // skirt vertices: same XZ as the border vertex they duplicate
  for (let k = 0; k < ringCount; k++) {
    const src = ring[k];
    const dst = gridCount + k;
    positions[dst * 3 + 0] = positions[src * 3 + 0];
    positions[dst * 3 + 1] = 0;
    positions[dst * 3 + 2] = positions[src * 3 + 2];
    uvs[dst * 2 + 0] = uvs[src * 2 + 0];
    uvs[dst * 2 + 1] = uvs[src * 2 + 1];
    skirt[dst] = 1;
  }

  const indices = [];
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const a = z * vps + x;
      const b = a + 1;
      const c = a + vps;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  // skirt wall quads between each border vertex and its dropped duplicate
  for (let k = 0; k < ringCount; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ringCount];
    const a2 = gridCount + k;
    const b2 = gridCount + ((k + 1) % ringCount);
    indices.push(a, a2, b, b, a2, b2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aSkirt', new THREE.BufferAttribute(skirt, 1));
  geo.setAttribute('aLod', new THREE.BufferAttribute(lod, 1));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  return geo;
}

// Bounding sphere covering the displaced chunk so three.js frustum culling
// stays correct. Local space: XZ in [0,1], Y in [-skirt, maxHeight] before
// the uniform chunk-size scale is applied by the mesh's world matrix.
export function setChunkBounds(geometry, chunkSize, maxHeight, skirtDepth) {
  const yMaxL = maxHeight / chunkSize;
  const yMinL = -skirtDepth / chunkSize;
  const cy = (yMaxL + yMinL) / 2;
  const radius = Math.hypot(0.5, 0.5, (yMaxL - yMinL) / 2) * 1.05;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, cy, 0.5), radius);
}
