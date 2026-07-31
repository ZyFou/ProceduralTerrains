import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PlanetCloudChunks } from '../src/engine/sky/PlanetCloudChunks.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { generateStackGLSL } from '../src/engine/terrain/noise/noiseStackCodegen.js';
import { defaultLegacyStack, makeLayer, makeStack } from '../src/engine/terrain/noise/NoiseStack.js';
import {
  createInfiniteRealisticWaterMaterial,
  rebuildRealisticWaterShaderSource,
} from '../src/engine/water/RealisticWaterMaterial.js';
import { WaterSystem } from '../src/engine/water/WaterSystem.js';

const stackGLSL = generateStackGLSL(defaultLegacyStack());

describe('asynchronous render-resource lifetime', () => {
  it('retires and disposes cloud chunk candidates before a late compile resolves', async () => {
    let resolveCompile;
    let representativeCandidate;
    const compile = vi.fn((materials) => {
      [representativeCandidate] = materials;
      return new Promise((resolve) => { resolveCompile = resolve; });
    });
    const scene = new THREE.Scene();
    const clouds = new PlanetCloudChunks(scene, {
      planetRadius: 16000,
      faceGrid: 1,
      compile,
    });
    const group = clouds.group;
    const liveDisposals = clouds.chunks.map(
      (chunk) => vi.spyOn(chunk.material, 'dispose'),
    );

    clouds._rebuildMaterials(25, 6, 5, 4, true, 0);
    const candidateDisposal = vi.spyOn(representativeCandidate, 'dispose');
    const pendingToken = clouds._compileToken;

    clouds.dispose();

    expect(clouds._compileToken).toBe(pendingToken + 1);
    expect(clouds._pendingMaterialSets.size).toBe(0);
    expect(candidateDisposal).toHaveBeenCalledTimes(1);
    for (const disposal of liveDisposals) {
      expect(disposal).toHaveBeenCalledTimes(1);
    }
    expect(scene.children).not.toContain(group);

    resolveCompile({ ready: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(candidateDisposal).toHaveBeenCalledTimes(1);
    expect(clouds.chunks).toEqual([]);
  });

  it('owns one legacy Infinite fallback and releases it after realistic attachment', () => {
    const uniforms = createTerrainUniforms();
    const realistic = createInfiniteRealisticWaterMaterial(
      uniforms,
      7,
      stackGLSL,
    );
    const plane = { material: realistic };
    const params = {
      octaves: 7,
      seaLevel: 40,
      waterEnabled: true,
      waterMode: 'realistic',
    };
    const engine = {
      uniforms,
      params,
      worldMode: 'infinite',
      _stackGLSL: stackGLSL,
      _infiniteWaterMat: realistic,
      infiniteWorld: { waterPlane: plane, waterMaterial: realistic },
      proceduralSky: null,
      water: null,
      waterMaterial: null,
    };
    const water = new WaterSystem(engine);
    water._usingRealistic = true;
    water._effectiveMode = 'realistic';
    water._realisticInfinite = realistic;
    const realisticDisposal = vi.spyOn(realistic, 'dispose');

    const fallback = water._ensureLegacyInfiniteMaterial(7);
    const fallbackDisposal = vi.spyOn(fallback, 'dispose');
    expect(fallback).not.toBe(realistic);
    expect(water.ownsMaterial(fallback)).toBe(true);
    expect(water._ensureLegacyInfiniteMaterial(7)).toBe(fallback);
    expect(realisticDisposal).not.toHaveBeenCalled();

    plane.material = fallback;
    engine.infiniteWorld.waterMaterial = fallback;
    water._attachRealisticMaterials(params, 'off');

    expect(engine._infiniteWaterMat).toBe(realistic);
    expect(plane.material).toBe(realistic);
    expect(fallbackDisposal).toHaveBeenCalledTimes(1);
    expect(water._legacyInfiniteFallback).toBeNull();
    expect(realisticDisposal).not.toHaveBeenCalled();

    water.dispose();
    expect(realisticDisposal).toHaveBeenCalledTimes(1);
  });

  it('restores the Classic height source before reusing Infinite realistic water', () => {
    const classicProgram = generateStackGLSL(defaultLegacyStack());
    const graphProgram = generateStackGLSL(makeStack([makeLayer('fbm')]));
    expect(graphProgram.sig).not.toBe(classicProgram.sig);

    const uniforms = createTerrainUniforms();
    const stale = createInfiniteRealisticWaterMaterial(uniforms, 7, graphProgram);
    const expected = createInfiniteRealisticWaterMaterial(uniforms, 7, classicProgram);
    const engine = {
      uniforms,
      params: {
        octaves: 7,
        waterMode: 'realistic',
        waterEnabled: true,
      },
      worldMode: 'infinite',
      _stackGLSL: classicProgram,
      _infiniteWaterMat: stale,
      proceduralSky: null,
      infiniteWorld: null,
      water: null,
      waterMaterial: null,
    };
    const water = new WaterSystem(engine);
    water._usingRealistic = true;
    water._effectiveMode = 'realistic';
    water._realisticInfinite = stale;
    water._realisticInfiniteHeightSig = graphProgram.sig;
    water._realisticInfiniteHeightProgram = graphProgram;

    // Studio Nodes may report its graph source to the shared rebuild hook.
    // Infinite must still stay byte-identical to the Classic terrain stack.
    water.onStackRebuilt(graphProgram, 7);
    expect(stale.fragmentShader).toBe(expected.fragmentShader);

    // A retained stale material is also repaired directly on Infinite entry.
    rebuildRealisticWaterShaderSource(stale, graphProgram);
    water._realisticInfiniteHeightSig = graphProgram.sig;
    water._realisticInfiniteHeightProgram = graphProgram;
    expect(water.createInfiniteMaterial()).toBe(stale);
    expect(stale.fragmentShader).toBe(expected.fragmentShader);

    expected.dispose();
    water.dispose();
  });
});
