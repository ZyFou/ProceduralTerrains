import * as THREE from 'three';
import { CLOUD_NOISE_GLSL } from './cloudGLSL.js';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const buildOccupancyFragment = (planet) => /* glsl */ `
precision highp float;
#define CLOUD_OCTAVES 3
${CLOUD_NOISE_GLSL}

varying vec2 vUv;
uniform float uCloudCoverage;
uniform float uCloudSoftness;
uniform float uCloudScale;
uniform float uCloudDetailStrength;
uniform vec3 uCloudWind;
uniform float uCloudRotation;
uniform float uCloudTime;
uniform float uCloudEvolve;
uniform vec3 uCloudNoiseOffset;
uniform vec3 uCloudDomainOrigin;
uniform vec2 uOccCenter;
uniform float uOccExtent;
uniform float uCloudBottom;
uniform float uCloudTop;
uniform float uCloudInner;
uniform float uCloudOuter;

vec3 occDomain(vec3 p) {
  float c = cos(uCloudRotation), s = sin(uCloudRotation);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

float occShape(vec3 p) {
  vec3 drift = uCloudWind * uCloudTime;
  vec3 q = occDomain(p - uCloudDomainOrigin) * uCloudScale
    + uCloudNoiseOffset
    + drift
    + vec3(0.0, uCloudTime * uCloudEvolve, 0.0);
  float base = cl_fbm_base(q);
  // A generous margin replaces the old CPU dilation/boost and deliberately
  // over-estimates occupancy so the visible raymarch never clips wisps.
  float threshold = 1.0 - uCloudCoverage
    - max(uCloudSoftness, 0.06)
    - uCloudDetailStrength * 0.5
    - 0.04;
  return step(threshold, base);
}

vec3 octDecode(vec2 f) {
  vec3 n = vec3(f.xy, 1.0 - abs(f.x) - abs(f.y));
  if (n.z < 0.0) {
    n.xy = (1.0 - abs(n.yx)) * sign(n.xy);
  }
  return normalize(n);
}

void main() {
  float occupied = 0.0;
  ${planet ? `
    vec3 dir = octDecode(vUv * 2.0 - 1.0);
    float span = uCloudOuter - uCloudInner;
    occupied = max(occupied, occShape(dir * (uCloudInner + span * 0.20)));
    occupied = max(occupied, occShape(dir * (uCloudInner + span * 0.50)));
    occupied = max(occupied, occShape(dir * (uCloudInner + span * 0.80)));
  ` : `
    vec2 xz = uOccCenter + (vUv * 2.0 - 1.0) * uOccExtent;
    float span = uCloudTop - uCloudBottom;
    occupied = max(occupied, occShape(vec3(xz.x, uCloudBottom + span * 0.25, xz.y)));
    occupied = max(occupied, occShape(vec3(xz.x, uCloudBottom + span * 0.50, xz.y)));
    occupied = max(occupied, occShape(vec3(xz.x, uCloudBottom + span * 0.75, xz.y)));
  `}
  gl_FragColor = vec4(occupied, 0.0, 0.0, 1.0);
}
`;

const DILATE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tInput;
uniform vec2 uTexel;
void main() {
  float occupied = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      occupied = max(
        occupied,
        texture2D(tInput, vUv + vec2(float(x), float(y)) * uTexel).r
      );
    }
  }
  gl_FragColor = vec4(occupied, 0.0, 0.0, 1.0);
}
`;

/**
 * Produces the small empty-space acceleration texture entirely on the GPU.
 * The result stays resident as a render-target texture: no CPU FBM loop, no
 * DataTexture upload and no GPU readback on the animation path.
 */
export class CloudOccupancyPass {
  constructor(renderer, uniforms, { size = 64, planet = false } = {}) {
    this.renderer = renderer;
    this.size = size;
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.targets = [0, 1].map((index) => {
      const target = new THREE.WebGLRenderTarget(size, size, {
        type: THREE.UnsignedByteType,
        format: THREE.RedFormat,
        internalFormat: 'R8',
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
      target.texture.name = `CloudOccupancyGPU${planet ? 'Planet' : 'Studio'}${index}`;
      return target;
    });
    this.generateMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: buildOccupancyFragment(planet),
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.dilateMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tInput: { value: null },
        uTexel: { value: new THREE.Vector2(1 / size, 1 / size) },
      },
      vertexShader: VERTEX,
      fragmentShader: DILATE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.generateMaterial);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  get texture() { return this.targets[0].texture; }

  setUniforms(uniforms) {
    this.generateMaterial.uniforms = uniforms;
  }

  render() {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevViewport = r.getViewport(new THREE.Vector4());
    const prevScissor = r.getScissor(new THREE.Vector4());
    const prevScissorTest = r.getScissorTest();
    try {
      r.setScissorTest(false);
      r.setViewport(0, 0, this.size, this.size);
      this.mesh.material = this.generateMaterial;
      r.setRenderTarget(this.targets[0]);
      r.render(this.scene, this.camera);
      for (let pass = 0; pass < 2; pass++) {
        const source = this.targets[pass % 2];
        const destination = this.targets[(pass + 1) % 2];
        this.dilateMaterial.uniforms.tInput.value = source.texture;
        this.mesh.material = this.dilateMaterial;
        r.setRenderTarget(destination);
        r.render(this.scene, this.camera);
      }
    } finally {
      r.setRenderTarget(prevTarget);
      r.setViewport(prevViewport);
      r.setScissor(prevScissor);
      r.setScissorTest(prevScissorTest);
      this.mesh.material = this.generateMaterial;
    }
  }

  dispose() {
    for (const target of this.targets) target.dispose();
    this.mesh.geometry.dispose();
    this.generateMaterial.dispose();
    this.dilateMaterial.dispose();
  }
}
