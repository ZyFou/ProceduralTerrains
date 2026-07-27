const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));

/**
 * Resolve the native output and scaled scene-buffer sizes for the shared
 * camera pipeline. Kept pure so resize/DPR/filter interactions are testable
 * without constructing a WebGL renderer.
 */
export function resolveCameraRenderPlan({
  outputWidth,
  outputHeight,
  renderScale = 1,
  worldMode = 'studio',
  visualsPostEnabled = true,
  sunRaysStrength = 0,
  pixelatedEnabled = false,
  pixelResolution = 240,
  ditheringEnabled = false,
  crtEnabled = false,
  chromaticAberrationEnabled = false,
  requireSceneTarget = false,
} = {}) {
  const outW = clampInt(Number(outputWidth) || 1, 1, 16384);
  const outH = clampInt(Number(outputHeight) || 1, 1, 16384);
  const scale = Math.min(2, Math.max(0.1, Number(renderScale) || 1));

  let sceneW = clampInt(outW * scale, 1, 16384);
  let sceneH = clampInt(outH * scale, 1, 16384);
  if (pixelatedEnabled) {
    const virtualH = clampInt(Number(pixelResolution) || 240, 120, 720);
    if (virtualH < sceneH) {
      sceneH = virtualH;
      sceneW = clampInt(virtualH * (outW / outH), 1, 16384);
    }
  }

  const sunRaysEnabled = Number(sunRaysStrength) > 0.001;
  const lookEnabled = (worldMode === 'studio' && visualsPostEnabled !== false)
    || sunRaysEnabled;
  const cameraEffectsEnabled = !!(
    pixelatedEnabled || ditheringEnabled || crtEnabled || chromaticAberrationEnabled
  );
  const needsReconstruction = sceneW !== outW || sceneH !== outH;
  // Some effects (volumetric clouds) need to sample the depth produced by the
  // real scene render. In that case the scene must use a target even when no
  // artistic post effect is enabled, and a final blit is required.
  const needsFinalPass = needsReconstruction || cameraEffectsEnabled || requireSceneTarget;

  return {
    outputWidth: outW,
    outputHeight: outH,
    sceneWidth: sceneW,
    sceneHeight: sceneH,
    renderScale: scale,
    lookEnabled,
    sunRaysEnabled,
    cameraEffectsEnabled,
    needsReconstruction,
    needsFinalPass,
    usesSceneTarget: lookEnabled || needsFinalPass,
  };
}
