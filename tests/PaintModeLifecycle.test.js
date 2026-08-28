import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine/Engine.js';
import { PaintModeManager } from '../src/paint/PaintModeManager.js';

function paintHarness() {
  const manager = Object.create(PaintModeManager.prototype);
  Object.assign(manager, {
    state: {
      enabled: false,
      baseMode: 'generated',
      baseMultiplier: 1,
      layerOpacity: 1,
    },
    _layersActive: false,
    layers: {
      setBoardSize: vi.fn(),
      clear: vi.fn(),
      load: vi.fn(() => true),
      isEmpty: vi.fn(() => false),
    },
    uniforms: {
      uPaintEnabled: { value: 0 },
      uPaintBoardSize: { value: 0 },
      uPaintOpacity: { value: 0 },
      uPaintBaseMult: { value: 0 },
    },
    getBoardSize: vi.fn(() => 2048),
    onToast: vi.fn(),
    onChange: vi.fn(),
  });
  return manager;
}

describe('paint mode lifecycle', () => {
  it('keeps painted terrain active after the editor closes', () => {
    const manager = paintHarness();
    manager._layersActive = true;

    manager._syncUniforms();

    expect(manager.uniforms.uPaintEnabled.value).toBe(1);
    expect(manager.uniforms.uPaintBaseMult.value).toBe(1);
  });

  it('clears persistent layer state without disabling an intentional flat base', () => {
    const manager = paintHarness();
    manager._layersActive = true;

    manager.startEmpty();

    expect(manager._layersActive).toBe(false);
    expect(manager.uniforms.uPaintEnabled.value).toBe(1);
    expect(manager.uniforms.uPaintBaseMult.value).toBe(0);

    manager.setBaseMode('generated');
    expect(manager.uniforms.uPaintEnabled.value).toBe(0);
  });

  it('cancels stale caches but keeps live terrain and water visible in Paint Mode', () => {
    const engine = Object.create(Engine.prototype);
    const paintMode = {
      state: { enabled: false },
      setEnabled: vi.fn(),
    };
    const terrainHeightBaker = { cancel: vi.fn() };
    const water = { visible: true };
    Object.assign(engine, {
      exploreMode: 'none',
      worldMode: 'studio',
      paintMode,
      terrainHeightBaker,
      _terrainBakeJobKey: 'stale-bake',
      _bakedStudioGen: 5,
      _paintWasEnabled: false,
      _waterDeferred: false,
      water,
      uniforms: {
        uUseTerrainHeightTex: { value: 1 },
        uUseTerrainBiomeTex: { value: 1 },
        uUseWaterTerrainBiomeTex: { value: 1 },
      },
      cb: { onToast: vi.fn() },
    });

    engine.setPaintMode(true);

    expect(terrainHeightBaker.cancel).toHaveBeenCalledOnce();
    expect(engine._terrainBakeJobKey).toBeNull();
    expect(engine._bakedStudioGen).toBe(-1);
    expect(engine.uniforms.uUseTerrainHeightTex.value).toBe(0);
    expect(engine.uniforms.uUseTerrainBiomeTex.value).toBe(0);
    expect(engine.uniforms.uUseWaterTerrainBiomeTex.value).toBe(0);
    expect(engine._waterDeferred).toBe(false);
    expect(water.visible).toBe(true);
    expect(paintMode.setEnabled).toHaveBeenCalledWith(true);
  });

  it('restores the generated base when leaving a lazy Manual document', () => {
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      paintMode: null,
      paintState: {
        enabled: false,
        baseMode: 'flat',
        baseMultiplier: 0,
        layerOpacity: 1,
      },
      uniforms: {
        uPaintEnabled: { value: 1 },
        uPaintBaseMult: { value: 0 },
        uPaintOpacity: { value: 1 },
        uPaintHeightTexture: { value: {} },
        uPaintBiomeTexture: { value: {} },
        uPaintPropsTexture: { value: {} },
      },
      cb: { onPaintState: vi.fn() },
    });

    engine._releasePaintMode();

    expect(engine.paintState.baseMode).toBe('generated');
    expect(engine.paintState.baseMultiplier).toBe(1);
    expect(engine.uniforms.uPaintEnabled.value).toBe(0);
    expect(engine.uniforms.uPaintBaseMult.value).toBe(1);
    expect(engine.uniforms.uPaintHeightTexture.value).toBeNull();
  });
});
