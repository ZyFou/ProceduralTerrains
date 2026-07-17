# Procedural → Nodes Height Transition and Picker QA

## Evidence

- Source visual truth: `/var/folders/p4/2wybsmsn2xn2_0msnyqy_wlr0000gn/T/TemporaryItems/NSIRD_screencaptureui_kwom6s/Capture d’écran 2026-07-17 à 13.37.00.png`.
- Local implementation: `http://127.0.0.1:6061/`.
- Full browser-rendered implementation: `/Users/gaetan/.codex/visualizations/2026/07/17/019f6f9a-eb04-7290-a989-503cee696601/terrain-height-picker-qa/nodes-workspace-1280x1200.png`.
- Focused implementation region: `/Users/gaetan/.codex/visualizations/2026/07/17/019f6f9a-eb04-7290-a989-503cee696601/terrain-height-picker-qa/nodes-picker-focus.png`.
- Same-input source/implementation comparison: `/Users/gaetan/.codex/visualizations/2026/07/17/019f6f9a-eb04-7290-a989-503cee696601/terrain-height-picker-qa/nodes-picker-comparison.png`.
- Viewport: 1280×1200 for the visual picker comparison; 1280×800 for the Procedural → Nodes load sequence.
- State: a saved Mountain Range Procedural project was loaded first, followed immediately by a saved Alpine Ridges Nodes project. The Terrain Graph was expanded with its palette visible and the Terrain recipe group open.

## Full-view Comparison Evidence

The full implementation capture shows the loaded Alpine heightfield on the same frame as the active Terrain Graph. The terrain is visibly elevated on the first post-load frame, the saved graph is present, the status is Ready, and the right inspector remains stable. No flat-ground or floating-water intermediate frame was exposed during the browser-tested saved-project transition.

## Focused Comparison Evidence

The side-by-side comparison places the reported picker state and the revised implementation in one image. The implementation preserves the existing dark compact editor language while adding a persistent search control, total/result counts, click-to-add affordances, and a measured 10px gap between the 184px palette and the graph canvas. A focused region was required because the search field and palette-to-canvas gap are too small to judge reliably in the full editor capture.

## Findings

No actionable P0, P1, or P2 issues remain.

- Fonts and typography: the picker continues to use the product’s compact UI and mono hierarchy, with readable category labels, node labels, counts, and shortcut hints. Search placeholder text is visually subordinate without becoming illegible.
- Spacing and layout rhythm: the picker has a 10px outer inset and a separate 10px right-side canvas gap. Search, sections, rows, and footer follow the existing 5–10px density scale; no content collides with the graph.
- Colors and tokens: existing graphite surfaces, subtle borders, muted text, category dots, and blue active accents are reused. Focus uses the established active-border token.
- Image quality and asset fidelity: no raster assets were introduced into the product UI. Existing Lucide icons remain crisp and consistent at the compact scale.
- Copy and content: “Find a node…”, live result counts, and “all nodes” describe the picker behavior directly. Category names and node descriptions remain unchanged.
- Icons and affordances: Search, clear, collapse, and plus icons align with their controls. A single click on a palette row now adds the node; drag-to-place remains available.
- Accessibility: the filter has an explicit accessible name, clear control, visible focus state, semantic textbox, and keyboard-compatible buttons. The existing Shift+A global search remains documented.
- Viewport resilience: the picker width uses dock variables and narrows at the existing 821–1179px desktop breakpoint; the palette-to-canvas gap remains explicit at both widths.
- State synchronization: terrain and water height shaders now stay behind one atomic render gate, synchronize their compile-time octave define, and commit together. Superseded project compiles cannot overwrite the latest Nodes terrain.
- AI-shortcut review: no placeholder art, custom SVG, CSS illustration, decorative blob, or generic card treatment was added.

## Primary Interactions Tested

- Created a non-flat Mountain Range Procedural project and confirmed the terrain height rendered.
- Created an Alpine Ridges Nodes project immediately afterward and confirmed the non-flat graph height rendered on entry.
- Loaded the saved Mountain Range Procedural project, then loaded the saved Alpine Ridges Nodes project; the first visible Nodes frame was elevated and Ready.
- Switched the home template preview from Blank Graph Nodes to the Procedural Mountain Range; the background changed from a flat slab to elevated mountains before project creation, and the created editor terrain remained elevated.
- Reloaded with a saved Blank Nodes project as the newest recent project, confirmed its home preview was flat, then opened Templates and selected Procedural Mountain Range inside the delayed-preload race window; the gallery preview and created project both rendered full elevation.
- Filtered the picker with `mount`; the palette reduced to three relevant results and exposed a clear control.
- Clicked Mountain once in the picker; one disconnected Mountain node appeared in the graph and its settings opened in the inspector.
- Confirmed the picker’s left inset, right canvas gap, category scroll, and graph organization frame at 1280×1200.
- Checked browser warnings and errors after the full transition and interaction sequence; none were reported.

## Comparison History

- Pass 1: no P0/P1/P2 visual differences were found. The source’s cramped, edge-touching picker state is resolved by the visible search field and explicit palette-to-canvas gap. No visual fixes were required after the same-input comparison.

## Runtime Verification

- Automated tests: 136 passed across 12 test files, including both direction-specific height-transition regressions, the rapid out-of-order load case, and versioned procedural-template preview caching.
- Production build: passed. The existing Vite large-chunk advisory remains unchanged.
- Browser console: no errors or warnings.

final result: passed
