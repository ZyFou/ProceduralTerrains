import { describe, expect, it } from 'vitest';
import { createProceduralSkyUniforms } from '../src/engine/sky/proceduralSkyGLSL.js';
import { createWebGpuMaterialBackend } from '../src/engine/render/webgpu/WebGpuMaterialBackend.js';
import { UnderwaterEffect } from '../src/engine/render/UnderwaterEffect.js';
import { CloudLowResPass } from '../src/engine/sky/CloudLowResPass.js';
import { CloudOccupancyPass } from '../src/engine/sky/CloudOccupancyPass.js';
import { createCloudSlabMaterial } from '../src/engine/sky/CloudSlabShader.js';
import {
  createTerrainMaterial,
  createTerrainUniforms,
  rebuildTerrainShaderSource,
} from '../src/engine/terrain/TerrainMaterial.js';
import { createWaterMaterial } from '../src/engine/terrain/WaterMaterial.js';

describe('WebGPU material backend', () => {
  it('creates a native node sky while preserving the legacy uniform update contract', () => {
    const backend = createWebGpuMaterialBackend();
    const original = createProceduralSkyUniforms();
    const { material, uniforms } = backend.createProceduralSkyMaterial(original);

    expect(material.isNodeMaterial).toBe(true);
    expect(material.vertexNode?.isNode).toBe(true);
    expect(material.fragmentNode?.isNode).toBe(true);
    expect(material.userData.renderRole).toBe('sky:procedural');
    expect(uniforms.uSkyZenith?.isNode).toBe(true);

    uniforms.uSkyBrightness.value = 0.7;
    uniforms.uSkyZenith.value.setRGB(0.1, 0.2, 0.3);
    expect(uniforms.uSkyBrightness.value).toBe(0.7);
    expect(uniforms.uSkyZenith.value.g).toBeCloseTo(0.2);

    material.dispose();
  });

  it('creates native node materials for both fullscreen post passes', () => {
    const backend = createWebGpuMaterialBackend();
    const look = {
      tDiffuse: { value: null },
      uTexel: { value: { x: 1, y: 1 } },
      uExposure: { value: 1 }, uContrast: { value: 1 }, uSaturation: { value: 1 },
      uVignette: { value: 0 }, uBloomStrength: { value: 0 },
      uBloomThreshold: { value: 0.75 }, uSunRaysStrength: { value: 0 },
      uSunScreen: { value: { x: 0.5, y: 0.8 } }, uSunVisible: { value: 0 },
      uSunRaysColor: { value: { r: 1, g: 1, b: 1 } }, uTime: { value: 0 },
    };
    const camera = {
      tDiffuse: { value: null },
      uSourceSize: { value: { x: 1, y: 1 } }, uOutputSize: { value: { x: 1, y: 1 } },
      uReconstructionMode: { value: 0 }, uDithering: { value: 0 },
      uDitherStrength: { value: 0.65 }, uDitherLevels: { value: 8 },
      uDitherScale: { value: 2 }, uCrt: { value: 0 }, uCrtStrength: { value: 0.5 },
      uCrtLensBend: { value: 0.35 }, uCrtLineWidth: { value: 2 },
      uChromatic: { value: 0 }, uChromaticStrength: { value: 1.5 }, uTime: { value: 0 },
    };

    const created = backend.createVisualPostMaterials(look, camera);
    expect(created.lookMaterial.isNodeMaterial).toBe(true);
    expect(created.cameraMaterial.isNodeMaterial).toBe(true);
    expect(created.lookMaterial.uniforms.tDiffuse.isTextureNode).toBe(true);
    expect(created.lookMaterial.uniforms.tDiffuse.value?.isTexture).toBe(true);
    expect(created.cameraMaterial.uniforms.uReconstructionMode.isNode).toBe(true);
    created.lookMaterial.dispose();
    created.cameraMaterial.dispose();
  });

  it('injects a native underwater post material without changing its public uniforms', () => {
    const effect = new UnderwaterEffect(createWebGpuMaterialBackend());
    expect(effect._material.isNodeMaterial).toBe(true);
    expect(effect._material.userData.renderRole).toBe('post:underwater');
    expect(effect._material.uniforms.tDepth.isTextureNode).toBe(true);
    effect._material.uniforms.uStrength.value = 0.8;
    expect(effect._material.uniforms.uStrength.value).toBe(0.8);
    effect.dispose();
  });

  it('injects a native bilateral cloud composite material', () => {
    const pass = new CloudLowResPass(createWebGpuMaterialBackend());
    expect(pass._composite.isNodeMaterial).toBe(true);
    expect(pass._composite.userData.renderRole).toBe('cloud:composite');
    expect(pass._composite.uniforms.tCloud.isTextureNode).toBe(true);
    pass.dispose();
  });

  it('injects native cloud occupancy generation and dilation materials', () => {
    const source = createCloudSlabMaterial(8, 1, 3, 0, false, 1);
    const pass = new CloudOccupancyPass({}, source.uniforms, {
      size: 32,
      planet: false,
      materialBackend: createWebGpuMaterialBackend(),
    });
    expect(pass.generateMaterial.isNodeMaterial).toBe(true);
    expect(pass.dilateMaterial.isNodeMaterial).toBe(true);
    expect(pass.generateMaterial.userData.renderRole).toBe('cloud:occupancy:studio');
    expect(pass.dilateMaterial.uniforms.tInput.isTextureNode).toBe(true);
    const replacement = createCloudSlabMaterial(8, 1, 3, 0, false, 1);
    replacement.uniforms.uCloudCoverage.value = 0.73;
    pass.setUniforms(replacement.uniforms);
    expect(pass.generateMaterial.uniforms.uCloudCoverage.value).toBe(0.73);
    pass.dispose();
    source.dispose();
    replacement.dispose();
  });

  it('creates specialized native Manual terrain variants through the runtime factory', () => {
    const backend = createWebGpuMaterialBackend();
    const emptyUniforms = createTerrainUniforms();
    const empty = createTerrainMaterial(emptyUniforms, 1, undefined, {
      variant: 'manual-empty',
      materialBackend: backend,
    });
    const painted = createTerrainMaterial(createTerrainUniforms(), 1, undefined, {
      variant: 'manual',
      materialBackend: backend,
    });

    expect(empty.isNodeMaterial).toBe(true);
    expect(empty.vertexNode?.isNode).toBe(true);
    expect(empty.fragmentNode?.isNode).toBe(true);
    expect(empty.userData.renderRole).toBe('terrain:manual-empty');
    expect(painted.userData.renderRole).toBe('terrain:manual');
    expect(empty.uniforms.uManualHeightTexture.isTextureNode).toBe(true);
    expect(empty.uniforms.uAnalysisEnabled.isNode).toBe(true);
    expect(empty.uniforms.uChunkSize.isNode).toBe(true);
    expect(empty.userData.preservesLinearDataOutputs).toBe(true);
    expect(painted.uniforms.uSurfDiffuse.isTextureNode).toBe(true);
    expect(painted.uniforms.uSurfProps.isTextureNode).toBe(true);
    expect(painted.uniforms.uSurfTile.node.isArrayBufferNode).toBe(true);
    expect(emptyUniforms.uSeaLevel.isNode).toBe(true);
    emptyUniforms.uSeaLevel.value = 18;
    expect(empty.uniforms.uSeaLevel.value).toBe(18);

    rebuildTerrainShaderSource(empty, { sig: 'manual-test' }, { variant: 'manual' });
    expect(empty.userData.terrainVariant).toBe('manual');
    expect(empty.userData.heightProgramSig).toBe('manual-test');
    expect(empty.isShaderMaterial).not.toBe(true);

    const nextTiles = new Array(13).fill(7);
    painted.uniforms.uSurfTile.value = nextTiles;
    expect(painted.uniforms.uSurfTile.node.array).toBe(nextTiles);
    const surfaceFragment = painted.fragmentNode;
    painted.userData.refreshSurfaceTextures();
    expect(painted.fragmentNode).not.toBe(surfaceFragment);
    expect(painted.userData.terrainVariant).toBe('manual');

    empty.dispose();
    painted.dispose();
  });

  it('creates native default Classic Studio terrain without a ShaderMaterial fallback', () => {
    const backend = createWebGpuMaterialBackend();
    const shared = createTerrainUniforms();
    shared.uLayerStrength.value[0] = 0.75;
    const terrain = createTerrainMaterial(shared, 5, undefined, {
      variant: 'detail',
      materialBackend: backend,
      nativeLegacyStudio: true,
    });

    expect(terrain.isNodeMaterial).toBe(true);
    expect(terrain.isShaderMaterial).not.toBe(true);
    expect(terrain.vertexNode?.isNode).toBe(true);
    expect(terrain.fragmentNode?.isNode).toBe(true);
    expect(terrain.userData.renderRole).toBe('terrain:detail');
    expect(terrain.userData.exactLegacyHeight).toBe(true);
    expect(terrain.userData.webGpuLegacyOctaves).toBe(9);
    expect(terrain.userData.webGpuLegacyDynamicOctaves).toBe(true);
    expect(terrain.uniforms.uLayerStrength.node.isArrayBufferNode).toBe(true);
    expect(terrain.uniforms.uLayerStrength.node.array[0]).toBe(0.75);
    shared.uOctaves.value = 3;
    expect(terrain.uniforms.uOctaves.value).toBe(3);

    terrain.uniforms.uPaintHeightTexture.value = null;
    expect(terrain.uniforms.uPaintHeightTexture.value?.isTexture).toBe(true);

    terrain.dispose();
  });

  it('creates native Studio legacy water and keeps shared uniforms live', () => {
    const backend = createWebGpuMaterialBackend();
    const shared = createTerrainUniforms();
    const water = createWaterMaterial(shared, 1, undefined, {
      materialBackend: backend,
    });

    expect(water.isNodeMaterial).toBe(true);
    expect(water.vertexNode?.isNode).toBe(true);
    expect(water.fragmentNode?.isNode).toBe(true);
    expect(water.userData.renderRole).toBe('water:studio:legacy');
    expect(water.uniforms.uManualHeightTexture.isTextureNode).toBe(true);
    expect(water.uniforms.uWaterTerrainHeightTex.isTextureNode).toBe(true);

    shared.uSeaLevel.value = 31;
    expect(water.uniforms.uSeaLevel.value).toBe(31);
    water.uniforms.uFoamWidth.value = 5;
    expect(water.uniforms.uFoamWidth.value).toBe(5);
    water.dispose();
  });
});
