import * as THREE from 'three';
import {
  SURFACE_TEXTURE_ROLES,
  SURFACE_TEXTURE_ROLE_COUNT,
  SURFACE_TEXTURE_ROWS,
  SURFACE_TEXTURE_VARIANT_COUNT,
  surfaceAtlasRow,
} from './SurfaceTextureRoles.js';

// Builds two terrain surface atlas textures: sRGB diffuse plus packed linear
// properties (normal XY, roughness, AO). Packing stays within 16 texture units.
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

async function loadImage(input) {
  if (!input) return null;
  // Image is a Window API. The render worker receives Blobs from the UI;
  // built-in assets still arrive as URLs and use the same worker decoder.
  if (typeof Image === 'undefined') {
    if (typeof createImageBitmap !== 'function') throw new Error('Surface baking requires an image decoder.');
    try {
      let blob = input;
      if (!(input instanceof Blob)) {
        const response = await fetch(input);
        if (!response.ok || (response.headers.get('content-type') || '').includes('text/html')) return null;
        blob = await response.blob();
      }
      return await createImageBitmap(blob);
    } catch {
      return null; // Keep per-map missing/optional diagnostics on decode failure.
    }
  }
  return new Promise((resolve) => {
    const objectUrl = input instanceof Blob ? URL.createObjectURL(input) : null;
    const img = new Image();
    const finish = (result) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(result);
    };
    img.crossOrigin = 'anonymous';
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src = objectUrl || input;
  });
}

function makeCanvas(width, height) {
  const c = typeof Image === 'undefined' && typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : document.createElement('canvas');
  c.width = width;
  c.height = height;
  if (!c.getContext('2d')) throw new Error('Surface baking could not create a 2D canvas.');
  return c;
}

function makeAtlasCanvas(tile) {
  return makeCanvas(tile, tile * SURFACE_TEXTURE_ROWS);
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
  // Preserve tangent-space normal directions: crop/scale every map together
  // instead of rotating or mirroring pixels without transforming normal XY.
  const scale = 1.12 + cellHash(x, y, salt + 4) * 0.26;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x + w * 0.5, y + h * 0.5);
  ctx.scale(scale, scale);
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
  // Atlas row zero is addressed at v=0 in GLSL and is the canvas top row.
  // Disable Three's default source flip so painted role indices stay aligned.
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function packPropertiesCanvas(canvases) {
  const packed = makeCanvas(canvases.normalDX.width, canvases.normalDX.height);
  const packedCtx = packed.getContext('2d');
  const normal = canvases.normalDX.getContext('2d').getImageData(0, 0, packed.width, packed.height).data;
  const roughness = canvases.roughness.getContext('2d').getImageData(0, 0, packed.width, packed.height).data;
  const ao = canvases.ao.getContext('2d').getImageData(0, 0, packed.width, packed.height).data;
  const output = packedCtx.createImageData(packed.width, packed.height);
  for (let index = 0; index < output.data.length; index += 4) {
    output.data[index] = normal[index];
    output.data[index + 1] = normal[index + 1];
    output.data[index + 2] = roughness[index];
    output.data[index + 3] = ao[index];
  }
  packedCtx.putImageData(output, 0, 0);
  return packed;
}

// resolveUrl(materialId, slot, variantIndex) -> string|Blob|null
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

    try {
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
            roleIndex * 17.31 // One layout for diffuse, normals, roughness and AO.
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
    } finally {
      for (const images of variantImages) {
        for (const image of Object.values(images || {})) image?.close?.();
      }
    }
  }));

  const diffuseReady = layers.filter((layer) => layer.hasDiffuse).length;
  const fullyReady = layers.filter((layer) => layer.status === 'ready').length;
  const missingDiffuse = layers.filter((layer) => layer.status === 'missingDiffuse').length;
  const missingOptional = layers.filter((layer) => layer.status === 'missingOptional').length;
  const properties = packPropertiesCanvas(canvases);

  return {
    source,
    diffuse: makeAtlasTexture(canvases.diffuse, { srgb: true }),
    props: makeAtlasTexture(properties, { srgb: false }),
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
