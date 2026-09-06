import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { detectSlotFromFilename } from '../src/engine/terrain/surface/SurfaceTextureDetector.js';
import { collectSurfaceTextureSets, planSurfaceTextureImport } from '../src/engine/terrain/surface/SurfaceTextureImport.js';
import { captureSurfaceAtlasMaps, buildAndInstallSurfaceAtlas } from '../src/engine/terrain/surface/SurfaceAtlasBridge.js';
import { buildSurfaceAtlas } from '../src/engine/terrain/surface/SurfaceTextureAtlas.js';
import { SURFACE_TEXTURE_ROLES, surfaceAtlasRow } from '../src/engine/terrain/surface/SurfaceTextureRoles.js';

const source = 'customTextures';
const slots = ['diffuse', 'normalDX', 'roughness', 'ao'];
const entry = (name, scope = '') => ({ name, scope, blob: new Blob([name]) });
const savedGlobals = new Map();
const urls = [];
function replaceGlobal(key, value) {
  if (!savedGlobals.has(key)) savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterEach(() => {
  for (const [key, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  savedGlobals.clear();
  for (const url of urls.splice(0)) URL.revokeObjectURL(url);
});

function blobUrl(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/png' }));
  urls.push(url);
  return url;
}

class CanvasContext {
  constructor(canvas) { this.canvas = canvas; this.draws = []; this.labels = []; }
  drawImage(image, ...args) { this.draws.push({ image, args }); }
  fillRect() {}
  fillText(text) { this.labels.push(text); }
  save() {}
  restore() {}
  beginPath() {}
  rect() {}
  clip() {}
  translate() {}
  scale() {}
  getImageData(_x, _y, width, height) { return this.createImageData(width, height); }
  createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; }
  putImageData() {}
}
class Canvas {
  constructor(width = 1, height = 1) {
    this.width = width;
    this.height = height;
    this.context = new CanvasContext(this);
    Canvas.instances.push(this);
  }
  getContext() { return this.context; }
}
Canvas.instances = [];

function workerCanvasEnvironment() {
  Canvas.instances = [];
  const decoded = [];
  replaceGlobal('Image', undefined);
  replaceGlobal('document', undefined);
  replaceGlobal('OffscreenCanvas', Canvas);
  replaceGlobal('createImageBitmap', async (blob) => {
    const tag = await blob.text();
    if (tag === 'corrupt') throw new Error('Invalid image');
    const image = { tag, closed: false, close() { this.closed = true; } };
    decoded.push(image);
    return image;
  });
  return decoded;
}
const bake = (resolveUrl) => buildSurfaceAtlas({ source, resolveUrl, tilingFor: () => 12 });

// The import planner is deliberately independent of ZIP decoding and React.
describe('custom texture import regression', () => {
  it('recognizes common underscore, hyphen, camel-case and legacy pack labels', () => {
    for (const [name, slot] of [
      ['grass_Color.png', 'diffuse'], ['grass_BaseColor.jpg', 'diffuse'],
      ['grass_Albedo.png', 'diffuse'], ['grass_diff_1k.jpg', 'diffuse'],
      ['grass_Normal.png', 'normalDX'], ['grass_NormalDX.png', 'normalDX'],
      ['grass_nor_dx_1k.jpg', 'normalDX'], ['grass_NRM.png', 'normalDX'],
      ['grass_Rough.png', 'roughness'], ['grass_Roughness.png', 'roughness'],
      ['grass_AO.png', 'ao'], ['grass_AmbientOcclusion.png', 'ao'],
      ['grass_Height.png', 'displacement'],
    ]) assert.equal(detectSlotFromFilename(name), slot, name);
  });

  it('ignores map words in directories and does not relabel OpenGL normals as DX', () => {
    assert.equal(detectSlotFromFilename('normal/roughness/grass_Color.png'), 'diffuse');
    assert.equal(detectSlotFromFilename('C:\\roughness\\grass_AO.png'), 'ao');
    assert.equal(detectSlotFromFilename('grass_NormalGL.png'), null);
    assert.equal(detectSlotFromFilename('grass_nor_gl.png'), null);
    assert.equal(detectSlotFromFilename('grass.png'), null);
  });

  it('groups maps at ZIP root and in nested variant folders without a textures/ requirement', () => {
    const result = collectSurfaceTextureSets([
      entry('grass_Color.png'), entry('grass_NormalDX.png'), entry('grass_AO.png'),
      entry('pack/variant2/grass_Color.png'), entry('pack/variant2/grass_Roughness.png'),
    ], slots);
    assert.equal(result.sets.length, 2);
    assert.deepEqual([...result.sets[0].maps.keys()], ['diffuse', 'normalDX', 'ao']);
    assert.deepEqual([...result.sets[1].maps.keys()], ['diffuse', 'roughness']);
    assert.deepEqual(result.unmatched, []);
  });

  it('keeps separate archive scopes and explicit filename variants separate', () => {
    const result = collectSurfaceTextureSets([
      entry('grass_diff_1k.png', 'first.zip'), entry('grass_nor_dx_2k.png', 'first.zip'),
      entry('grass_diff_1k.png', 'second.zip'), entry('grass_v2_diff_1k.png', 'first.zip'),
    ], slots);
    assert.equal(result.sets.length, 3);
    assert.equal(result.sets[0].maps.size, 2);
  });

  it('reports duplicate/unsupported maps and ignores archive metadata', () => {
    const result = collectSurfaceTextureSets([
      entry('__MACOSX/._grass_Color.png'), entry('.hidden/grass_Color.png'),
      entry('grass_Color.png'), entry('grass_diff_2k.png'),
      entry('grass_NormalGL.png'), entry('grass_Height.exr'), entry('README.txt'),
    ], slots);
    assert.equal(result.sets.length, 1);
    assert.equal(result.sets[0].maps.size, 1);
    assert.equal(result.unmatched.length, 3);
    assert.match(result.unmatched[0], /duplicate/);
  });

  it('fills empty variants without overwriting other uploads, including optional-only variants', () => {
    const { sets } = collectSurfaceTextureSets(['a', 'b', 'c'].map((s) => entry(`${s}_Color.png`)), slots);
    const plan = planSurfaceTextureImport(sets, 2, (i) => i === 1 || i === 3);
    assert.deepEqual(plan.assignments.map((a) => a.variantIndex), [2, 1, 3]);
    assert.deepEqual(plan.unmatched, []);
  });

  it('reports overflow instead of dropping variants silently or wrapping to V1', () => {
    const { sets } = collectSurfaceTextureSets(['a', 'b', 'c', 'd', 'e'].map((s) => entry(`${s}_Color.png`)), slots);
    const plan = planSurfaceTextureImport(sets, 0, () => true);
    assert.deepEqual(plan.assignments.map((a) => a.variantIndex), [0, 1, 2, 3]);
    assert.equal(plan.unmatched.length, 1);
    assert.match(plan.unmatched[0], /no empty variant/);
  });
});

describe('UI to render-worker surface snapshot', () => {
  it('sends all populated roles/variants as cloneable Blobs that outlive UI URLs', async () => {
    const url = blobUrl('custom pixels');
    const maps = await captureSurfaceAtlasMaps(source, {
      resolveUrl: (role, slot, variant) => role === 'grass' && slot === 'diffuse' && variant === 2 ? url : null,
    });
    URL.revokeObjectURL(url);
    const copied = structuredClone(maps);
    assert.equal(await copied.grass[2].diffuse.text(), 'custom pixels');
    assert.deepEqual(copied.grass[0], {});
    assert.deepEqual(copied.sand[2], {});
    assert.equal(Object.keys(copied).length, 13);
  });

  it('deduplicates reads of shared upload URLs', async () => {
    const originalFetch = globalThis.fetch;
    let reads = 0;
    replaceGlobal('fetch', (...args) => { reads += 1; return originalFetch(...args); });
    const url = blobUrl('shared');
    const maps = await captureSurfaceAtlasMaps(source, {
      resolveUrl: (role, slot) => role === 'grass' && slot === 'diffuse' ? url : null,
    });
    assert.equal(reads, 1);
    assert.equal(maps.grass[0].diffuse, maps.grass[3].diffuse);
  });

  it('represents removal as an explicit empty snapshot, not a renderer-local fallback', async () => {
    const maps = await captureSurfaceAtlasMaps(source, { resolveUrl: () => null });
    assert.equal(Object.values(maps).flat().every((variant) => !Object.keys(variant).length), true);
    assert.equal(await captureSurfaceAtlasMaps('builtInTextures'), null);
    assert.equal(await captureSurfaceAtlasMaps('procedural'), null);
  });

  it('reports the failing role/variant/map instead of sending a broken snapshot', async () => {
    await assert.rejects(captureSurfaceAtlasMaps(source, {
      resolveUrl: (role, slot, variant) => role === 'grass' && slot === 'ao' && variant === 1 ? 'blob:missing-texture' : null,
    }), /Grass V2 ao/);
  });

  it('honors cancellation while capturing files', async () => {
    const controller = new AbortController();
    controller.abort();
    const url = blobUrl('cancelled');
    await assert.rejects(captureSurfaceAtlasMaps(source, {
      signal: controller.signal,
      resolveUrl: (role, slot, variant) => role === 'grass' && slot === 'diffuse' && variant === 0 ? url : null,
    }), { name: 'AbortError' });
  });

  it('installs renderer-owned textures and returns only UI metadata', async () => {
    const maps = { grass: [{ diffuse: new Blob(['pixels']) }] };
    const atlas = { anyPresent: true, coverage: { diffuseReady: 1 }, layers: [], bakedAt: 123, diffuse: {}, props: {} };
    let installed;
    const result = await buildAndInstallSurfaceAtlas({ setSurfaceAtlas: (...args) => { installed = args; } }, source, maps, {
      buildAtlas: async (options) => { assert.equal(options.customMaps, maps); return atlas; },
    });
    assert.deepEqual(installed, [atlas, source]);
    assert.equal(result.anyPresent, true);
    assert.equal(result.source, source);
    assert.equal('diffuse' in result, false);
    assert.equal('props' in result, false);
    assert.deepEqual(structuredClone(result), result);
  });

  it('does not start an already superseded bake', async () => {
    let builds = 0;
    await assert.rejects(buildAndInstallSurfaceAtlas({}, source, {}, {
      isCurrent: () => false, buildAtlas: async () => { builds += 1; },
    }), { code: 'SURFACE_ATLAS_SUPERSEDED' });
    assert.equal(builds, 0);
  });

  it('disposes stale results instead of installing them over newer uploads', async () => {
    let checks = 0;
    let disposed = 0;
    let installs = 0;
    await assert.rejects(buildAndInstallSurfaceAtlas({ setSurfaceAtlas: () => { installs += 1; } }, source, {}, {
      isCurrent: () => ++checks === 1,
      buildAtlas: async () => ({ diffuse: { dispose: () => { disposed += 1; } }, props: { dispose: () => { disposed += 1; } } }),
    }), { code: 'SURFACE_ATLAS_SUPERSEDED' });
    assert.equal(disposed, 2);
    assert.equal(installs, 0);
  });
});

describe('surface atlas worker image decoding and sparse variants', () => {
  it('bakes a single non-first variant without Image or document and closes its bitmap', async () => {
    const decoded = workerCanvasEnvironment();
    const atlas = await bake((role, slot, variant) => role === 'grass' && slot === 'diffuse' && variant === 2 ? new Blob(['grass-v3']) : null);
    const layer = atlas.layers.find((item) => item.id === 'grass');
    assert.equal(layer.readyVariants, 1);
    assert.equal(layer.variants[2].hasDiffuse, true);
    assert.equal(layer.status, 'missingOptional');
    assert.equal(atlas.coverage.diffuseReady, 1);
    const row = surfaceAtlasRow(SURFACE_TEXTURE_ROLES.findIndex((role) => role.id === 'grass'), 0);
    assert.equal(atlas.present[row], 1);
    assert.equal(atlas.diffuse.image.context.draws.some((draw) => draw.image.tag === 'grass-v3' && draw.args[1] === row * atlas.atlasTileSize), true);
    assert.equal(decoded.length, 1);
    assert.equal(decoded[0].closed, true);
    assert.equal(atlas.diffuse.flipY, false);
  });

  it('accepts one diffuse per role; missing extra variants and optional maps do not block rendering', async () => {
    workerCanvasEnvironment();
    const atlas = await bake((role, slot, variant) => slot === 'diffuse' && variant === 0 ? new Blob([role]) : null);
    assert.equal(atlas.coverage.diffuseReady, 13);
    assert.equal(atlas.coverage.missingDiffuse, 0);
    assert.equal(atlas.anyPresent, true);
    assert.equal(atlas.layers.every((layer) => layer.readyVariants === 1), true);
  });

  it('keeps the same variant/crop layout in diffuse, normal, roughness and AO mosaic rows', async () => {
    const decoded = workerCanvasEnvironment();
    await bake((role, slot, variant) => role === 'grass' && (variant === 0 || variant === 2) ? new Blob([`${variant}:${slot}`]) : null);
    const layouts = Canvas.instances.slice(0, 4).map((canvas) =>
      canvas.context.draws.slice(-16).map((draw) => `${draw.image.tag.split(':')[0]}:${draw.args.join(',')}`)
    );
    assert.equal(layouts[0].length, 16);
    for (const layout of layouts.slice(1)) assert.deepEqual(layout, layouts[0]);
    assert.equal(decoded.every((image) => image.closed), true);
  });

  it('marks a corrupt uploaded diffuse as missing instead of claiming it was baked', async () => {
    workerCanvasEnvironment();
    const atlas = await bake((role, slot, variant) => role === 'grass' && slot === 'diffuse' && variant === 0 ? new Blob(['corrupt']) : null);
    assert.equal(atlas.anyPresent, false);
    assert.equal(atlas.layers.find((layer) => layer.id === 'grass').status, 'missingDiffuse');
  });

  it('loads built-in URL images in the worker too', async () => {
    workerCanvasEnvironment();
    const url = blobUrl('builtin');
    const atlas = await bake((role, slot, variant) => role === 'sand' && slot === 'diffuse' && variant === 0 ? url : null);
    assert.equal(atlas.coverage.diffuseReady, 1);
  });

  it('preserves the main-thread Image/canvas path', async () => {
    Canvas.instances = [];
    replaceGlobal('Image', class {
      set src(value) { this.tag = value; queueMicrotask(() => this.onload()); }
    });
    replaceGlobal('document', { createElement: () => new Canvas() });
    replaceGlobal('createImageBitmap', () => { throw new Error('Must use Image on the main thread'); });
    const atlas = await bake((role, slot, variant) => role === 'grass' && slot === 'diffuse' && variant === 0 ? 'grass.png' : null);
    assert.equal(atlas.anyPresent, true);
    assert.equal(atlas.coverage.diffuseReady, 1);
  });

  it('produces an actionable error when a 2D context cannot be created', async () => {
    workerCanvasEnvironment();
    replaceGlobal('OffscreenCanvas', class { getContext() { return null; } });
    await assert.rejects(bake(() => null), /could not create a 2D canvas/);
  });
});
