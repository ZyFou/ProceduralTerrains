import * as THREE from 'three';
import {
  SURFACE_TEXTURE_ROLES,
  SURFACE_TEXTURE_ROLE_COUNT,
  SURFACE_TEXTURE_ROWS,
  SURFACE_TEXTURE_VARIANT_COUNT,
  surfaceAtlasRow,
} from './SurfaceTextureRoles.js';

// Builds the four terrain surface ATLAS textures (diffuse/normal/rough/ao).
// The atlas is a vertical strip of role variants:
//   row = roleIndex * SURFACE_TEXTURE_VARIANT_COUNT + variantIndex.
// Missing diffuse rows are diagnostic checker rows so Custom Materials never
// fall back to procedural color silently.

const BASE_TILE = 256;
const MIN_TILE = 64;
const SAFE_MAX_ATLAS_SIZE = 8192;
const SLOTS = ['diffuse', 'normalDX', 'roughness', 'ao'];

function atlasTileSize(rowCount) {
  let tile = BASE_TILE;
  while (tile * rowCount > SAFE_MAX_ATLAS_SIZE && tile > MIN_TILE) tile /= 2;
  return tile;
}

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

function makeAtlasCanvas(tile) {
  const c = document.createElement('canvas');
  c.width = tile;
  c.height = tile * SURFACE_TEXTURE_ROWS;
  return c;
}

function fillMissingDiffuseRow(ctx, row, tile, materialId, variantIndex) {
  const y = row * tile;
  const cell = Math.max(16, Math.floor(tile / 8));
  for (let py = 0; py < tile; py += cell) {
    for (let px = 0; px < tile; px += cell) {
      const odd = ((px / cell) + (py / cell)) % 2 === 1;
      ctx.fillStyle = odd ? '#ff00cc' : '#111827';
      ctx.fillRect(px, y + py, cell, cell);
    }
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.font = `bold ${Math.max(12, Math.floor(tile * 0.085))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MISSING', tile / 2, y + tile / 2 - tile * 0.06);
  ctx.font = `bold ${Math.max(10, Math.floor(tile * 0.065))}px sans-serif`;
  ctx.fillText(`${materialId.toUpperCase()} V${variantIndex + 1}`, tile / 2, y + tile / 2 + tile * 0.08);
}

function fillRow(ctx, row, tile, img, fallback, { missingDiffuse = false, materialId = '', variantIndex = 0 } = {}) {
  const y = row * tile;
  if (img) {
    ctx.drawImage(img, 0, y, tile, tile);
  } else if (missingDiffuse) {
    fillMissingDiffuseRow(ctx, row, tile, materialId, variantIndex);
  } else {
    ctx.fillStyle = fallback;
    ctx.fillRect(0, y, tile, tile);
  }
}

function cellHash(x, y, salt) {
  const s = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

function drawImageCoverCell(ctx, img, x, y, w, h, salt) {
  const rot = Math.floor(cellHash(x, y, salt + 1) * 4);
  const mirrorX = cellHash(x, y, salt + 2) < 0.5 ? -1 : 1;
  const mirrorY = cellHash(x, y, salt + 3) < 0.5 ? -1 : 1;
  const scale = 1.12 + cellHash(x, y, salt + 4) * 0.26;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x + w * 0.5, y + h * 0.5);
  ctx.rotate(rot * Math.PI * 0.5);
  ctx.scale(mirrorX * scale, mirrorY * scale);
  ctx.drawImage(img, -w * 0.58, -h * 0.58, w * 1.16, h * 1.16);
  ctx.restore();
}

function bakeVariantMosaicRow(ctx, row, tile, readyVariantImages, slot, fallback, salt) {
  const y = row * tile;
  const cells = 4;
  const cell = tile / cells;
  ctx.fillStyle = fallback;
  ctx.fillRect(0, y, tile, tile);
  for (let cy = 0; cy < cells; cy += 1) {
    for (let cx = 0; cx < cells; cx += 1) {
      const pick = Math.floor(cellHash(cx, cy, salt) * readyVariantImages.length) % readyVariantImages.length;
      const img = readyVariantImages[pick]?.[slot];
      const x = cx * cell;
      const yy = y + cy * cell;
      if (img) {
        drawImageCoverCell(ctx, img, x, yy, cell, cell, salt + pick * 9.13);
      } else {
        ctx.fillStyle = fallback;
        ctx.fillRect(x, yy, cell, cell);
      }
    }
  }
}

function makeAtlasTexture(canvas, { srgb }) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// resolveUrl(materialId, slot, variantIndex) -> string|null
// tilingFor(materialId) -> number
export async function buildSurfaceAtlas({ source, resolveUrl, tilingFor, labelFor }) {
  const tileSize = atlasTileSize(SURFACE_TEXTURE_ROWS);
  const canvases = {
    diffuse: makeAtlasCanvas(tileSize),
    normalDX: makeAtlasCanvas(tileSize),
    roughness: makeAtlasCanvas(tileSize),
    ao: makeAtlasCanvas(tileSize),
  };
  const ctx = {};
  for (const slot of SLOTS) ctx[slot] = canvases[slot].getContext('2d');

  const present = new Array(SURFACE_TEXTURE_ROWS).fill(0);
  const tile = new Array(SURFACE_TEXTURE_ROLE_COUNT).fill(12);
  const layers = new Array(SURFACE_TEXTURE_ROLE_COUNT);
  const FALLBACK = { diffuse: '#808080', normalDX: '#8080ff', roughness: '#bfbfbf', ao: '#ffffff' };

  await Promise.all(SURFACE_TEXTURE_ROLES.map(async (role, roleIndex) => {
    tile[roleIndex] = tilingFor(role.id) || role.tiling || 12;
    const variants = new Array(SURFACE_TEXTURE_VARIANT_COUNT);
    const variantImages = new Array(SURFACE_TEXTURE_VARIANT_COUNT);

    await Promise.all(Array.from({ length: SURFACE_TEXTURE_VARIANT_COUNT }, async (_, variantIndex) => {
      const row = surfaceAtlasRow(roleIndex, variantIndex);
      const imgs = {};
      await Promise.all(SLOTS.map(async (slot) => {
        imgs[slot] = await loadImage(resolveUrl(role.id, slot, variantIndex));
      }));
      variantImages[variantIndex] = imgs;
      const missingSlots = SLOTS.filter((slot) => !imgs[slot]);
      const missingOptionalSlots = missingSlots.filter((slot) => slot !== 'diffuse');
      const hasDiffuse = !!imgs.diffuse;
      const status = !hasDiffuse ? 'missingDiffuse' : missingOptionalSlots.length ? 'missingOptional' : 'ready';
      present[row] = hasDiffuse ? 1 : 0;
      variants[variantIndex] = {
        index: variantIndex,
        row,
        status,
        hasDiffuse,
        missingSlots,
        missingOptionalSlots,
      };
      for (const slot of SLOTS) {
        fillRow(ctx[slot], row, tileSize, imgs[slot], FALLBACK[slot], {
          missingDiffuse: slot === 'diffuse' && !hasDiffuse,
          materialId: role.id,
          variantIndex,
        });
      }
    }));

    // The shader samples row 0 for each role. Fold uploaded variants into that
    // render row so the GLSL stays stable while variants still contribute.
    const renderVariantIndex = variants.findIndex((variant) => variant.hasDiffuse);
    const readyVariantImages = variants
      .filter((variant) => variant.hasDiffuse)
      .map((variant) => variantImages[variant.index]);
    if (readyVariantImages.length > 1) {
      const renderRow = surfaceAtlasRow(roleIndex, 0);
      for (const slot of SLOTS) {
        bakeVariantMosaicRow(
          ctx[slot],
          renderRow,
          tileSize,
          readyVariantImages,
          slot,
          FALLBACK[slot],
          roleIndex * 17.31 + slot.length * 5.7
        );
      }
      present[renderRow] = 1;
    } else if (renderVariantIndex > 0) {
      const renderRow = surfaceAtlasRow(roleIndex, 0);
      const imgs = variantImages[renderVariantIndex] || {};
      for (const slot of SLOTS) {
        fillRow(ctx[slot], renderRow, tileSize, imgs[slot], FALLBACK[slot], {
          missingDiffuse: false,
          materialId: role.id,
          variantIndex: renderVariantIndex,
        });
      }
      present[renderRow] = 1;
    }

    const readyVariants = variants.filter((variant) => variant.hasDiffuse).length;
    const completeVariants = variants.filter((variant) => variant.status === 'ready').length;
    const missingOptionalSlots = [...new Set(variants.flatMap((variant) => (
      variant.hasDiffuse ? variant.missingOptionalSlots : []
    )))];
    const status = readyVariants === 0
      ? 'missingDiffuse'
      : missingOptionalSlots.length
        ? 'missingOptional'
        : 'ready';
    layers[roleIndex] = {
      id: role.id,
      name: labelFor?.(role.id) ?? role.label ?? role.id,
      groupId: role.groupId,
      groupLabel: role.groupLabel,
      row: surfaceAtlasRow(roleIndex, 0),
      roleIndex,
      status,
      hasDiffuse: readyVariants > 0,
      readyVariants,
      completeVariants,
      variantCount: SURFACE_TEXTURE_VARIANT_COUNT,
      missingSlots: status === 'missingDiffuse' ? ['diffuse'] : [],
      missingOptionalSlots,
      variants,
    };
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
    rolePresent: layers.map((layer) => (layer.hasDiffuse ? 1 : 0)),
    tile,
    atlasTileSize: tileSize,
    variantCount: SURFACE_TEXTURE_VARIANT_COUNT,
    rows: SURFACE_TEXTURE_ROLES.map((role) => role.id),
    layers,
    coverage: {
      total: SURFACE_TEXTURE_ROLE_COUNT,
      diffuseReady,
      fullyReady,
      missingDiffuse,
      missingOptional,
    },
    bakedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    anyPresent: diffuseReady > 0,
    complete: fullyReady === SURFACE_TEXTURE_ROLE_COUNT,
  };
}
