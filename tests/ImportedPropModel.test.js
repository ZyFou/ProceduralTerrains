import { describe, expect, it } from 'vitest';
import {
  disposeImportedModelParts,
  importedModelFormat,
  loadImportedPropModel,
} from '../src/engine/props/ImportedPropModel.js';

describe('imported prop models', () => {
  it('recognizes the supported model formats case-insensitively', () => {
    expect(importedModelFormat('tree.GLB')).toBe('glb');
    expect(importedModelFormat('tree.gltf')).toBe('gltf');
    expect(importedModelFormat('tree.obj')).toBe('obj');
    expect(importedModelFormat('tree.fbx')).toBe('');
  });

  it('parses and normalizes an OBJ to a centered, ground-aligned unit model', async () => {
    const obj = [
      'v 10 2 20',
      'v 14 2 20',
      'v 10 6 20',
      'f 1 2 3',
    ].join('\n');
    const model = {
      name: 'triangle.obj',
      format: 'obj',
      data: `data:text/plain;base64,${Buffer.from(obj).toString('base64')}`,
    };
    const parts = await loadImportedPropModel(model);
    expect(parts).toHaveLength(1);
    const bounds = parts[0].geometry.boundingBox;
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(1);
    expect(bounds.min.x + bounds.max.x).toBeCloseTo(0);
    disposeImportedModelParts(parts);
  });
});
