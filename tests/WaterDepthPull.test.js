import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';
import { createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { createInfiniteWaterMaterial, createWaterMaterial } from '../src/engine/terrain/WaterMaterial.js';
import { createRealisticWaterMaterial } from '../src/engine/water/RealisticWaterMaterial.js';
import { createPlanetWaterMaterial } from '../src/engine/terrain/PlanetMaterial.js';

function pullHarness(worldMode, seaLevel = 100) {
  const engine = Object.create(Engine.prototype);
  Object.assign(engine, {
    worldMode,
    params: { seaLevel, planetRadius: 16000 },
    uniforms: { uWaterDepthPull: { value: 0 } },
  });
  return engine;
}

function cameraAt(x, y, z) {
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 50000);
  camera.position.set(x, y, z);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('water depth-test tolerance', () => {
  it('rasterizes every water surface through the shared depth pull', () => {
    const uniforms = createTerrainUniforms();
    const materials = [
      createWaterMaterial(uniforms, 3),
      createInfiniteWaterMaterial(uniforms, 3),
      createRealisticWaterMaterial(uniforms, 3),
      createPlanetWaterMaterial(uniforms, 3),
    ];
    for (const material of materials) {
      expect(material.vertexShader).toContain('gl_Position = waterClipPosition(wp');
      // one shared uniform object, so a single per-render update reaches all
      expect(material.uniforms.uWaterDepthPull).toBe(uniforms.uWaterDepthPull);
      material.dispose();
    }
  });

  it('turns a vertical tolerance into a fraction of the eye distance', () => {
    const studio = pullHarness('studio', 100);
    // 200 above the sea: 0.5 + 2 = 2.5 units -> 2.5 / 200
    studio._syncWaterDepthPull(cameraAt(0, 300, 0));
    expect(studio.uniforms.uWaterDepthPull.value).toBeCloseTo(2.5 / 200, 6);
    // far above: capped at 6 units
    studio._syncWaterDepthPull(cameraAt(0, 3100, 0));
    expect(studio.uniforms.uWaterDepthPull.value).toBeCloseTo(6 / 3000, 6);
    // skimming the surface: the fraction stays bounded
    studio._syncWaterDepthPull(cameraAt(0, 100.5, 0));
    expect(studio.uniforms.uWaterDepthPull.value).toBe(0.2);

    const planet = pullHarness('planet', 100);
    // 8000 above the sea shell: 1 + 80 = 81 units
    planet._syncWaterDepthPull(cameraAt(0, 16000 + 100 + 8000, 0));
    expect(planet.uniforms.uWaterDepthPull.value).toBeCloseTo(81 / 8000, 6);
    // orbit: capped at 96 units
    planet._syncWaterDepthPull(cameraAt(0, 16000 + 100 + 20000, 0));
    expect(planet.uniforms.uWaterDepthPull.value).toBeCloseTo(96 / 20000, 6);
  });

  it('never pulls orthographic passes (minimap, exports)', () => {
    const studio = pullHarness('studio', 100);
    studio.uniforms.uWaterDepthPull.value = 0.1;
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    studio._syncWaterDepthPull(ortho);
    expect(studio.uniforms.uWaterDepthPull.value).toBe(0);
  });
});
