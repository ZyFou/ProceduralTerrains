# Plugin anchor and heading alignment — Design QA

- Source visual truth (Blender): `C:\Users\G11D8~1.BON\AppData\Local\Temp\codex-clipboard-2dc45324-f873-473d-83c6-0f07e0eb64d0.png`
- Source visual truth (Unity): `C:\Users\G11D8~1.BON\AppData\Local\Temp\codex-clipboard-f301042e-ef41-4e19-92c6-be41ede94cf6.png`
- Unity implementation: `C:\Users\g.bondenet\Documents\ThreeTerrain\output\playwright\plugins-unity-import-anchor-fixed.png`
- Blender implementation: `C:\Users\g.bondenet\Documents\ThreeTerrain\output\playwright\plugins-blender-anchor-fixed.png`
- Blender hover implementation: `C:\Users\g.bondenet\Documents\ThreeTerrain\output\playwright\plugins-blender-hover-orange-fixed.png`
- Mobile implementation: `C:\Users\g.bondenet\Documents\ThreeTerrain\output\playwright\plugins-blender-mobile-anchor-fixed.png`
- Combined comparison: `C:\Users\g.bondenet\Documents\ThreeTerrain\output\playwright\plugins-anchor-design-comparison.png`
- Viewports: 1280 × 720 CSS px desktop and 390 × 844 CSS px mobile at 1× density
- Source pixels: 1177 × 461 Blender and 1537 × 570 Unity
- State: public plugin documentation route, Unity and Blender import/install anchors reached through their quick links, logged out, dark theme

## Full-view comparison evidence

The comparison focuses on the two requested regressions while retaining the site's existing direction. Both engine pages keep the same black canvas, sticky engine switcher, compact typography, panel borders, blue/orange accent mapping, and long-form documentation layout. The revised headings remain within the original two-column documentation grid and introduce no horizontal overflow at desktop or mobile widths.

## Focused region comparison evidence

- Unity import anchor: the sticky tab header ends at y=129 px and the section aside starts at y=236.38 px, leaving 107.38 px of visible clearance. The title icon starts 2 px below the heading top, so the icon and copy read as one horizontal heading.
- Blender build anchor: the sticky tab header ends at y=129 px and the section aside starts at y=235.97 px, leaving 106.97 px of visible clearance. The icon-to-heading offset is 2 px.
- Blender primary-button hover: the focused implementation capture shows the download CTA retaining the Blender orange treatment while becoming darker on hover, matching Unity's interaction logic. Browser-computed hover values are `rgb(184, 90, 34)` for both background and border, with an orange shadow; all three Blender primary buttons use the same verified selector.
- Mobile Blender install anchor: the tab header ends at y=122 px and the target section begins at y=144.06 px. The heading icon remains inline with a 2 px optical offset and the page has no horizontal overflow.

## Required fidelity surfaces

- Typography: existing sizes, weights, wrapping, and muted body-copy treatment are unchanged.
- Spacing: anchor clearance is now driven by the shared sticky-header clearance token; section rhythm and content-card spacing remain unchanged.
- Colors: Unity blue and Blender orange icon treatments remain intact.
- Icons: existing Lucide icons are reused and rendered inline with the heading text.
- Copy: installation and usage text is unchanged.

## Interaction and runtime checks

- Confirmed Unity and Blender quick links scroll to the intended sections without placing the heading under the sticky engine tabs.
- Confirmed desktop and 390 px mobile layouts have no horizontal overflow.
- Confirmed the Unity/Blender tab switch still works after anchor navigation.
- Confirmed all three Blender primary buttons resolve to orange hover styling; the hero, inline installation, and final CTA buttons were each tested in the browser.
- Browser console warnings/errors: none.
- Production build: passed; only the existing chunk-size advisory remains.

## Comparison history

1. Source screenshots showed a P2 anchor-offset issue: target headings could settle beneath the sticky engine tabs, hiding the section icon. A shared 88 px sticky clearance now drives both `scroll-margin-top` and the desktop sticky aside offset. Post-fix measurements leave more than 106 px between the tab edge and the anchored aside on both desktop engine pages.
2. Source screenshots showed a P2 hierarchy issue: the section icon sat above the title. Each documentation heading now uses a two-column icon/text grid. Post-fix screenshots show a consistent 2 px optical vertical offset on Unity, Blender, and mobile.
3. A later interaction pass found a P2 cascade issue: the shared blue `.lp-primary:hover:not(:disabled)` rule appeared after the Blender override and won at equal specificity. The Blender selector now includes `:not(:disabled)` and adds an orange hover shadow. A follow-up corrected the interaction direction to match Unity: the orange changes from `rgb(211, 107, 41)` to the darker `rgb(184, 90, 34)` instead of becoming brighter. Post-fix browser checks show all three primary buttons using the intended darker orange hover, with no console warnings or errors.

## Findings

No actionable P0, P1, or P2 issues remain for the requested scope.

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
