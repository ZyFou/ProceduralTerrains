# Spatial upscaler experiment

Independent branch based on develop. No dynamic-FPS/energy-scheduling changes.

## Controls

Performance > Spatial Upscaler (Experimental):

- Off (default): uses the existing Resolution Reconstruction selection.
- Bilinear: a cheap comparison baseline at the same scene render scale.
- Spatial + Adaptive Sharpness: five bilinear samples, local-contrast attenuation
  and neighbourhood clamping. Sharpness is adjustable from 0 to 1 (default 0.35).
  At zero it is equivalent to bilinear sampling.

Set Scene Render Scale to 0.75 to start. 0.75 squared = 56.25% of native scene
pixels before reconstruction, not a measured 43.75% reduction in GPU power.
The HTML interface is untouched. Native/supersampled scene sizes bypass the new
filter. Artistic Pixelated and Pixelated Denoise take precedence; switch the
latter to Clean Denoise when testing the spatial filter.

The algorithm is original, spatial and single-frame: it is not FSR, DLSS, AI,
frame generation or a temporal reconstruction. It sharpens interpolated detail;
it cannot recover missing information. Fine foliage, distant geometry, moving
water and clouds can still shimmer or lose detail at low render scales.

## Integration

The filter is fused into the existing full-resolution camera pass, after the
existing look pass. No extra render targets, history, depth dependency or colour
conversion are introduced. Half-texel clamping keeps edge samples inside the
source image. Sharpening is bounded by the local sample colour range.

resolveCameraReconstruction is the shared authority for GLSL defines, uniforms,
and diagnostics. This also fixes the pre-existing comparison against a nonexistent
plan.reconstructionMode, which had left Clean Denoise compiled out; performance
Pixelated Denoise now selects its shader variant too. Because Off uses the repaired
Clean filter, use Bilinear for a comparison with the old effective linear path.

The new settings are normalized in PerformanceSettings, ensuring they exist for
Engine.setPerfSetting's key guard on new/old saves and resets. The experiment's
UI changes are also saved on the main thread so worker mode does not require the
separate energy PR's persistence fix. Reset restores the default opt-out.

The shared PerfSettings wrapper/QualitySettingsContent extraction is identical to
the energy PR. The rendering implementations do not depend on each other.

## Validation

```sh
node --test tests/spatial-upscaler.node.mjs
npm test
npm run build
```

The dependency-free suite tests selection, shader defines/uniform agreement,
pixel-art priority, render-target reuse, zero sharpness, setting migration and
cached presentation. The real camera-pass code runs against small Three-shaped
test doubles for orchestration tests; these are not GPU/driver tests.

With the Vite development server running, open
`/tests/spatial-upscaler.webgl.html`. The browser smoke test compiles 64 actual
camera-shader variants across WebGL1/WebGL2, renders synthetic constant/pattern
images, checks the zero-sharpness baseline and bounded output. A missing context
is a failure, not a silently skipped test. The implementation environment could
not create a WebGL context, so this browser check remains to be run on hardware.

## Manual A/B test

1. Keep the same terrain, camera, window size and device pixel ratio. Let shaders
   finish compiling. Turn Auto Performance off so it cannot change the internal
   resolution/cloud quality during comparison.
2. Compare native scale 1.0 with scale 0.75. At 0.75 compare Bilinear, Spatial and
   Off/Clean; start at sharpness 0.35, then inspect 0 and 1.
3. Inspect slopes, coastlines, vegetation and distant silhouettes both stationary
   and moving. Check edges, underwater, cloud depth composition, and transitions
   between Tile, Infinite and Planet.
4. Test CRT, chromatic aberration and dithering; spatial mode must not switch the
   dither coordinates to a pixel-art grid. Verify artistic pixelation overrides it.
5. Resize, toggle worker rendering (reload), save/reload, reset and export a
   screenshot. Compare GPU time and Energy Impact with a stable FPS cap when
   evaluating heat, otherwise higher FPS can spend the saved rendering budget.

No Mac thermal, power or image-quality gain has been measured for this PR.
