// Boots the engine through the production proxy in the render WORKER (the
// default renderer) so real DOM input travels InputFrameBridge -> worker DOM
// stand-ins -> tool listeners, exactly as in the app.
import { createEngineProxy } from '/src/engine/EngineProxy.js';
import { createPerfSettings } from '/src/engine/render/PerformanceSettings.js';

const canvas = document.getElementById('c');
const manualEvents = [];
window.__manualEvents = manualEvents;
let resolveBoot;
window.__booted = new Promise((resolve) => { resolveBoot = resolve; });
const engine = await createEngineProxy({
  canvas,
  initialView: 'editor',
  initialPerf: { ...createPerfSettings('high'), useWorker: true, energyMode: 'off', autoPerf: false },
  callbacks: {
    onBootComplete: () => resolveBoot(true),
    onManualTerrainState: (state, meta) => manualEvents.push({
      at: Math.round(performance.now()),
      label: meta?.label ?? null,
      sculpt: state?.sculpt?.enabled ?? null,
      paint: state?.texturePaint?.enabled ?? null,
    }),
  },
});
window.__engine = engine;
window.__transport = engine.snapshot?.rendererConfig?.transport;
