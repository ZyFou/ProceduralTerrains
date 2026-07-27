import * as THREE from 'three';

const WATER_PLANE_NORMAL = new THREE.Vector3(0, 1, 0);

export function isPlanarReflectionMode(mode) {
  return mode === 'cinematic';
}

export function resolveWaterPlanarReflectionSize({
  width,
  height,
  reflectionQuality = 1,
  renderScale = 1,
} = {}) {
  const quality = THREE.MathUtils.clamp(
    ((Number(reflectionQuality) || 1) - 1) / 0.5,
    0,
    1,
  );
  const qualityScale = THREE.MathUtils.lerp(0.5, 1, quality);
  const renderScaleMultiplier = THREE.MathUtils.clamp(
    Number(renderScale) || 1,
    0.5,
    2,
  ) * 0.5;
  const scale = THREE.MathUtils.clamp(
    qualityScale * renderScaleMultiplier,
    0.25,
    1,
  );
  return {
    width: Math.max(1, Math.round((Number(width) || 1) * scale)),
    height: Math.max(1, Math.round((Number(height) || 1) * scale)),
    scale,
  };
}

export function resolvePlanarReflectionCadence(value) {
  const requested = Math.round(Number(value) || 1);
  if (requested >= 4) return 4;
  if (requested >= 2) return 2;
  return 1;
}

function setMaterialPlanarReflection(material, {
  color = null,
  matrix = null,
  width = 1,
  height = 1,
  enabled = false,
} = {}) {
  const uniforms = material?.uniforms;
  if (!uniforms?.uPlanarReflectionEnabled) return;
  if (uniforms.uPlanarReflection) {
    uniforms.uPlanarReflection.value = color;
  }
  if (uniforms.uPlanarReflectionMatrix && matrix) {
    uniforms.uPlanarReflectionMatrix.value.copy(matrix);
  }
  if (uniforms.uPlanarReflectionTexelSize) {
    uniforms.uPlanarReflectionTexelSize.value.set(
      1 / Math.max(width, 1),
      1 / Math.max(height, 1),
    );
  }
  uniforms.uPlanarReflectionEnabled.value = enabled && color ? 1 : 0;
}

/**
 * Mirror a perspective/orthographic camera around the horizontal water plane,
 * then replace its near plane with an oblique sea-level clip plane. This keeps
 * underwater terrain out of the reflection without per-material clipping.
 */
export function updatePlanarReflectionCamera(
  sourceCamera,
  reflectionCamera,
  seaLevel,
  clipBias = 0.003,
) {
  sourceCamera.updateMatrixWorld(true);
  reflectionCamera.copy(sourceCamera);

  const cameraWorldPosition = sourceCamera.getWorldPosition(new THREE.Vector3());
  const rotationMatrix = new THREE.Matrix4().extractRotation(sourceCamera.matrixWorld);
  const reflectorPosition = new THREE.Vector3(0, seaLevel, 0);
  const view = reflectorPosition.clone()
    .sub(cameraWorldPosition)
    .reflect(WATER_PLANE_NORMAL)
    .negate()
    .add(reflectorPosition);
  const lookAtPosition = new THREE.Vector3(0, 0, -1)
    .applyMatrix4(rotationMatrix)
    .add(cameraWorldPosition);
  const target = reflectorPosition.clone()
    .sub(lookAtPosition)
    .reflect(WATER_PLANE_NORMAL)
    .negate()
    .add(reflectorPosition);
  const up = new THREE.Vector3(0, 1, 0)
    .applyMatrix4(rotationMatrix)
    .reflect(WATER_PLANE_NORMAL);

  reflectionCamera.position.copy(view);
  reflectionCamera.up.copy(up);
  reflectionCamera.lookAt(target);
  reflectionCamera.updateMatrixWorld(true);
  reflectionCamera.projectionMatrix.copy(sourceCamera.projectionMatrix);

  const reflectorPlane = new THREE.Plane(
    WATER_PLANE_NORMAL.clone(),
    -seaLevel,
  );
  reflectorPlane.applyMatrix4(reflectionCamera.matrixWorldInverse);
  const clipPlane = new THREE.Vector4(
    reflectorPlane.normal.x,
    reflectorPlane.normal.y,
    reflectorPlane.normal.z,
    reflectorPlane.constant,
  );
  const projection = reflectionCamera.projectionMatrix;
  const elements = projection.elements;
  const q = new THREE.Vector4(
    (Math.sign(clipPlane.x) + elements[8]) / elements[0],
    (Math.sign(clipPlane.y) + elements[9]) / elements[5],
    -1,
    (1 + elements[10]) / elements[14],
  );
  clipPlane.multiplyScalar(2 / clipPlane.dot(q));
  elements[2] = clipPlane.x;
  elements[6] = clipPlane.y;
  elements[10] = clipPlane.z + 1 - clipBias;
  elements[14] = clipPlane.w;
  reflectionCamera.projectionMatrixInverse.copy(projection).invert();

  return reflectionCamera;
}

/**
 * Lazy Cinematic-only planar reflection. Water meshes are hidden and their
 * reflection samplers are unbound while the target is being written, avoiding
 * recursive reflections and render-target feedback loops.
 */
export class WaterPlanarReflectionPass {
  constructor() {
    this._target = null;
    this._camera = null;
    this._textureMatrix = new THREE.Matrix4();
    this._active = false;
    this._updatedThisFrame = false;
    this._captureMs = 0;
    this._captureCount = 0;
    this._frame = 0;
    this._cadence = 1;
    this._lastSeaLevel = null;
    this._disposed = false;
  }

  get target() {
    return this._target;
  }

  get reflectionCamera() {
    return this._camera;
  }

  shouldCapture(params, mode, worldMode, camera, enabled = true) {
    const seaLevel = params?.seaLevel ?? 0;
    return enabled
      && !this._disposed
      && worldMode === 'studio'
      && params?.waterEnabled !== false
      && seaLevel > 0.5
      && camera?.position?.y > seaLevel + 0.05
      && (params?.waterReflectionQuality ?? 1) > 1
      && isPlanarReflectionMode(mode);
  }

  disable(materials = []) {
    this._active = false;
    this._updatedThisFrame = false;
    for (const material of materials) setMaterialPlanarReflection(material);
  }

  deactivate(materials = []) {
    this.disable(materials);
    this._target?.dispose();
    this._target = null;
    this._camera = null;
    this._captureMs = 0;
    this._lastSeaLevel = null;
  }

  capture(renderer, scene, camera, {
    params,
    mode,
    worldMode,
    sceneSize,
    hiddenObjects = [],
    materials = [],
    enabled = true,
  } = {}) {
    if (!this.shouldCapture(params, mode, worldMode, camera, enabled)) {
      this.deactivate(materials);
      return false;
    }

    const fallbackSize = renderer.getDrawingBufferSize(new THREE.Vector2());
    const sourceWidth = sceneSize?.x ?? sceneSize?.width ?? fallbackSize.x;
    const sourceHeight = sceneSize?.y ?? sceneSize?.height ?? fallbackSize.y;
    const size = resolveWaterPlanarReflectionSize({
      width: sourceWidth,
      height: sourceHeight,
      reflectionQuality: params?.waterReflectionQuality ?? 1,
      renderScale: params?.waterRenderScale ?? 1,
    });
    const targetChanged = this._ensureTarget(size.width, size.height);
    this._ensureCamera(camera);
    this._cadence = resolvePlanarReflectionCadence(
      params?.waterUpdateFrequency ?? 1,
    );
    this._frame += 1;
    const seaLevel = params?.seaLevel ?? 0;
    const planeChanged = this._lastSeaLevel !== seaLevel;
    const due = targetChanged
      || planeChanged
      || this._captureCount === 0
      || (this._frame - 1) % this._cadence === 0;

    if (!due) {
      this._active = true;
      this._updatedThisFrame = false;
      this._bind(materials);
      return true;
    }

    updatePlanarReflectionCamera(camera, this._camera, seaLevel);
    this._textureMatrix.multiplyMatrices(
      this._camera.projectionMatrix,
      this._camera.matrixWorldInverse,
    );

    this.disable(materials);
    const visibility = hiddenObjects
      .filter(Boolean)
      .map((object) => [object, object.visible]);
    const previousTarget = renderer.getRenderTarget?.() ?? null;
    const previousXrEnabled = renderer.xr?.enabled;
    const previousShadowAutoUpdate = renderer.shadowMap?.autoUpdate;
    const started = globalThis.performance?.now?.() ?? Date.now();

    try {
      for (const [object] of visibility) object.visible = false;
      if (renderer.xr) renderer.xr.enabled = false;
      if (renderer.shadowMap) renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(this._target);
      renderer.render(scene, this._camera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      if (renderer.xr && previousXrEnabled !== undefined) {
        renderer.xr.enabled = previousXrEnabled;
      }
      if (renderer.shadowMap && previousShadowAutoUpdate !== undefined) {
        renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
      }
      for (const [object, visible] of visibility) object.visible = visible;
    }

    const ended = globalThis.performance?.now?.() ?? Date.now();
    this._captureMs = Math.max(0, ended - started);
    this._captureCount += 1;
    this._lastSeaLevel = seaLevel;
    this._active = true;
    this._updatedThisFrame = true;
    this._bind(materials);
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
        cadence: this._cadence,
        updatedThisFrame: false,
      };
    }
    return {
      active: this._active,
      allocated: true,
      resolution: {
        width: this._target.width,
        height: this._target.height,
      },
      memoryBytes: this._target.width * this._target.height * 4,
      additionalSceneRenders: this._updatedThisFrame ? 1 : 0,
      captureMs: this._captureMs,
      captures: this._captureCount,
      cadence: this._cadence,
      updatedThisFrame: this._updatedThisFrame,
    };
  }

  _bind(materials) {
    for (const material of materials) {
      setMaterialPlanarReflection(material, {
        color: this._target?.texture ?? null,
        matrix: this._textureMatrix,
        width: this._target?.width ?? 1,
        height: this._target?.height ?? 1,
        enabled: this._active,
      });
    }
  }

  _ensureCamera(sourceCamera) {
    if (this._camera?.type === sourceCamera.type) return;
    this._camera = sourceCamera.clone();
  }

  _ensureTarget(width, height) {
    if (this._target?.width === width && this._target?.height === height) {
      return false;
    }
    this._target?.dispose();
    this._target = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    this._target.texture.minFilter = THREE.LinearFilter;
    this._target.texture.magFilter = THREE.LinearFilter;
    this._target.texture.generateMipmaps = false;
    this._target.texture.name = 'WaterPlanarReflection';
    this._target.samples = 0;
    return true;
  }

  dispose() {
    this._disposed = true;
    this._active = false;
    this._updatedThisFrame = false;
    this._target?.dispose();
    this._target = null;
    this._camera = null;
  }
}
