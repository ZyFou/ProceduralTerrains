import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine/Engine.js';

function overlay(visible) {
  return { visible };
}

function captureHarness() {
  const roots = {
    tileGhost: overlay(true),
    paintCursor: overlay(false),
    manualGroup: overlay(true),
    manualAnchor: overlay(true),
    manualTransform: overlay(true),
    manualCursor: overlay(false),
    splineGroup: overlay(true),
    loadGroup: overlay(true),
  };
  const authoredContent = overlay(true);
  const engine = Object.create(Engine.prototype);
  Object.assign(engine, {
    _tileGhost: roots.tileGhost,
    paintMode: { cursor: { group: roots.paintCursor } },
    manualTerrain: {
      group: roots.manualGroup,
      anchor: roots.manualAnchor,
      transform: roots.manualTransform,
      cursor: { group: roots.manualCursor },
    },
    splineManager: { group: roots.splineGroup },
    _rwLoadGroup: roots.loadGroup,
    worldMode: 'studio',
    studioCloud: null,
    planetCloudLayer: null,
    scene: { authoredContent },
    camera: {},
    renderer: {
      info: { render: { triangles: 42, calls: 7 } },
      setRenderTarget: vi.fn(),
    },
    underwater: { render: vi.fn() },
    visualPost: { inputTarget: {}, finish: vi.fn() },
    _prepareCameraPipeline: vi.fn(() => ({ usesSceneTarget: false })),
    _cameraSceneSize: vi.fn(() => ({ width: 1280, height: 720 })),
  });
  return { engine, roots, authoredContent };
}

function expectAllHidden(roots) {
  for (const object of Object.values(roots)) expect(object.visible).toBe(false);
}

describe('camera capture overlays', () => {
  it('hides authoring overlays only while rendering and restores exact visibility', () => {
    const { engine, roots, authoredContent } = captureHarness();
    const before = Object.fromEntries(
      Object.entries(roots).map(([name, object]) => [name, object.visible]),
    );
    engine.underwater.render.mockImplementation(() => {
      expectAllHidden(roots);
      expect(authoredContent.visible).toBe(true);
    });
    engine.visualPost.finish.mockImplementation(() => {
      expectAllHidden(roots);
      expect(authoredContent.visible).toBe(true);
    });

    expect(engine._renderCameraCapture()).toEqual({ triangles: 42, drawCalls: 7 });
    expect(engine.underwater.render).toHaveBeenCalledOnce();
    expect(engine.visualPost.finish).toHaveBeenCalledOnce();
    for (const [name, object] of Object.entries(roots)) {
      expect(object.visible).toBe(before[name]);
    }
    expect(authoredContent.visible).toBe(true);
  });

  it('restores every overlay when capture rendering throws', () => {
    const { engine, roots } = captureHarness();
    const before = Object.fromEntries(
      Object.entries(roots).map(([name, object]) => [name, object.visible]),
    );
    engine.visualPost.finish.mockImplementation(() => {
      expectAllHidden(roots);
      throw new Error('post-processing failed');
    });

    expect(() => engine._renderCameraCapture()).toThrow('post-processing failed');
    for (const [name, object] of Object.entries(roots)) {
      expect(object.visible).toBe(before[name]);
    }
  });
});
