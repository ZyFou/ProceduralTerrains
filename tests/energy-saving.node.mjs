import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FramePacer, normalizeEnergySettings, resolveFramePolicy } from '../src/engine/render/FramePacer.js';
import { withEnergySaving } from '../src/engine/render/withEnergySaving.js';

const policy = (settings = {}, state = {}) => resolveFramePolicy(settings, {
  now: 5000, lastActivityAt: 0, ...state,
});

 test('old/invalid saves acquire bounded settings; explicit off survives', () => {
  assert.deepEqual(normalizeEnergySettings(), { energyMode: 'balanced', energyMaxFps: 60 });
  for (const energyMaxFps of [0, -1, Infinity, NaN, 'junk', 1000]) {
    assert.equal(normalizeEnergySettings({ energyMaxFps }).energyMaxFps, 60);
  }
  assert.equal(normalizeEnergySettings({ energyMaxFps: '120' }).energyMaxFps, 120);
  assert.equal(normalizeEnergySettings({ energyMode: 'off' }).energyMode, 'off');
});

test('balanced is 60 active / 30 idle, regardless of GPU tier', () => {
  assert.equal(policy({}, { lastActivityAt: 4000 }).targetFps, 60);
  assert.equal(policy().targetFps, 30);
  for (const gpuTier of ['low', 'medium', 'high']) {
    assert.equal(policy({ gpuTier }).targetFps, 30);
  }
});

test('eco is 30 active / 24 idle and never raises a user ceiling', () => {
  assert.equal(policy({ energyMode: 'eco' }, { interactive: true }).targetFps, 30);
  assert.equal(policy({ energyMode: 'eco' }).targetFps, 24);
  assert.equal(policy({ energyMaxFps: 30 }, { interactive: true }).targetFps, 30);
});

test('exploration, held input, and inertia stay active; showcase stays paced', () => {
  assert.equal(policy({}, { interactive: true }).state, 'active');
  assert.equal(policy({ energyMaxFps: 120 }, { interactive: true }).targetFps, 120);
  assert.equal(policy({}, { landing: true, lastActivityAt: 5000 }).targetFps, 30);
});

test('hidden wins over force, compilation, and off; boot/force bypass pacing while visible', () => {
  for (const state of [{ busy: true }, { force: true }, {}]) {
    assert.equal(policy({ energyMode: 'off' }, { ...state, visible: false }).targetFps, 0);
  }
  assert.equal(policy({}, { busy: true }).targetFps, Infinity);
  assert.equal(policy({}, { force: true }).targetFps, Infinity);
  assert.equal(policy({ energyMode: 'off' }).targetFps, Infinity);
});

for (const refresh of [60, 90, 120, 144, 165]) {
  for (const targetFps of [24, 30, 60]) {
    test(`${targetFps} FPS admission on a ${refresh} Hz display has no rate drift`, () => {
      const pacer = new FramePacer();
      for (let i = 0; i < refresh * 10; i++) {
        pacer.admit(i * 1000 / refresh, { state: 'active', targetFps });
      }
      assert.ok(Math.abs(pacer.accepted - targetFps * 10) <= 2,
        `${pacer.accepted} admitted instead of ${targetFps * 10}`);
    });
  }
}

test('waking is immediate but repeated activity does not uncap active FPS', () => {
  const p = new FramePacer();
  p.admit(0, { state: 'idle', targetFps: 24 });
  assert.equal(p.admit(5, { state: 'active', targetFps: 60 }), true);
  assert.equal(p.admit(10, { state: 'active', targetFps: 60 }), false);
  assert.equal(p.admit(22, { state: 'active', targetFps: 60 }), true);
});

test('background and long stalls never produce catch-up bursts', () => {
  const p = new FramePacer();
  p.admit(0, { state: 'active', targetFps: 60 });
  assert.equal(p.admit(10, { state: 'hidden', targetFps: 0 }), false);
  assert.equal(p.admit(30000, { state: 'active', targetFps: 60 }), true);
  assert.equal(p.resumed, true);
  assert.equal(p.admit(30001, { state: 'active', targetFps: 60 }), false);
  assert.equal(p.admit(60000, { state: 'active', targetFps: 60 }), true);
  assert.equal(p.admit(60001, { state: 'active', targetFps: 60 }), false);
});

class EventHub {
  constructor() { this.listeners = new Map(); this.visibilityState = 'visible'; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, values = {}) {
    for (const fn of this.listeners.get(type) || []) fn({ type, ...values });
  }
  get listenerCount() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
}

class BaseEngine {
  constructor() {
    this.canvas = new EventHub();
    this.perf = {};
    this._fps = 30;
    this._frames = 7;
    this._debug = {};
    this.controls = {};
    this.exploreMode = 'none';
    this.work = 0;
    this.visibilityResets = 0;
    this.clockResets = 0;
    this._clock = { reset: () => this.clockResets++ };
    this._applyPerformance(); // Proves overridden initialization is safe inside super().
  }
  _applyPerformance() { this.performanceApplies = (this.performanceApplies || 0) + 1; }
  _notifyPerf() { this.notifiedPerf = { ...this.perf }; }
  setPerfSetting(key, value) { this.delegatedSetting = { key, value }; }
  _afterParamChange() { this._needsRender = true; }
  _onResize() { this._needsRender = true; }
  _tick() { this.work++; }
  _continuousRenderInterval() { return 41; }
  _renderCadenceDue() { return false; }
  _autoPerfTick() { this.autoObservedFps = this._fps; if (this.autoThrows) throw new Error('controller'); }
  setTouchInput(input) { this.touch = input; }
  setViewport(viewport) { if (viewport.visible) this.visibilityResets++; this.lastViewport = viewport; }
  applyInputFrame(frame) {
    for (const event of frame.keyEvents || []) globalThis.document.emit(event.type, event);
    if (typeof frame.visible === 'boolean') this.setViewport({ visible: frame.visible });
  }
  getPerfDiagnostics() { return { existing: true }; }
  getClientSnapshot() { return { perf: { ...this.perf } }; }
  dispose() { this._disposed = true; }
}

function withEnvironment(run) {
  const previous = { document: globalThis.document, window: globalThis.window, performance: globalThis.performance };
  let now = 0;
  globalThis.document = new EventHub();
  globalThis.window = new EventHub();
  globalThis.performance = { now: () => now };
  try {
    const Engine = withEnergySaving(BaseEngine);
    return run(new Engine(), (value) => { now = value; });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}

test('the adapter skips the entire CPU body, not only GPU submission', () => withEnvironment((e, time) => {
  e._tick(); time(5); e._tick();
  assert.equal(e.work, 1);
  time(20); e._tick(); assert.equal(e.work, 2);
  time(2000); e._tick(); time(2010); e._tick(); assert.equal(e.work, 3);
  assert.equal(e._energyPacer.state, 'idle');
  assert.equal(e._renderCadenceDue(2010), true); // No second limiter.
}));

test('worker visible:false is honored independently of the visible DOM shim', () => withEnvironment((e, time) => {
  e._tick(); e.setViewport({ visible: false });
  time(1000); e._tick(); assert.equal(e.work, 1);
  assert.equal(globalThis.document.visibilityState, 'visible');
  e.setViewport({ visible: true }); time(1001); e._tick();
  assert.equal(e.work, 2); assert.equal(e.clockResets, 1); assert.equal(e._frames, 0);
  assert.equal(e._fpsTime, 1001);
}));

test('ordinary visible input packets do not reset animation time', () => withEnvironment((e) => {
  for (let i = 0; i < 20; i++) e.applyInputFrame({ visible: true });
  assert.equal(e.visibilityResets, 0); assert.equal(e.clockResets, 0);
  e.setViewport({ width: 640, height: 480, pixelRatio: 2, visible: true });
  assert.deepEqual(e.lastViewport, { width: 640, height: 480, pixelRatio: 2 });
}));

test('worker canvas input wakes immediately without event bubbling', () => withEnvironment((e, time) => {
  time(2000); e._tick(); assert.equal(e._energyPacer.state, 'idle');
  time(2005); e.canvas.emit('pointerdown', { pointerId: 1 }); e._tick();
  assert.equal(e._energyPacer.state, 'active'); assert.equal(e.work, 2);
  time(5000); e._tick(); assert.equal(e._energyPacer.state, 'active');
  e.canvas.emit('pointerup', { pointerId: 1 });
  time(7000); e._tick(); assert.equal(e._energyPacer.state, 'idle');
}));

test('passive hover does not keep the GPU active; brush hover does', () => withEnvironment((e, time) => {
  time(2000); e.canvas.emit('pointermove', { buttons: 0 }); e._tick();
  assert.equal(e._energyPacer.state, 'idle');
  e.paintState = { enabled: true }; time(2010); e.canvas.emit('pointermove', { buttons: 0 }); e._tick();
  assert.equal(e._energyPacer.state, 'active');
}));

test('hidden transition releases held worker keys and native visibility also pauses', () => withEnvironment((e, time) => {
  globalThis.document.emit('keydown', { code: 'KeyW', key: 'w' });
  assert.equal(e._energyKeys.size, 1);
  e.setViewport({ visible: false }); assert.equal(e._energyKeys.size, 0);
  e.setViewport({ visible: true });
  globalThis.document.visibilityState = 'hidden';
  globalThis.document.emit('visibilitychange'); time(2000); e._tick();
  assert.equal(e.work, 0);
}));

test('idle quality does not drift; active 30-FPS is normalized only inside the controller', () => withEnvironment((e, time) => {
  time(2000); e._tick(); e._autoPerfTick(2000); assert.equal(e.autoObservedFps, undefined);
  e.perf.energyMode = 'eco'; e._wakeEnergy(); time(2010); e._tick();
  e._autoPerfTick(2010); assert.equal(e.autoObservedFps, 60); assert.equal(e._fps, 30);
  e.autoThrows = true; assert.throws(() => e._autoPerfTick(2010)); assert.equal(e._fps, 30);
}));

test('off restores legacy cadence, while hidden safety remains enabled', () => withEnvironment((e, time) => {
  e.perf.energyMode = 'off';
  for (let i = 0; i < 5; i++) { time(i); e._tick(); }
  assert.equal(e.work, 5); assert.equal(e._continuousRenderInterval(), 41);
  assert.equal(e._renderCadenceDue(5), false);
  e.setViewport({ visible: false }); time(6); e._tick(); assert.equal(e.work, 5);
}));

test('diagnostics remain serializable and disposal removes every added listener', () => withEnvironment((e) => {
  e._tick(); assert.equal(e.getPerfDiagnostics().existing, true);
  assert.equal(JSON.parse(JSON.stringify(e.getClientSnapshot())).energy.targetFps, 60);
  e.dispose(); e.dispose();
  assert.equal(e.canvas.listenerCount, 0);
  assert.equal(globalThis.document.listenerCount, 0);
  assert.equal(globalThis.window.listenerCount, 0);
  e._tick(); assert.equal(e.work, 1);
}));


test('energy controls notify/persist without rebuilding graphics; other settings still delegate', () => withEnvironment((e) => {
  const applies = e.performanceApplies;
  e.setPerfSetting('energyMode', 'eco');
  assert.equal(e.perf.energyMode, 'eco');
  assert.equal(e.notifiedPerf.energyMode, 'eco');
  assert.equal(e.performanceApplies, applies);
  e.setPerfSetting('energyMaxFps', 9000);
  assert.equal(e.perf.energyMaxFps, 60);
  e.setPerfSetting('renderScale', 0.75);
  assert.deepEqual(e.delegatedSetting, { key: 'renderScale', value: 0.75 });
}));

test('reset/history without extension keys restores energy defaults', () => withEnvironment((e) => {
  e.perf = { renderScale: 0.75 }; e._applyPerformance();
  assert.equal(e.perf.energyMode, 'balanced');
  assert.equal(e.perf.energyMaxFps, 60);
  assert.equal(e.perf.renderScale, 0.75);
}));
