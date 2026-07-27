# Water Visual Baselines

Phase 0 adds a repeatable before/after capture set for the flat procedural water
renderer. It does not change the final water shading.

## Capture workflow

1. Open **Water → Debug**.
2. Select a **Visual Baseline Scene**.
3. Click **Load Baseline Scene** and wait until the status returns to Ready.
4. Keep **Water Debug View** on Off for the beauty capture.
5. Click **Capture PNG + Metrics (.zip)**.
6. Repeat the same scene with the diagnostic views that matter to the change.

Each ZIP contains a PNG and a JSON report with:

- fixed scene, camera, time-of-day, terrain preset, and water preset identifiers;
- FPS and average CPU frame time;
- whole-frame GPU time when the browser exposes timer queries;
- draw calls and triangle count;
- last measured water shader synchronous compile and asynchronous wait time;
- renderer/GPU capabilities and the water parameters used for the capture.

Run the full set separately on each target GPU. The detected renderer is stored
in the JSON, so RTX 5060 Ti and Quadro P2200 captures can be compared without
renaming report fields by hand.

## Reference set

| ID | Scene | Mode |
| --- | --- | --- |
| 1 | Deep Ocean — Midday | Tile |
| 2 | Deep Ocean — Sunset | Tile |
| 3 | Shallow Tropical Coast | Tile |
| 4 | Mountain Lake | Tile |
| 5 | Infinite World — Grazing | Infinite |
| 6A | Surface Transition — Above | Tile |
| 6B | Surface Transition — Below | Tile |

## Diagnostic views

The original Depth, Shoreline, Foam, and Water Mask views remain available.
Phase 0 adds Surface Normal, Optical Depth, Transmittance, Fresnel, Reflection
Term, Refraction Term, and Final Opacity.

The new views intentionally display the current V1 approximations. For example,
Transmittance exposes the scalar absorption currently used by the shader, and
Reflection Term exposes the fixed blue-grey Fresnel contribution. Phase 1 can
therefore replace those models while preserving a direct visual comparison.
