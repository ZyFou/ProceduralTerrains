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
