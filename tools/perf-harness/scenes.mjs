// Benchmark scene matrix. Each scene boots a fresh engine (fresh page) with
// the given params/perf preset, optionally switches world mode, then visits
// static views (settle → capture → timed frames) and camera paths (timed
// frames while the camera moves → streaming / LOD / culling cost + hitches).
//
// Studio poses: radiusFactor × boardSize, phi = polar angle from +Y (deg),
// theta = azimuth (deg), target = [x × boardSize, y (world), z × boardSize].
// Infinite poses: world position + FPS yaw/pitch (deg).
// Planet poses: distFactor × planet radius, phi/theta (deg).

export const SCENES = [
  {
    id: 'studio',
    label: 'Tile mode — default project',
    config: { preset: 'high' },
    views: [
      { id: 'overview', pose: { radiusFactor: 1.4, phi: 55, theta: 45 } },
      { id: 'close', pose: { radiusFactor: 0.2, phi: 70, theta: 130, target: [0.08, 150, -0.06] } },
      { id: 'grazing', pose: { radiusFactor: 0.5, phi: 83, theta: 220, target: [0, 60, 0] } },
    ],
    popPath: {
      frames: 300,
      path: [
        { radiusFactor: 1.5, phi: 72, theta: 200, target: [0.02, 60, -0.02] },
        { radiusFactor: 0.12, phi: 78, theta: 230, target: [0.05, 120, -0.05] },
      ],
    },
    paths: [
      {
        id: 'orbit-zoom',
        frames: 180,
        path: [
          { radiusFactor: 1.4, phi: 55, theta: 45, target: [0, 0, 0] },
          { radiusFactor: 0.6, phi: 70, theta: 120, target: [0.05, 80, 0] },
          { radiusFactor: 0.18, phi: 76, theta: 200, target: [0.1, 140, -0.08] },
          { radiusFactor: 0.9, phi: 60, theta: 300, target: [-0.05, 0, 0.05] },
        ],
      },
    ],
  },
  {
    id: 'studio-full',
    label: 'Tile mode — clouds + props + realistic water',
    config: {
      preset: 'high',
      params: { cloudsEnabled: true, propsEnabled: true, waterMode: 'realistic' },
    },
    views: [
      { id: 'overview', pose: { radiusFactor: 1.4, phi: 55, theta: 45 } },
      { id: 'close', pose: { radiusFactor: 0.2, phi: 70, theta: 130, target: [0.08, 150, -0.06] } },
      { id: 'grazing', pose: { radiusFactor: 0.5, phi: 83, theta: 220, target: [0, 60, 0] } },
    ],
    paths: [
      {
        id: 'orbit-zoom',
        frames: 150,
        path: [
          { radiusFactor: 1.4, phi: 55, theta: 45, target: [0, 0, 0] },
          { radiusFactor: 0.6, phi: 70, theta: 120, target: [0.05, 80, 0] },
          { radiusFactor: 0.18, phi: 76, theta: 200, target: [0.1, 140, -0.08] },
        ],
      },
    ],
  },
  {
    id: 'infinite',
    label: 'Infinite world',
    config: { preset: 'high' },
    mode: 'infinite',
    // altitude sweep: every chunk's LOD distance changes, but the streamed
    // chunk set (horizontal position) does not, so only LOD swaps can pop
    popPath: {
      frames: 300,
      path: [
        { position: [40, 240, 40], yaw: 30, pitch: -22 },
        { position: [40, 1500, 40], yaw: 30, pitch: -22 },
      ],
    },
    views: [
      { id: 'horizon', pose: { position: [0, 520, 0], yaw: 35, pitch: -8 } },
      { id: 'low', pose: { position: [900, 260, -700], yaw: 140, pitch: -14 } },
    ],
    paths: [
      {
        id: 'flight',
        frames: 180,
        path: [
          { position: [0, 520, 0], yaw: 35, pitch: -8 },
          { position: [-1800, 480, -2600], yaw: 60, pitch: -10 },
          { position: [-3600, 600, -5200], yaw: 80, pitch: -6 },
        ],
      },
    ],
  },
  {
    id: 'planet',
    label: 'Planet',
    config: { preset: 'high' },
    mode: 'planet',
    popPath: {
      frames: 300,
      path: [
        { distFactor: 1.9, phi: 66, theta: 40 },
        { distFactor: 1.06, phi: 70, theta: 52 },
      ],
    },
    views: [
      { id: 'orbit', pose: { distFactor: 2.6, phi: 65, theta: 35 } },
      { id: 'near', pose: { distFactor: 1.12, phi: 70, theta: 50 } },
    ],
    paths: [
      {
        id: 'descent',
        frames: 150,
        path: [
          { distFactor: 2.6, phi: 65, theta: 35 },
          { distFactor: 1.6, phi: 68, theta: 45 },
          { distFactor: 1.08, phi: 72, theta: 60 },
        ],
      },
    ],
  },
];
