# Terrain Studio — Architecture Roadmap (2026–2031)

Written 2026-07-02 against v0.14.1 (~166 src files, ~30k+ LOC, three.js 0.160,
React 18, Vite 5, plain JS, WebGL/GLSL1).

## 1. Where the codebase actually is

Strengths worth preserving (do not "rewrite away" these):

- **Clean UI/engine seam.** `App.jsx` is the only UI↔engine bridge; `Engine.js`
  is explicitly framework-agnostic with a documented `callbacks` contract.
- **Subsystems are already modular** under `src/engine/{terrain,water,sky,props,
  render,player,style,perf}/` — the coupling problem is concentrated, not smeared.
- **Serialization discipline exists.** Plain-JSON data models with explicit
  migrations (`migrateStack`, `migrateWaterParams`) and version fields.
- **Shader codegen is half an IR already.** `noiseStackCodegen` compiles a typed
  layer stack into GLSL — retargeting that generator is far cheaper than
  retargeting hand-written shaders.
- **WebGPU is already probed** (`RendererCapabilities.js` has a
  `'webgpu'` backend enum + support detection) — the flag exists, only WebGL
  is implemented behind it.
- Workers (erosion), GPU profiler, quality tiers, boot-time shader staging —
  real engineering, not prototype code.

Scalability bottlenecks, in order of actual pain:

1. **`Engine.js` god object** — 5,476 lines, 46 imports, ~257 methods. Every
   feature merges through one file: merge conflicts, no ownership boundaries,
   impossible to test in isolation. This, not WebGL, is the 5-year limiter.
2. **Zero automated tests** (until now — see Phase 0). Any migration story is
   fiction without a safety net.
3. **Schema-less flat `params` object.** Symptoms already visible: hand-
   maintained reset-key lists (`panelResets.js`), a hand-maintained search
   index (`settingsSearch.js`), migration code scattered per-system. Every new
   setting is edited in 3–4 places.
4. **Three world modes (Tile / Infinite / Planet) are parallel implementations**
   — per-mode materials, samplers, exporters, cloud layers, controllers.
   Roughly 3× the maintenance per feature.
5. **Plain JS at 30k+ LOC.** Refactors rely on grep and hope.
6. **three.js pinned at 0.160** — predates the mature WebGPURenderer/TSL line;
   the longer it sits, the wider the upgrade gap.

## 2. Honest verdict on the requested pillars

| Requested | Verdict | What we do instead / when |
|---|---|---|
| WebGPU-first | **Not first — WebGPU-ready.** The GLSL1 estate is a deliberate compat choice (ANGLE/FXC issues are documented in PERFORMANCE.md history). A rewrite-first approach forfeits the current user base for zero visible gain. | Backend seam in Phase 2, pilot backend in Phase 4, flip default only when user GPU telemetry justifies it. |
| ECS | **Wrong tool for this engine.** The scene holds dozens of coarse systems, not 10⁴ heterogeneous entities; the hot loop is GPU-side. Full ECS is migration cost with no cache-locality payoff. | **Systems architecture**: decompose Engine.js into lifecycle-managed systems over a shared context (Phase 1). If procedural props ever need per-entity gameplay at scale, add a scoped ECS for props only. |
| Plugin support | **Yes — mid-term, and cheap once Phases 1–2 exist.** | Settings-schema registry (Phase 1) + system registration (Phase 3) *is* the plugin API. |
| Async asset streaming | **Partially exists** (chunk streaming in InfiniteWorld/PlanetCloudChunks; assets are mostly procedural). Surface-texture atlases are the first real binary assets. | Small ref-counted async AssetManager in Phase 3, feeding existing streamers. |
| GPU-driven rendering | **Capped by WebGL2** (no compute, no indirect draw). Chunk-merge + macro-proxy LOD already does the WebGL-feasible part. | Becomes the flagship payoff of the WebGPU backend (Phase 4), not a prerequisite. |
| AAA terrain | **Yes, as a feature backlog on top of the platform work**, not an architecture. | Phase 5 list below. |

## 3. Phases

Rule for every phase: ship from `develop` continuously; saved projects/presets
from any prior version must load bit-identically (extend the existing
`migrate*` pattern + characterization tests).

### Phase 0 — Safety net (weeks) ← STARTED 2026-07-02
- ✅ Vitest wired up (`npm test`); characterization tests pin the NoiseStack
  save-compat contract (`tests/NoiseStack.test.js`).
- Next targets, in order: `migrateWaterParams`, `panelResets` key lists,
  `noiseStackCodegen` GLSL snapshot tests, preset load/save round-trips,
  exporter output hashes.
- Add `// @ts-check` + JSDoc types on new/touched files (gradual, no build change).
- CI: run vitest + `vite build` on push.

### Phase 1 — Decompose the god object (months 1–4)
- Introduce `EngineContext` (renderer, scene, clock, params store, event bus)
  and a `System` lifecycle (`init/update/resize/dispose/serialize`).
- Extract systems from Engine.js one at a time, leaf-first (sky → water →
  props → clouds → terrain last). Engine.js shrinks to a composition root;
  the App.jsx-facing API stays byte-compatible.
- Replace the flat params blob with a **typed settings schema registry**
  (key, type, default, range, panel, resettable-group, searchable label).
  Auto-generate from it: reset lists, the Ctrl+K search index, persistence,
  and migration scaffolding. Deletes `panelResets.js` + `settingsSearch.js`
  as hand-maintained artifacts.
- Exit criteria: no file >1,500 lines; every system constructible headless.

### Phase 2 — Renderer seam + three.js catch-up (months 4–8)
- All material/texture/render-target creation goes through a backend factory
  (`render/backend/`). WebGL implementation = current code, moved.
- Upgrade three.js stepwise (r160 → r16x → current), one minor at a time,
  gated by screenshot-diff tests (the existing .cjs screenshot receiver
  becomes a visual-regression harness).
- Retarget `noiseStackCodegen` to emit through a thin shader-IR layer
  (GLSL1 today; WGSL later is a second emitter, not a rewrite).

### Phase 3 — Unify worlds + assets + plugin API v1 (months 8–14)
- One streaming quadtree/clipmap driver parameterized by a surface mapping
  (flat board / infinite plane / cube-sphere) replaces the three parallel
  mode implementations. Biggest dedup win in the codebase.
- Ref-counted async `AssetManager` (fetch, decode, GPU-upload queues with
  priorities) for texture atlases, imported heightmaps, future prop meshes.
- Plugin API v1 = register(settings schema, system, panel section, exporter).
  First-party features (erosion, surface textures) become the proving plugins.

### Phase 4 — WebGPU backend (year 2+)
- Implement the `'webgpu'` backend behind the existing capability flag.
  Pilot on the most compute-hungry isolated system (clouds or erosion).
  - ✅ PILOT LANDED EARLY (2026-07-02): `erosionWebGPU.js` — WGSL compute
    erosion behind `erosionBackend: 'auto'` with automatic CPU-worker
    fallback. Pure compute→readback, so it required none of the Phase 2/3
    rendering prerequisites. Bit-deterministic per device, ~2–3× faster.
    The *rendering* payoffs below still require Phases 2–3.
- Then the payoffs WebGL can't do: compute-based erosion at interactive
  rates, GPU-driven culling + indirect draws for chunks/props, virtual
  texturing feedback pass.
- WebGL backend remains the fallback indefinitely; per-system backend choice.

### Phase 5 — AAA terrain backlog (ongoing, on top of the platform)
- Virtual texturing for surface atlases; erosion→normal/AO/flow baking;
  hierarchical height caches for exact CPU collision; GPU vegetation
  scattering; photo-mode path (TAA/high-quality capture); marketplace-able
  plugin presets.

## 4. What we explicitly refuse to do
- Big-bang rewrite, repo split, or framework change. React+Vite is not a
  bottleneck; the UI seam is already correct.
- TypeScript flag-day conversion (gradual @ts-check only).
- Dropping GLSL1/WebGL support while users are on it.
