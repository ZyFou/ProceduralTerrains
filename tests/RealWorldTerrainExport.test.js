import { describe, expect, it } from 'vitest';
import { createTerrainMaterial, createTerrainUniforms } from '../src/engine/terrain/TerrainMaterial.js';
import { buildTerrainBakeFragment } from '../src/engine/terrain/TerrainExporter.js';

describe('real-world terrain color export', () => {
  it('uses the same geo-aligned imagery albedo in the viewport and export bake', () => {
    const material = createTerrainMaterial(createTerrainUniforms(), 5);
    const bakeFragment = buildTerrainBakeFragment('', '');

    for (const shader of [material.fragmentShader, bakeFragment]) {
      expect(shader).toContain('vec3 applyImportedImageryAlbedo');
      expect(shader).toContain('vec2 imageryUv = importHeightUvAt(xz);');
      expect(shader).toContain('texture2D(uImportImageryTex');
      expect(shader).toContain('mix(baseAlbedo, imageryColor, uImportImageryBlend)');
    }
    expect(material.fragmentShader).toContain(
      'td.albedo = applyImportedImageryAlbedo(td.albedo, xz);',
    );
    expect(bakeFragment).toContain(
      'tc.albedo = applyImportedImageryAlbedo(tc.albedo, xz);',
    );

    material.dispose();
  });
});
