import { describe, expect, it } from 'vitest';
import { resolveCameraRenderPlan } from '../src/engine/render/CameraRenderPlan.js';
import {
  applyPerfPreset,
  createPerfSettings,
  sanitizePerfSettings,
} from '../src/engine/render/PerformanceSettings.js';
import { resetVisualParams } from '../src/engine/panelResets.js';

describe('camera render plan', () => {
  it('bypasses offscreen rendering at native scale when no global effect is active', () => {
    const plan = resolveCameraRenderPlan({
      outputWidth: 1920,
      outputHeight: 1080,
      worldMode: 'infinite',
      visualsPostEnabled: false,
    });
    expect(plan.sceneWidth).toBe(1920);
    expect(plan.sceneHeight).toBe(1080);
    expect(plan.usesSceneTarget).toBe(false);
  });

  it('keeps the Tile look pass active at native scale', () => {
    const plan = resolveCameraRenderPlan({ outputWidth: 1280, outputHeight: 720 });
    expect(plan.lookEnabled).toBe(true);
    expect(plan.needsFinalPass).toBe(false);
    expect(plan.usesSceneTarget).toBe(true);
  });

  it('scales the scene buffer independently from native output resolution', () => {
    const plan = resolveCameraRenderPlan({
      outputWidth: 1920,
      outputHeight: 1080,
      renderScale: 0.5,
      worldMode: 'planet',
      visualsPostEnabled: false,
    });
    expect(plan.sceneWidth).toBe(960);
    expect(plan.sceneHeight).toBe(540);
    expect(plan.needsReconstruction).toBe(true);
  });

  it('uses an aspect-correct virtual resolution without exceeding the performance budget', () => {
    const pixelated = resolveCameraRenderPlan({
      outputWidth: 1920,
      outputHeight: 1080,
      pixelatedEnabled: true,
      pixelResolution: 240,
    });
    expect(pixelated.sceneWidth).toBe(427);
    expect(pixelated.sceneHeight).toBe(240);

    const lowerBudget = resolveCameraRenderPlan({
      outputWidth: 1920,
      outputHeight: 1080,
      renderScale: 0.15,
      pixelatedEnabled: true,
      pixelResolution: 240,
    });
    expect(lowerBudget.sceneWidth).toBe(288);
    expect(lowerBudget.sceneHeight).toBe(162);
  });

  it('supports supersampled scene targets and filter-only final passes', () => {
    const supersampled = resolveCameraRenderPlan({
      outputWidth: 800,
      outputHeight: 600,
      renderScale: 2,
      worldMode: 'planet',
      visualsPostEnabled: false,
    });
    expect(supersampled.sceneWidth).toBe(1600);
    expect(supersampled.sceneHeight).toBe(1200);

    const ditherOnly = resolveCameraRenderPlan({
      outputWidth: 800,
      outputHeight: 600,
      worldMode: 'planet',
      visualsPostEnabled: false,
      ditheringEnabled: true,
    });
    expect(ditherOnly.needsReconstruction).toBe(false);
    expect(ditherOnly.needsFinalPass).toBe(true);

    const chromaticOnly = resolveCameraRenderPlan({
      outputWidth: 800,
      outputHeight: 600,
      worldMode: 'planet',
      visualsPostEnabled: false,
      chromaticAberrationEnabled: true,
    });
    expect(chromaticOnly.cameraEffectsEnabled).toBe(true);
    expect(chromaticOnly.needsFinalPass).toBe(true);
  });
});

describe('camera settings compatibility', () => {
  it('defaults and sanitizes the resolution denoise mode', () => {
    expect(createPerfSettings('high').resolutionDenoiseMode).toBe('clean');
    expect(sanitizePerfSettings({ ...createPerfSettings('high'), resolutionDenoiseMode: 'invalid' }).resolutionDenoiseMode).toBe('clean');
  });

  it('preserves the reconstruction choice across quality presets', () => {
    const custom = { ...createPerfSettings('high'), resolutionDenoiseMode: 'pixelated' };
    expect(applyPerfPreset(custom, 'performance').resolutionDenoiseMode).toBe('pixelated');
  });

  it('adds disabled camera shaders when resetting an older project', () => {
    const reset = resetVisualParams({ visualsExposure: 1.4 });
    expect(reset.visualsPixelatedEnabled).toBe(false);
    expect(reset.visualsPixelResolution).toBe(240);
    expect(reset.visualsDitheringEnabled).toBe(false);
    expect(reset.visualsDitheringLevels).toBe(8);
    expect(reset.visualsDitheringScale).toBe(2);
    expect(reset.visualsCrtEnabled).toBe(false);
    expect(reset.visualsCrtLensBend).toBe(0.35);
    expect(reset.visualsCrtLineWidth).toBe(2);
    expect(reset.visualsChromaticAberrationEnabled).toBe(false);
    expect(reset.visualsChromaticAberrationStrength).toBe(1.5);
  });
});
