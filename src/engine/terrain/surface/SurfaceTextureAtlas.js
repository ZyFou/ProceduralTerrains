import * as THREE from 'three';
import { SURFACE_TEXTURE_LAYERS, SURFACE_TEXTURE_ROWS } from './terrainSurfaceTextureGLSL.js';

// Builds the four terrain surface ATLAS textures (diffuse/normal/rough/ao) that
// the terrain shader samples. Each atlas is one column, SURFACE_TEXTURE_ROWS
// rows tall (one material per row, order = SURFACE_TEXTURE_LAYERS). Rows whose
// diffuse image is missing are flagged absent so the shader keeps procedural
// colour there.
//
// Lives in the engine (browser) side but takes a plain resolver so it stays
// decoupled from the React SurfaceLibrary: the caller supplies, per material id
// and map slot, the URL to load (active variant / custom override) plus the
// per-material tiling.

const TILE = 256; // atlas cell size (all sources are drawn/resized to this)
const SLOTS = ['diffuse', 'normalDX', 'roughness', 'ao'];

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function makeAtlasCanvas() {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE * SURFACE_TEXTURE_ROWS;
  return c;
}

function fillRow(ctx, row, img, fallback) {
  const y = row * TILE;
  if (img) {
    ctx.drawImage(img, 0, y, TILE, TILE);
  } else {
    ctx.fillStyle = fallback;
    ctx.fillRect(0, y, TILE, TILE);
  }
}

function makeAtlasTexture(canvas, { srgb }) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;      // U tiles in hardware
  tex.wrapT = THREE.ClampToEdgeWrapping; // V is packed into rows (shader insets)
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;    // no mips -> no cross-row bleed
  tex.generateMipmaps = false;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// resolveUrl(materialId, slot) -> string|null ; tilingFor(materialId) -> number
export async function buildSurfaceAtlas({ resolveUrl, tilingFor }) {
  const canvases = {
    diffuse: makeAtlasCanvas(),
    normalDX: makeAtlasCanvas(),
    roughness: makeAtlasCanvas(),
    ao: makeAtlasCanvas(),
  };
  const ctx = {};
  for (const slot of SLOTS) ctx[slot] = canvases[slot].getContext('2d');

  const present = new Array(SURFACE_TEXTURE_ROWS).fill(0);
  const tile = new Array(SURFACE_TEXTURE_ROWS).fill(12);

  // neutral fallbacks per slot so an empty row is harmless if ever sampled
  const FALLBACK = { diffuse: '#808080', normalDX: '#8080ff', roughness: '#bfbfbf', ao: '#ffffff' };

  await Promise.all(SURFACE_TEXTURE_LAYERS.map(async (materialId, row) => {
    tile[row] = tilingFor(materialId) || 12;
    const imgs = {};
    await Promise.all(SLOTS.map(async (slot) => {
      imgs[slot] = await loadImage(resolveUrl(materialId, slot));
    }));
    // A material counts as "present" when at least its diffuse is available.
    present[row] = imgs.diffuse ? 1 : 0;
    for (const slot of SLOTS) fillRow(ctx[slot], row, imgs[slot], FALLBACK[slot]);
  }));

  return {
    diffuse: makeAtlasTexture(canvases.diffuse, { srgb: true }),
    normal: makeAtlasTexture(canvases.normalDX, { srgb: false }),
    rough: makeAtlasTexture(canvases.roughness, { srgb: false }),
    ao: makeAtlasTexture(canvases.ao, { srgb: false }),
    present,
    tile,
    anyPresent: present.some((v) => v > 0),
  };
}
