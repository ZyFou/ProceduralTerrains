// ============================================================================
// Shared wind state for animated props (grass, flowers, reeds, bushes…).
//
// One uniform block is shared across every wind material so a single per-frame
// uTime tick animates them all. Heavy props (rocks, crystals, cactus) simply do
// not use a wind material, so they never move.
//
// The displacement runs in the vertex shader (see GrassMaterial.js): the
// per-vertex `aBend` attribute (0 at the rooted base → 1 at the tip) scales the
// sway so the base stays glued to the terrain while the top bends — props never
// detach from the ground.
// ============================================================================

import * as THREE from 'three';

export function createWindUniforms() {
  const dir = new THREE.Vector2(1.0, 0.35).normalize();
  return {
    uTime: { value: 0 },
    uWindDir: { value: dir },          // normalized world-XZ direction
    uWindStrength: { value: 0.22 },    // local-space sway amplitude (× bend × scale)
    uWindSpeed: { value: 1.6 },        // oscillation speed
    uGustScale: { value: 0.012 },      // spatial frequency of gusts (per world unit)
    uGustIntensity: { value: 0.45 },   // secondary gust amplitude
  };
}

// Vertex-shader uniform declarations injected ahead of main().
export const WIND_VERT_DECL = /* glsl */ `
attribute float aBend;
uniform float uTime;
uniform vec2  uWindDir;
uniform float uWindStrength;
uniform float uWindSpeed;
uniform float uGustScale;
uniform float uGustIntensity;
uniform float uWindStrengthMul;
`;

// Displacement injected right after <begin_vertex> (transformed == local pos).
// Phase derives from the instance's world XZ (instanceMatrix col 3) so adjacent
// props sway coherently like a field, not independently.
export const WIND_VERT_BODY = /* glsl */ `
{
  #ifdef USE_INSTANCING
    vec2 iw = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
  #else
    vec2 iw = vec2(0.0);
  #endif
  float phase = dot(iw, vec2(1.0)) * uGustScale * 6.2831;
  float sway = sin(uTime * uWindSpeed + phase);
  float gust = sin(uTime * uWindSpeed * 0.37 + phase * 0.5) * uGustIntensity;
  float bend = pow(clamp(aBend, 0.0, 1.0), 1.5);
  float amt = (sway + gust) * uWindStrength * uWindStrengthMul * bend;
  transformed.x += uWindDir.x * amt;
  transformed.z += uWindDir.y * amt;
}
`;
