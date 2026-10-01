# Energy saving / dynamic FPS (independent experiment)

Based on `develop`; no upscaling or spatial-quality changes are included.

Open Performance > Energy & Frame Rate. Balanced is the default: up to 60 FPS
while interacting and 30 FPS after 1.5 seconds idle. The active ceiling can be
30/60/90/120 FPS. Eco uses up to 30 FPS active / 24 FPS idle. Off restores the
legacy cadence (the visibility fixes remain enabled). These are ceilings, not
guaranteed frame rates. They apply to all GPU tiers, including Apple Silicon.

## Implementation

Both main-thread and worker transports instantiate the explicit EnergySavingEngine
adapter. Frame admission happens before the regular engine tick, not only before
renderer.render(), so skipped frames also skip the normal props, cloud, LOD and
streaming updates. Fractional deadlines avoid cadence drift on 90/120/144/165-Hz
displays. Input transitions wake an idle viewport immediately but repeated input
does not defeat the active ceiling. Exploration/held keys/dragging/inertia use
the active ceiling. Boot, compilation, mode transitions and exports retain their
existing scheduling; Debug > Force Render bypasses pacing while visible.

Animated scenes continue at the idle rate. This version intentionally does not
freeze ambient animations or introduce a cached static colour/depth scene. A
static Tile scene still benefits from Engine's existing on-demand redraw and
approximately 1-Hz invalidation safety heartbeat. The lightweight animation-loop
callback remains registered; it exits before expensive work on rejected ticks.

The worker stores forwarded visibility independently of its DOM facade. Repeated
visible input packets no longer call the base visibility handler and reset the
animation clock. A hidden-to-visible transition discards accumulated time and
resets the FPS measurement window. Held worker keys are released on hiding.

Intentional idle FPS do not trigger automatic quality downgrades or upgrades.
Active sub-60-FPS ceilings are normalized only inside the legacy quality check;
the HUD retains real rendered FPS. Energy settings use existing performance
snapshots/persistence and do not rebuild geometry when changed. Worker performance
notifications are persisted on the main thread, where localStorage is available.

The former PerfSettings content is moved byte-for-byte to QualitySettingsContent.
A small shared wrapper discovers each feature's controls through Vite's eager
module glob. This identical extraction can be shared by the independent upscaler
PR without coupling either renderer implementation to the other.

## Automated checks

```sh
node --test tests/energy-saving.node.mjs
npm test
npm run build
```

The dependency-free Node suite tests policy, display cadence, worker/main-thread
visibility, wake-up, clock handling, setting normalization, quality safeguards,
and disposal using a mock base engine. It does not replace the full Vitest suite
or a WebGL end-to-end test. No dependency additions are required.

## Manual comparison

1. Use the same saved terrain, camera, render scale and quality. Wait for boot and
   compilation to settle; do not benchmark initial shader compilation.
2. Compare Off, Balanced and Eco while orbiting, after 2 seconds idle with animated
   water/clouds, and with a fully static Tile scene. Check the real FPS counter.
3. Repeat in Infinite/Planet, walking/plane exploration and while dragging/sculpting.
   Changing only an energy setting must not rebuild terrain or change image quality.
4. Hide the tab for 20 seconds, return, then repeat with Worker Renderer disabled
   (reload required). Check instant wake, released keys and no time jump. In worker
   mode, drag continuously and confirm animations no longer repeatedly reset time.
5. Reset performance settings and reload; check defaults and persistence. Test a
   resize, loading a real-world terrain, export, context recovery and mode changes.
6. On macOS compare Activity Monitor's GPU/Energy readings over equivalent settled
   intervals. No temperature or wattage improvement is claimed without hardware
   measurement. Separate this experiment from render-scale/upscaler comparisons.

Diagnostics from getPerfDiagnostics()/getClientSnapshot() include `energy` with
state, targetFps, acceptedTicks and skippedTicks. Null targetFps means unlimited.
