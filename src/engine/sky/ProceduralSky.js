import * as THREE from 'three';

// ============================================================================
// ProceduralSky: a large inverted sphere with a procedural gradient shader.
// Features:
//   - Zenith → horizon gradient driven by configurable colors
//   - Sun disc with bright core + soft glow
//   - Horizon haze band blending with fog color
//   - All colors are uniforms, driven by TimeOfDay
//
// The sky mesh follows the camera position so it always surrounds the viewer.
// It renders behind everything (renderOrder = -1000, depthWrite = false).
// ============================================================================

const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  // Sky sphere follows the camera
  vec4 wp = vec4(position + cameraPosition, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  // Push to far plane
  gl_Position.z = gl_Position.w * 0.9999;
}
`;

const SKY_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3 uSkyZenith;      // color at the top of the sky
uniform vec3 uSkyHorizon;     // color at the horizon
uniform vec3 uSkySunColor;    // sun disc tint
uniform vec3 uSkyFogColor;    // fog/haze at the very bottom
uniform vec3 uSkySunDir;      // sun direction (shared with terrain)
uniform float uSkyLightIntensity;  // overall brightness scale
uniform float uSkyBrightness; // user brightness multiplier (Skybox tab)
uniform float uSkyHaze;       // horizon haze band strength (Skybox tab)
uniform float uSkyStars;      // 0/1 — render the night star field
uniform float uSkyHdrIntensity;
uniform float uSkySunGlow;
uniform float uSkyHorizonGlow;
uniform vec3  uSkyAtmosphereTint;

varying vec3 vDirection;

void main() {
  vec3 dir = normalize(vDirection);
  float y = dir.y;

  // ---- Sky gradient: zenith -> horizon -> below-horizon ----
  // Above horizon: smooth blend from zenith to horizon
  float horizonBlend = 1.0 - pow(max(y, 0.0), 0.45);
  vec3 skyCol = mix(uSkyZenith, uSkyHorizon, horizonBlend) * uSkyAtmosphereTint;

  // Horizon haze band: blend toward fog color near y ≈ 0
  float hazeBand = exp(-abs(y) * 8.0);
  skyCol = mix(skyCol, uSkyFogColor, hazeBand * uSkyHaze);

  // Below horizon: fade to fog color
  if (y < 0.0) {
    float belowBlend = clamp(-y * 5.0, 0.0, 1.0);
    skyCol = mix(skyCol, uSkyFogColor, belowBlend);
  }

  // ---- Sun disc ----
  float sunDot = max(dot(dir, normalize(uSkySunDir)), 0.0);

  // Hard core (small bright disc)
  float sunDisc = smoothstep(0.9994, 0.9998, sunDot);

  // Soft glow around the sun
  float sunGlow = pow(sunDot, 256.0) * 0.8;
  float sunHalo = pow(sunDot, 32.0) * 0.25;
  float sunScatter = pow(sunDot, 8.0) * 0.08;

  // Sun color with intensity
  vec3 sunCol = uSkySunColor * uSkyLightIntensity;
  skyCol += sunCol * (sunDisc * 3.0 + sunGlow + sunHalo * uSkySunGlow) * uSkySunGlow;

  // Scatter warm light around the sun at the horizon
  float scatterMask = exp(-abs(y) * 3.0);
  skyCol += uSkySunColor * sunScatter * scatterMask * uSkyLightIntensity;

  // Slight warmth at horizon on the sun side
  float horizonWarmth = pow(max(sunDot, 0.0), 4.0) * hazeBand * 0.3;
  skyCol += uSkySunColor * horizonWarmth * uSkyLightIntensity * (1.0 + uSkyHorizonGlow);
  skyCol += uSkyHorizon * hazeBand * uSkyHorizonGlow * 0.35;

  // ---- Night: add stars when sun is below horizon ----
  float nightFactor = smoothstep(0.15, -0.1, uSkySunDir.y) * uSkyStars;
  if (nightFactor > 0.01 && y > 0.0) {
    // Simple pseudo-random stars from direction.
    // Hash keeps intermediate values small so it stays stable on all GPUs
    // (sin-of-large-number hashes break down and band on ANGLE/mobile).
    vec3 starGrid = floor(dir * 300.0);
    vec3 p = fract(starGrid * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    float starHash = fract((p.x + p.y) * p.z);
    float star = step(0.998, starHash) * pow(max(y, 0.0), 0.3);
    // Twinkle using a second hash
    float twinkle = 0.7 + 0.3 * sin(starHash * 6283.0 + starGrid.x * 0.5);
    skyCol += vec3(0.8, 0.85, 1.0) * star * twinkle * nightFactor * 0.6;
  }

  // ---- User brightness ----
  skyCol *= uSkyBrightness * uSkyHdrIntensity;

  // ---- Gamma correction ----
  skyCol = pow(max(skyCol, vec3(0.0)), vec3(1.0 / 2.2));

  gl_FragColor = vec4(skyCol, 1.0);
}
`;

export class ProceduralSky {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;

    // Sky uniforms (independent from terrain — set by TimeOfDay)
    this.uniforms = {
      uSkyZenith:         { value: new THREE.Color(0.18, 0.35, 0.72) },
      uSkyHorizon:        { value: new THREE.Color(0.50, 0.62, 0.78) },
      uSkySunColor:       { value: new THREE.Color(1.0, 0.98, 0.92) },
      uSkyFogColor:       { value: new THREE.Color(0.55, 0.62, 0.75) },
      uSkySunDir:         { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
      uSkyLightIntensity: { value: 1.0 },
      uSkyBrightness:     { value: 1.0 },
      uSkyHaze:           { value: 0.55 },
      uSkyStars:          { value: 1.0 },
      uSkyHdrIntensity:   { value: 1.08 },
      uSkySunGlow:        { value: 1.0 },
      uSkyHorizonGlow:    { value: 0.35 },
      uSkyAtmosphereTint: { value: new THREE.Color(1.0, 0.98, 0.92) },
    };

    // Large inverted sphere
    const geometry = new THREE.IcosahedronGeometry(40000, 4);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /**
   * Update sky colors from a TimeOfDay evaluation result.
   * @param {Object} tod — result from evaluateTimeOfDay()
   */
  updateFromTimeOfDay(tod) {
    this.uniforms.uSkyZenith.value.setRGB(tod.zenith[0], tod.zenith[1], tod.zenith[2]);
    this.uniforms.uSkyHorizon.value.setRGB(tod.horizon[0], tod.horizon[1], tod.horizon[2]);
    this.uniforms.uSkySunColor.value.setRGB(tod.sunColor[0], tod.sunColor[1], tod.sunColor[2]);
    this.uniforms.uSkyFogColor.value.setRGB(tod.fogColor[0], tod.fogColor[1], tod.fogColor[2]);
    this.uniforms.uSkyLightIntensity.value = tod.lightIntensity;
  }

  /**
   * Apply the user-facing skybox appearance params (Skybox tab). Pure uniform
   * updates — never recompiles. Missing keys fall back to the defaults so this
   * is safe to call with a partial / legacy params object.
   * @param {Object} params — the engine params object
   */
  applyParams(params) {
    if (!params) return;
    this.uniforms.uSkyBrightness.value = params.skyboxBrightness ?? 1.0;
    this.uniforms.uSkyHaze.value = params.skyboxHaze ?? 0.55;
    this.uniforms.uSkyStars.value = params.skyboxStars === false ? 0.0 : 1.0;
    this.uniforms.uSkyHdrIntensity.value = params.visualsSkyIntensity ?? 1.08;
    this.uniforms.uSkySunGlow.value = params.visualsSunGlow ?? 1.0;
    this.uniforms.uSkyHorizonGlow.value = params.visualsHorizonGlow ?? 0.35;
    const tint = params.visualsAtmosphereTint ?? [1.0, 0.98, 0.92];
    this.uniforms.uSkyAtmosphereTint.value.setRGB(tint[0] ?? 1.0, tint[1] ?? 0.98, tint[2] ?? 0.92);
  }

  /**
   * Set the sun direction (shared with terrain uniforms).
   * @param {THREE.Vector3} dir
   */
  setSunDirection(dir) {
    this.uniforms.uSkySunDir.value.copy(dir);
  }

  /**
   * Show/hide the sky.
   */
  setVisible(visible) {
    this.mesh.visible = visible;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
