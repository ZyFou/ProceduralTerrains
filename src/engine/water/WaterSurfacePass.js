import * as THREE from 'three';

const BASE_REFRACTION_SCALE = 0.5;

export function isSceneRefractionMode(mode) {
  return mode === 'volumetric' || mode === 'cinematic';
}

export function resolveWaterSurfacePassSize({
  width,
  height,
  renderScale = 1,
} = {}) {
  const scale = BASE_REFRACTION_SCALE
    * THREE.MathUtils.clamp(Number(renderScale) || 1, 0.25, 2);
  return {
    width: Math.max(1, Math.round((Number(width) || 1) * scale)),
    height: Math.max(1, Math.round((Number(height) || 1) * scale)),
    scale,
  };
}

function setMaterialCapture(material, {
  color = null,
  depth = null,
  width = 1,
  height = 1,
  near = 1,
  far = 50000,
  enabled = false,
} = {}) {
  const uniforms = material?.uniforms;
  if (!uniforms?.uSceneRefractionEnabled) return;
  if (uniforms.uSceneColor) uniforms.uSceneColor.value = color;
  if (uniforms.uSceneDepth) uniforms.uSceneDepth.value = depth;
  if (uniforms.uSceneTexelSize) {
    uniforms.uSceneTexelSize.value.set(
      1 / Math.max(width, 1),
      1 / Math.max(height, 1),
    );
  }
  if (uniforms.uSceneNear) uniforms.uSceneNear.value = near;
  if (uniforms.uSceneFar) uniforms.uSceneFar.value = far;
  uniforms.uSceneRefractionEnabled.value = enabled && color && depth ? 1 : 0;
}

/**
 * Lazy scene-color/depth capture used by Volumetric/Cinematic water.
 *
 * The water meshes are hidden and their sampler uniforms are unbound while
 * this target is written. This guarantees that the pass can never sample the
 * same texture it is currently rendering into.
 */
export class WaterSurfacePass {
  constructor() {
    this._target = null;
    this._active = false;
    this._captureMs = 0;
    this._captureCount = 0;
    this._disposed = false;
  }

  get target() {
    return this._target;
  }

  shouldCapture(params, mode, worldMode) {
    return !this._disposed
      && worldMode !== 'planet'
      && params?.waterEnabled !== false
      && (params?.seaLevel ?? 0) > 0.5
      && (params?.waterRefractionQuality ?? 0.6) > 0.01
      && isSceneRefractionMode(mode);
  }

  disable(materials = []) {
    this._active = false;
    for (const material of materials) setMaterialCapture(material);
  }

  deactivate(materials = []) {
    this.disable(materials);
    this._target?.dispose();
    this._target = null;
    this._captureMs = 0;
  }

  capture(renderer, scene, camera, {
    params,
    mode,
    worldMode,
    sceneSize,
    hiddenObjects = [],
    materials = [],
  } = {}) {
    if (!this.shouldCapture(params, mode, worldMode)) {
      this.deactivate(materials);
      return false;
    }

    const fallbackSize = renderer.getDrawingBufferSize(new THREE.Vector2());
    const sourceWidth = sceneSize?.x ?? sceneSize?.width ?? fallbackSize.x;
    const sourceHeight = sceneSize?.y ?? sceneSize?.height ?? fallbackSize.y;
    const size = resolveWaterSurfacePassSize({
      width: sourceWidth,
      height: sourceHeight,
      renderScale: params?.waterRenderScale ?? 1,
    });
    this._ensureTarget(size.width, size.height);

    // Unbind before writing even though water is hidden. It prevents a future
    // visibility or layer regression from creating a texture feedback loop.
    this.disable(materials);
    const visibility = hiddenObjects
      .filter(Boolean)
      .map((object) => [object, object.visible]);
    const previousTarget = renderer.getRenderTarget?.() ?? null;
    const started = globalThis.performance?.now?.() ?? Date.now();

    try {
      for (const [object] of visibility) object.visible = false;
      renderer.setRenderTarget(this._target);
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      for (const [object, visible] of visibility) object.visible = visible;
    }

    const ended = globalThis.performance?.now?.() ?? Date.now();
    this._captureMs = Math.max(0, ended - started);
    this._captureCount += 1;
    this._active = true;
    for (const material of materials) {
      setMaterialCapture(material, {
        color: this._target.texture,
        depth: this._target.depthTexture,
        width: this._target.width,
        height: this._target.height,
        near: camera.near,
        far: camera.far,
        enabled: true,
      });
    }
    return true;
  }

  diagnostics() {
    if (!this._target) {
      return {
        active: false,
        allocated: false,
        resolution: null,
        memoryBytes: 0,
        additionalSceneRenders: 0,
        captureMs: 0,
        captures: this._captureCount,
      };
    }
    return {
      active: this._active,
      allocated: true,
      resolution: { width: this._target.width, height: this._target.height },
      // RGBA8 scene color + unsigned-int depth.
      memoryBytes: this._target.width * this._target.height * 8,
      additionalSceneRenders: this._active ? 1 : 0,
      captureMs: this._captureMs,
      captures: this._captureCount,
    };
  }

  _ensureTarget(width, height) {
    if (this._target?.width === width && this._target?.height === height) return;
    this._target?.dispose();

    const depthTexture = new THREE.DepthTexture(width, height);
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    depthTexture.generateMipmaps = false;
    depthTexture.name = 'WaterOpaqueDepth';

    this._target = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
    });
    this._target.texture.minFilter = THREE.LinearFilter;
    this._target.texture.magFilter = THREE.LinearFilter;
    this._target.texture.generateMipmaps = false;
    this._target.texture.name = 'WaterOpaqueColor';
    this._target.samples = 0;
  }

  dispose() {
    this._disposed = true;
    this._active = false;
    this._target?.dispose();
    this._target = null;
  }
}
