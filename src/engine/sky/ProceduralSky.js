import * as THREE from 'three';
import {
  createProceduralSkyUniforms,
  PROCEDURAL_SKY_EVALUATION_GLSL,
  PROCEDURAL_SKY_UNIFORMS_GLSL,
} from './proceduralSkyGLSL.js';

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

${PROCEDURAL_SKY_UNIFORMS_GLSL}
${PROCEDURAL_SKY_EVALUATION_GLSL}

varying vec3 vDirection;

void main() {
  vec3 skyCol = evaluateProceduralSkyLinear(normalize(vDirection), 1.0, 1.0);
  skyCol = pow(max(skyCol, vec3(0.0)), vec3(1.0 / 2.2));
  gl_FragColor = vec4(skyCol, 1.0);
}
`;

export class ProceduralSky {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene, materialBackend = null) {
    this.scene = scene;

    // Sky uniforms (independent from terrain — set by TimeOfDay)
    this.uniforms = createProceduralSkyUniforms();

    // Large inverted sphere
    const geometry = new THREE.IcosahedronGeometry(40000, 4);
    if (materialBackend?.createProceduralSkyMaterial) {
      const created = materialBackend.createProceduralSkyMaterial(this.uniforms);
      this.material = created.material;
      this.uniforms = created.uniforms;
    } else {
      this.material = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: true,
      });
    }

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
