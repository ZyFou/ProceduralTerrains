// ============================================================================
// Water visual baselines — deterministic scenes and capture-report helpers.
//
// These scenarios intentionally exercise the existing renderer without changing
// its shading model. They are the before/after reference set for Water Surface
// V2 and later refraction/reflection work.
// ============================================================================

export const WATER_BASELINE_SCENES = [
  {
    value: 'deep-ocean-midday',
    label: '1 · Deep Ocean — Midday',
    worldMode: 'studio',
    terrainPreset: 'archipelago',
    waterPreset: 'ocean',
    timeOfDay: 0.50,
    camera: {
      kind: 'orbit',
      target: [0, 0, 0],
      targetSeaOffset: 0,
      radiusBoardFactor: 0.72,
      phiDeg: 66,
      thetaDeg: 32,
    },
  },
  {
    value: 'deep-ocean-sunset',
    label: '2 · Deep Ocean — Sunset',
    worldMode: 'studio',
    terrainPreset: 'archipelago',
    waterPreset: 'ocean',
    timeOfDay: 0.78,
    camera: {
      kind: 'orbit',
      target: [0, 0, 0],
      targetSeaOffset: 0,
      radiusBoardFactor: 0.72,
      phiDeg: 69,
      thetaDeg: 122,
    },
  },
  {
    value: 'shallow-tropical-coast',
    label: '3 · Shallow Tropical Coast',
    worldMode: 'studio',
    terrainPreset: 'archipelago',
    waterPreset: 'tropical',
    timeOfDay: 0.46,
    camera: {
      kind: 'orbit',
      target: [0.14, 0, -0.08],
      targetSeaOffset: 0,
      radiusBoardFactor: 0.34,
      phiDeg: 61,
      thetaDeg: 42,
    },
  },
  {
    value: 'mountain-lake',
    label: '4 · Mountain Lake',
    worldMode: 'studio',
    terrainPreset: 'highlands',
    waterPreset: 'lake',
    timeOfDay: 0.40,
    camera: {
      kind: 'orbit',
      target: [0, 0, 0],
      targetSeaOffset: 0,
      radiusBoardFactor: 0.48,
      phiDeg: 63,
      thetaDeg: 218,
    },
  },
  {
    value: 'infinite-grazing',
    label: '5 · Infinite World — Grazing',
    worldMode: 'infinite',
    terrainPreset: 'highlands',
    waterPreset: 'balanced',
    timeOfDay: 0.55,
    camera: {
      kind: 'first-person',
      position: [0, 18, 0.16],
      positionYFromSea: true,
      xzBoardRelative: true,
      yawDeg: 180,
      pitchDeg: -4,
    },
  },
  {
    value: 'surface-transition-above',
    label: '6A · Surface Transition — Above',
    worldMode: 'studio',
    terrainPreset: 'archipelago',
    waterPreset: 'balanced',
    timeOfDay: 0.50,
    camera: {
      kind: 'orbit',
      target: [0, 0, 0],
      targetSeaOffset: -1,
      radius: 4,
      phiDeg: 59,
      thetaDeg: 30,
    },
  },
  {
    value: 'surface-transition-below',
    label: '6B · Surface Transition — Below',
    worldMode: 'studio',
    terrainPreset: 'archipelago',
    waterPreset: 'balanced',
    timeOfDay: 0.50,
    camera: {
      kind: 'orbit',
      target: [0, 0, 0],
      targetSeaOffset: -5,
      radius: 4,
      phiDeg: 73,
      thetaDeg: 30,
    },
  },
];

const WATER_BASELINE_SEED = 0x57a7e2;

export function getWaterBaselineScene(sceneId) {
  return WATER_BASELINE_SCENES.find((scene) => scene.value === sceneId) ?? null;
}

export function waterBaselineParams(scene, currentParams = {}) {
  return {
    ...currentParams,
    seed: WATER_BASELINE_SEED,
    skyboxEnabled: true,
    skyboxDayNightCycle: false,
    waterEnabled: true,
    waterAnim: true,
    waterDebugView: 'off',
    propsEnabled: false,
    ...scene?.params,
  };
}

export function resolveWaterBaselineCamera(scene, {
  seaLevel = 100,
  boardSize = 2048,
} = {}) {
  const camera = scene?.camera;
  if (!camera) return null;

  if (camera.kind === 'first-person') {
    const [px = 0, py = 0, pz = 0] = camera.position ?? [];
    return {
      kind: camera.kind,
      position: [
        camera.xzBoardRelative ? px * boardSize : px,
        camera.positionYFromSea ? seaLevel + py : py,
        camera.xzBoardRelative ? pz * boardSize : pz,
      ],
      yaw: degreesToRadians(camera.yawDeg ?? 0),
      pitch: degreesToRadians(camera.pitchDeg ?? 0),
    };
  }

  const [tx = 0, ty = 0, tz = 0] = camera.target ?? [];
  return {
    kind: 'orbit',
    target: [
      tx * boardSize,
      ty + seaLevel + (camera.targetSeaOffset ?? 0),
      tz * boardSize,
    ],
    radius: camera.radius ?? boardSize * (camera.radiusBoardFactor ?? 0.5),
    phi: degreesToRadians(camera.phiDeg ?? 55),
    theta: degreesToRadians(camera.thetaDeg ?? 45),
  };
}

export function createWaterBaselineReport({
  scene,
  params = {},
  diagnostics = null,
  performance = null,
  captureStats = null,
  shaderCompile = null,
} = {}) {
  const waterParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith('water') || key === 'seaLevel' || key === 'seed') {
      waterParams[key] = value;
    }
  }

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    baseline: scene ? {
      id: scene.value,
      label: scene.label,
      worldMode: scene.worldMode,
      terrainPreset: scene.terrainPreset,
      waterPreset: scene.waterPreset,
      timeOfDay: scene.timeOfDay,
    } : null,
    result: {
      fps: performance?.fps ?? null,
      cpuFrameMs: round(performance?.frame?.avg),
      gpuFrameMs: performance?.gpu?.supported
        ? round(performance.gpu.frameMs)
        : null,
      gpuTimingSupported: performance?.gpu?.supported === true,
      drawCalls: captureStats?.drawCalls ?? performance?.render?.calls ?? null,
      triangles: captureStats?.triangles ?? performance?.render?.triangles ?? null,
      waterShaderCompile: shaderCompile ?? null,
    },
    renderer: diagnostics?.renderer ?? null,
    drawingBuffer: diagnostics?.drawingBuffer ?? null,
    camera: diagnostics?.camera ?? null,
    water: diagnostics?.water ?? null,
    params: waterParams,
  };
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}
