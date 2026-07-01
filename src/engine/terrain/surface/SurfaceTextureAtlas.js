import * as THREE from 'three';
import { SURFACE_TEXTURE_LAYERS, SURFACE_TEXTURE_ROWS } from './terrainSurfaceTextureGLSL.js';

// Builds the four terrain surface ATLAS textures (diffuse/normal/rough/ao) that
// the terrain shader samples. Each atlas is one column, SURFACE_TEXTURE_ROWS
// rows tall (one material per row, order = SURFACE_TEXTURE_LAYERS). Missing
// diffuse rows are still renderable: the diffuse atlas gets a diagnostic
// checker pattern so texture modes never silently fall back to procedural color.
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

function fillMissingDiffuseRow(ctx, row, materialId) {
  const y = row * TILE;
  const cell = 32;
  for (let py = 0; py < TILE; py += cell) {
    for (let px = 0; px < TILE; px += cell) {
      const odd = ((px / cell) + (py / cell)) % 2 === 1;
      ctx.fillStyle = odd ? '#ff00cc' : '#111827';
      ctx.fillRect(px, y + py, cell, cell);
    }
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MISSING', TILE / 2, y + TILE / 2 - 14);
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(materialId.toUpperCase(), TILE / 2, y + TILE / 2 + 16);
}

function fillRow(ctx, row, img, fallback, { missingDiffuse = false, materialId = '' } = {}) {
  const y = row * TILE;
  if (img) {
    ctx.drawImage(img, 0, y, TILE, TILE);
  } else if (missingDiffuse) {
    fillMissingDiffuseRow(ctx, row, materialId);
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
export async function buildSurfaceAtlas({ source, resolveUrl, tilingFor, labelFor }) {
  const canvases = {
    diffuse: makeAtlasCanvas(),
    normalDX: makeAtlasCanvas(),
    roughness: makeAtlasCanvas(),
    ao: makeAtlasCanvas(),
  };
  const ctx = {};
  for (const slot of SLOTS) ctx[slot] = canvases[slot].getContext('2d');

  const present = new Array(SURFACE_TEXTURE_ROWS).fill(1);
  const tile = new Array(SURFACE_TEXTURE_ROWS).fill(12);
  const layers = new Array(SURFACE_TEXTURE_ROWS);

  // neutral fallbacks per slot so an empty row is harmless if ever sampled
  const FALLBACK = { diffuse: '#808080', normalDX: '#8080ff', roughness: '#bfbfbf', ao: '#ffffff' };

  await Promise.all(SURFACE_TEXTURE_LAYERS.map(async (materialId, row) => {
    tile[row] = tilingFor(materialId) || 12;
    const imgs = {};
    await Promise.all(SLOTS.map(async (slot) => {
      imgs[slot] = await loadImage(resolveUrl(materialId, slot));
    }));
    const missingSlots = SLOTS.filter((slot) => !imgs[slot]);
    const missingOptionalSlots = missingSlots.filter((slot) => slot !== 'diffuse');
    const hasDiffuse = !!imgs.diffuse;
    const status = !hasDiffuse ? 'missingDiffuse' : missingOptionalSlots.length ? 'missingOptional' : 'ready';
    layers[row] = {
      id: materialId,
      name: labelFor?.(materialId) ?? materialId,
      row,
      status,
      hasDiffuse,
      missingSlots,
      missingOptionalSlots,
    };
    for (const slot of SLOTS) {
      fillRow(ctx[slot], row, imgs[slot], FALLBACK[slot], {
        missingDiffuse: slot === 'diffuse' && !hasDiffuse,
        materialId,
      });
    }
  }));

  const diffuseReady = layers.filter((layer) => layer.hasDiffuse).length;
  const fullyReady = layers.filter((layer) => layer.status === 'ready').length;
  const missingDiffuse = layers.filter((layer) => layer.status === 'missingDiffuse').length;
  const missingOptional = layers.filter((layer) => layer.status === 'missingOptional').length;

  return {
    source,
    diffuse: makeAtlasTexture(canvases.diffuse, { srgb: true }),
    normal: makeAtlasTexture(canvases.normalDX, { srgb: false }),
    rough: makeAtlasTexture(canvases.roughness, { srgb: false }),
    ao: makeAtlasTexture(canvases.ao, { srgb: false }),
    present,
    tile,
    rows: SURFACE_TEXTURE_LAYERS.slice(),
    layers,
    coverage: {
      total: SURFACE_TEXTURE_ROWS,
      diffuseReady,
      fullyReady,
      missingDiffuse,
      missingOptional,
    },
    bakedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    anyPresent: diffuseReady > 0,
    complete: fullyReady === SURFACE_TEXTURE_ROWS,
  };
}
