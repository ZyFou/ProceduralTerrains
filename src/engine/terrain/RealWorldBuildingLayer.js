import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bboxDimensionsKm, geoPointToCellWorld } from './RealWorldBuildings.js';
import { offsetBbox } from './RealWorldHeightmap.js';

// Retain a safety ceiling for pathological selections, but keep it high enough
// that a dense city and newly expanded neighbor cells do not disappear at the
// old 12k cutoff.
const MAX_RENDERED_BUILDINGS = 50000;

function centroid(points) {
  let x = 0, z = 0;
  for (const point of points) { x += point.x; z += point.z; }
  return { x: x / points.length, z: z / points.length };
}

export class RealWorldBuildingLayer {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'real-world-buildings';
    this.group.renderOrder = 2;
    scene.add(this.group);
    this.material = new THREE.MeshStandardMaterial({
      color: 0xd4c8b4,
      roughness: 0.88,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = null;
    this.count = 0;
  }

  clear() {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.count = 0;
  }

  rebuild({ cells, bbox0, zoom, tiles, cellSize, heightScale, elevationSpan, sampleHeight }) {
    this.clear();
    if (!cells || !bbox0 || !tiles?.length || !Number.isFinite(cellSize)) return 0;
    const dimensions = bboxDimensionsKm(bbox0);
    const horizontalMeters = Math.max(1, ((dimensions.width + dimensions.height) * 0.5) * 1000);
    const horizontalScale = cellSize / horizontalMeters;
    const terrainMeterScale = heightScale / Math.max(1, elevationSpan || 1);
    // Keep buildings legible while preventing nearly-flat elevation bboxes from
    // turning a 10 m house into a terrain-height tower.
    const meterScale = Math.max(horizontalScale * 0.5, Math.min(horizontalScale * 3, terrainMeterScale));
    const geometries = [];
    const renderedIds = new Set();

    for (let tileIndex = 0; tileIndex < tiles.length; tileIndex++) {
      const tile = tiles[tileIndex];
      const key = `${tile.cx},${tile.cz}`;
      const patch = cells[key];
      if (!patch?.buildings?.length) continue;
      const bbox = offsetBbox(bbox0, tile.cx, tile.cz);
      // Reserve a fair share for every remaining terrain tile. This prevents
      // an already-dense center cell from consuming the global safety budget
      // before newly expanded outer cells get a chance to render.
      const remainingTiles = Math.max(1, tiles.length - tileIndex);
      const tileBudget = Math.max(1, Math.floor((MAX_RENDERED_BUILDINGS - geometries.length) / remainingTiles));
      let tileCount = 0;
      for (const building of patch.buildings) {
        if (geometries.length >= MAX_RENDERED_BUILDINGS || tileCount >= tileBudget) break;
        if (renderedIds.has(building.id)) continue;
        renderedIds.add(building.id);
        const worldRing = building.ring.map((point) => geoPointToCellWorld(
          point, bbox, zoom, tile.cx, tile.cz, cellSize,
        ));
        if (worldRing.length < 3) continue;
        const center = centroid(worldRing);
        const shape = new THREE.Shape();
        // Shape Y is -world Z; the final rotation maps extrusion depth to +Y.
        shape.moveTo(worldRing[0].x - center.x, -(worldRing[0].z - center.z));
        for (let i = 1; i < worldRing.length; i++) {
          shape.lineTo(worldRing[i].x - center.x, -(worldRing[i].z - center.z));
        }
        shape.closePath();
        const bottom = Math.max(0, building.minHeight || 0) * meterScale;
        const depth = Math.max(0.35, (building.height - (building.minHeight || 0)) * meterScale);
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth,
          bevelEnabled: false,
          curveSegments: 1,
          steps: 1,
        });
        geometry.rotateX(-Math.PI / 2);
        const ground = Number(sampleHeight?.(center.x, center.z));
        geometry.translate(center.x, (Number.isFinite(ground) ? ground : 0) + bottom + 0.05, center.z);
        geometries.push(geometry);
        tileCount++;
      }
    }

    if (!geometries.length) return 0;
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) return 0;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    this.mesh = new THREE.Mesh(merged, this.material);
    this.mesh.name = 'osm-building-volumes';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.count = geometries.length;
    return this.count;
  }

  dispose() {
    this.clear();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
