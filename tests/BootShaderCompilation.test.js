import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/Engine.js';

function engineHarness() {
  const engine = Object.create(Engine.prototype);
  engine._disposed = false;
  engine.camera = {};
  engine.scene = {};
  return engine;
}

describe('boot shader compilation', () => {
  it('collects only materials whose complete parent chain is visible', () => {
    const engine = engineHarness();
    const visibleMaterial = { id: 'visible' };
    const hiddenMaterial = { id: 'hidden-child' };
    const hiddenParent = { visible: false, parent: null };
    const objects = [
      { material: visibleMaterial, visible: true, parent: null },
      { material: hiddenMaterial, visible: true, parent: hiddenParent },
    ];
    engine.scene = { traverse: (visit) => objects.forEach(visit) };
    engine.visualPost = {
      _lookMaterial: { id: 'look' },
      _cameraMaterial: { id: 'camera' },
    };
    engine.underwater = { active: false, _material: { id: 'underwater' } };

    const materials = engine._finalBootMaterials([], {
      lookEnabled: true,
      needsFinalPass: false,
    });

    expect(materials).toContain(visibleMaterial);
    expect(materials).toContain(engine.visualPost._lookMaterial);
    expect(materials).not.toContain(hiddenMaterial);
    expect(materials).not.toContain(engine.visualPost._cameraMaterial);
    expect(materials).not.toContain(engine.underwater._material);
  });
});
