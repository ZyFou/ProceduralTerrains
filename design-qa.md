# Editor shortcut menus — design QA

## Evidence

- Source visual truth: `/var/folders/p4/2wybsmsn2xn2_0msnyqy_wlr0000gn/T/TemporaryItems/NSIRD_screencaptureui_jeZgJP/Capture d’écran 2026-07-22 à 22.05.40.png`
- Browser-rendered implementation: `/private/tmp/terrain-shortcuts-file-menu-351.png`
- Full-view comparison: `/private/tmp/terrain-shortcuts-comparison-normalized.png`
- Focused menu comparison: `/private/tmp/terrain-shortcuts-focus-comparison.png`
- Edit-menu capture: `/private/tmp/terrain-shortcuts-edit-menu-351.png`
- Browser viewport: 351 × 220 CSS px, Codex in-app browser, macOS platform.
- Source dimensions: 702 × 440 px. The source was normalized to 351 × 220 px to account for its inferred 2× capture density.
- Implementation dimensions: 351 × 220 px at device scale factor 1. The normalized source and implementation therefore compare at the same CSS size.
- State: procedural terrain editor, dark theme, File dropdown open. The Edit dropdown was captured separately because it was not present in the source image.

## Findings

- P0: none.
- P1: none.
- P2: none.

The File menu preserves the source typography, row height, icon scale, divider rhythm, dark palette, border, radius, and elevation. Its width intentionally grows from 169 px in the normalized source to 238 px so the new right-aligned shortcut column remains readable, including the longer Projects shortcut.

The visible macOS modifier is the Command icon rather than the text `Cmd`. Shortcut copy is aligned consistently for New terrain, Projects, Save, Load, Download, Settings, Random seed, and Paint mode. Windows `Ctrl + key` formatting is covered by the shortcut utility tests.

### Required fidelity surfaces

- Fonts and typography: existing editor font family, 12 px menu labels, 10 px monospace shortcut labels, weights, line height, and antialiasing are preserved.
- Spacing and layout rhythm: menu y-position, 31–32 px rows, icon/text gap, divider placement, padding, radius, and shadow match the existing menu. The extra width is required by the new content.
- Colors and visual tokens: existing panel, border, muted text, hover, active, and accent tokens are reused without introducing a parallel palette.
- Image quality and asset fidelity: no new raster imagery is required. Existing app icons remain vector icons from the project's established icon library; the Command modifier uses its matching library icon.
- Copy and content: requested File and Edit actions are present, with `New` clarified to `New terrain` and `Randomize seed` aligned to the requested `Random seed` wording.

## Interaction and browser checks

- Opened both File and Edit dropdowns and confirmed all shortcut hints are visible and right-aligned.
- Triggered Settings with Command + comma and confirmed the UI settings dialog opened.
- Confirmed accessible menu names expose the full shortcut meaning, such as `Command + N` and `Command + Shift + O`.
- Confirmed the settings-search badge also uses the platform-aware Command icon treatment.
- Browser console errors checked: none.
- Production build passed.
- Full test suite passed: 16 files, 189 tests.

## Comparison history

- Pass 1: no actionable P0, P1, or P2 differences were found in the requested menu region. No visual correction loop was required. The wider dropdown is an intentional accommodation for the added shortcut column, not design drift.

## Implementation checklist

- [x] Platform-aware shortcut definitions shared by display and event matching.
- [x] File and Edit shortcuts visible in their dropdowns.
- [x] macOS Command icon and Windows Ctrl formatting.
- [x] Global keyboard actions connected to existing editor commands.
- [x] Browser interaction, visual comparison, build, and tests verified.

## Follow-up polish

- None required for this scope.

final result: passed
