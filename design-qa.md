# Real Terrain World Settings — Design QA

- Source visual truth: `/Users/gaetan/Desktop/Capture d’écran 2026-08-06 à 09.53.04.png`
- Implementation screenshot: `/Users/gaetan/Desktop/Projects/ProceduralTerrains/output/playwright/real-terrain-3d-world-size.jpg`
- Viewport: 1119 × 687 CSS px
- Source pixels: 2238 × 1374 (2× desktop capture; normalized to 1119 × 687 CSS px)
- Implementation pixels: 1119 × 687 at the matched CSS viewport
- State: Real Terrain creation dialog open, default Alpine selection, 3D world size 2048 × 2048 units, geographic area size 30 km, terrain detail z12

## Full-view comparison evidence

The implementation preserves the source dialog frame, header, map/sidebar split, map controls, search placement, selection rectangle, statistics, attribution, and primary action. The requested hierarchy is added in the existing sidebar: a subtle `World settings` card contains a simplified `3D world size` selector. Geographic `Area size` and `Terrain detail` remain separate import controls. The selected location differs from the source capture, but this does not affect layout comparison.

## Focused region comparison evidence

The sidebar is readable in the matched full-view capture, so a separate crop was not needed. The new card uses the product's existing border, radius, background, uppercase section-label, spacing, and typography tokens. `3D world size` exposes the final scene dimensions while the compact note communicates the underlying chunk count and chunk size. Geographic controls and statistics remain visible without overflow.

## Required fidelity surfaces

- Fonts and typography: Existing application font families, weights, small-label casing, monospace values, line heights, and hierarchy are preserved.
- Spacing and layout rhythm: The 16 px sidebar rhythm is maintained; the new settings card uses 12 px padding and does not crowd or hide persistent controls.
- Colors and visual tokens: Existing panel, control, border, muted-text, and accent tokens are reused; contrast remains consistent with the source.
- Image quality and asset fidelity: The existing Leaflet/Esri imagery and Lucide interface icons remain unchanged and render sharply.
- Copy and content: `3D world size` is clearly distinguished from geographic `Area size`. Existing terrain statistics and the load action remain unchanged.

## Interaction and runtime checks

- Opened Create terrain → Real Terrain → location dialog.
- Verified the `World settings` heading and `3D world size` selector are exposed semantically.
- Changed the 3D world preset from 2048 × 2048 to 4096 × 4096 units and confirmed the underlying chunk size changed from 128 to 256 while the dialog remained open.
- Browser console errors: none.
- Production build: passed.
- Automated tests: 415 passed.

## Findings

No actionable P0, P1, or P2 differences remain. The additional card is an intentional product change requested from the source state.

## Comparison history

The first pass incorrectly treated geographic area size as world size. After the user's clarification, that P1 semantic mismatch was fixed by restoring `Area size` and adding a separate 3D scene-size selector derived from `chunk count × chunk size`. The second matched-viewport pass confirms the two concepts are distinct, readable, and fully visible.

## Follow-up polish

No P3 follow-up is required for this scoped change.

final result: passed

---

# Props Viewer Design QA

- Source visual truth: `/var/folders/p4/2wybsmsn2xn2_0msnyqy_wlr0000gn/T/TemporaryItems/NSIRD_screencaptureui_03AcDL/Capture d’écran 2026-08-15 à 19.03.07.png`
- Saved source: `output/playwright/props-viewer-reference.png`
- Normalized source: `output/playwright/props-viewer-reference-normalized.png`
- Final implementation crop: `output/playwright/props-viewer-implementation.jpg`
- Full browser capture: `output/playwright/props-viewer-full.jpg`
- Browser viewport: 1280 × 720 CSS px at device scale 1
- Source pixels: 684 × 908 at 2× density; normalized to 342 × 454
- Implementation comparison crop: 340 × 454 at 1× density
- State: dark Props drawer, Asset Library selected, Oak Tree selected, preview rotation reset

## Full-view comparison evidence

The full capture confirms that the revised library remains within the existing Props drawer, preserves the two-column asset layout, and does not obscure the terrain viewport or persistent editor controls.

## Focused comparison evidence

The normalized source and final drawer crop were inspected together. The focused comparison was required because icon treatment, prop framing, and the rotation affordance are too small to judge reliably in the full editor screenshot.

## Required fidelity surfaces

- Fonts and typography: existing product font, weights, truncation, and hierarchy are preserved.
- Spacing and layout rhythm: the two-column cards and viewer remain aligned with the existing drawer spacing; the larger model stays inside the preview frame.
- Colors and visual tokens: existing dark surfaces, blue selection state, semantic tint colors, borders, and radii are preserved.
- Image and asset fidelity: colored marker bars were replaced with vector icons from `lucide-react`; the preview continues to render the real terrain LOD geometry.
- Copy and content: the interaction hint now states that both vertical and horizontal drag are available.

## Findings

- No remaining P0, P1, or P2 findings.
- P3: extreme user-authored scale values can intentionally push a model close to the preview edge; the reset control and bounded pitch remain available.

## Comparison history

1. Initial reference finding: the tree occupied too little of the viewer, asset cards used ambiguous color bars, and drag only changed yaw.
   - Fix: introduced Lucide type icons, larger normalized model fitting, bounded pitch plus yaw, updated hint, and a Lucide reset control.
2. First rendered iteration: the ground rendered but the prop could disappear after React remounted the WebGL canvas.
   - Evidence: `output/playwright/props-viewer-iteration-1-missing-model.jpg`.
   - Fix: always install the current asset during canvas initialization.
3. Second rendered iteration: repeated asset fitting inherited the previous pivot scale and shrank the next model.
   - Fix: measure the model before parenting it to the scaled pivot.
   - Evidence: `output/playwright/props-viewer-iteration-2-sized.jpg` and the final implementation crop.
4. Interaction verification:
   - Vertical drag evidence: `output/playwright/props-viewer-vertical-rotation.jpg`.
   - Horizontal drag evidence: `output/playwright/props-viewer-horizontal-rotation.jpg`.
   - Reset button returned pitch and yaw to the neutral view.

## Primary interactions tested

- Select Oak Tree.
- Drag vertically to change X-axis pitch.
- Drag horizontally to change Y-axis yaw.
- Reset preview rotation.
- Checked browser console: no warnings or errors during the tested interactions.

## Implementation checklist

- [x] Lucide icons for every prop family
- [x] Larger, stable automatic prop framing
- [x] X- and Y-axis drag rotation
- [x] Bounded vertical rotation
- [x] Lucide reset control
- [x] Updated accessible interaction text

final result: passed
