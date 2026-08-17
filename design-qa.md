# Plugin anchor and heading alignment — Design QA

- Source visual truth (Blender): `C:\Users\G11D8~1.BON\AppData\Local\Temp\codex-clipboard-2dc45324-f873-473d-83c6-0f07e0eb64d0.png`
- Source visual truth (Unity): `C:\Users\G11D8~1.BON\AppData\Local\Temp\codex-clipboard-f301042e-ef41-4e19-92c6-be41ede94cf6.png`
- Unity implementation: `C:\Users\g.bondenet\Documents\ThreeTerrain\output\playwright\plugins-unity-import-anchor-fixed.png`
- Blender implementation: `C:\Users\g.bondenet\Documents\ThreeTerrain\output\playwright\plugins-blender-anchor-fixed.png`
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
- Browser console warnings/errors: none.
- Production build: passed; only the existing chunk-size advisory remains.

## Comparison history

1. Source screenshots showed a P2 anchor-offset issue: target headings could settle beneath the sticky engine tabs, hiding the section icon. A shared 88 px sticky clearance now drives both `scroll-margin-top` and the desktop sticky aside offset. Post-fix measurements leave more than 106 px between the tab edge and the anchored aside on both desktop engine pages.
2. Source screenshots showed a P2 hierarchy issue: the section icon sat above the title. Each documentation heading now uses a two-column icon/text grid. Post-fix screenshots show a consistent 2 px optical vertical offset on Unity, Blender, and mobile.

## Findings

No actionable P0, P1, or P2 issues remain for the requested scope.

final result: passed
