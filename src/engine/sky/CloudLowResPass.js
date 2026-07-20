import * as THREE from 'three';

// ============================================================================
// CloudLowResPass: renders the (expensive, fill-rate-bound) volumetric cloud
// mesh into a LOW-RESOLUTION offscreen target, then composites it back over the
// full-res scene with a DEPTH-AWARE (bilateral) upscale. Clouds are the heaviest
// per-pixel cost in the renderer, so marching them at 1/2 or 1/4 the pixels is a
// large win; the bilateral upscale recovers crisp edges against the terrain
// silhouette (a plain bilinear upscale would halo there) and doubles as a mild
// spatial denoiser.
//
// Isolation: the cloud mesh is moved onto a dedicated camera LAYER while this
// mode is active, so normal (layer-0) scene renders simply never draw it — no
// reparenting, no per-frame visibility juggling. This pass renders ONLY that
// layer into the low-res target, then a fullscreen quad composites the result.
//
// The pass is self-contained (its own RT + composite material + quad scene) and
// is shared by both the studio slab and the planet shell layers.
// ============================================================================

// Dedicated layer the cloud mesh lives on while low-res mode is active. Layer 0
// is the default (everything else); we keep clouds off it so the main render
// excludes them automatically.
export const CLOUD_LOWRES_LAYER = 2;

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D tCloud;        // low-res clouds, PREMULTIPLIED (rgb = col*a)
uniform sampler2D tSceneDepth;   // full-res opaque scene depth (terrain)
uniform vec2  uLowTexel;         // 1 / lowResSize
uniform float uDepthSharpness;   // bilateral falloff on raw depth difference
uniform float uUseDepth;         // 1 = depth-aware, 0 = plain bilinear

// Depth-aware 2x2 bilateral upsample: weight each low-res neighbour by its
// bilinear footprint AND by how closely the scene depth at that neighbour
// matches the scene depth at this output pixel. At a terrain silhouette the
// neighbours on the "wrong" side (sky vs surface) are rejected, so the cloud
// edge stays crisp instead of bleeding across the ridge.
void main() {
  float dC = texture2D(tSceneDepth, vUv).x;

  vec2 p = vUv / uLowTexel - 0.5;
  vec2 f = fract(p);
  vec2 base = (floor(p) + 0.5) * uLowTexel;

  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 off = vec2(float(i), float(j)) * uLowTexel;
      vec2 uv = base + off;
      float bw = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
      float dN = texture2D(tSceneDepth, uv).x;
      float dd = abs(dN - dC) * uDepthSharpness;
      float dw = mix(1.0, 1.0 / (1.0 + dd * dd), uUseDepth);
      float w = bw * dw + 1e-5;
      acc += texture2D(tCloud, uv) * w;
      wsum += w;
    }
  }
  gl_FragColor = acc / wsum;       // premultiplied; blended "over" by the material
}
`;

const COMPOSITE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export class CloudLowResPass {
  constructor() {
    this.scale = 0.5;                 // 1.0 = off (caller skips), 0.5 = half, 0.25 = quarter
    this.depthAware = true;
    this.rt = null;
    this._size = new THREE.Vector2();
    this._prevClear = new THREE.Color();
    this._didRender = false;

    this._composite = new THREE.ShaderMaterial({
      uniforms: {
        tCloud:          { value: null },
        tSceneDepth:     { value: null },
        uLowTexel:       { value: new THREE.Vector2(1, 1) },
        uDepthSharpness: { value: 1800.0 },
        uUseDepth:       { value: 1.0 },
      },
      vertexShader: COMPOSITE_VERT,
      fragmentShader: COMPOSITE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // premultiplied "over": dst = src.rgb + dst*(1 - src.a)
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._composite);
    this._quad.frustumCulled = false;
    this._quadScene = new THREE.Scene();
    this._quadScene.add(this._quad);
    this._quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /** Put a cloud mesh on (or off) the dedicated low-res layer. */
  setMeshLayer(mesh, lowRes) {
    if (!mesh) return;
    mesh.layers.set(lowRes ? CLOUD_LOWRES_LAYER : 0);
  }

  _ensureRT(renderer, baseSize = null) {
    const ds = baseSize || renderer.getDrawingBufferSize(this._size);
    const w = Math.max(1, Math.round(ds.x * this.scale));
    const h = Math.max(1, Math.round(ds.y * this.scale));
    if (this.rt && this.rt.width === w && this.rt.height === h) return;
    if (this.rt) this.rt.dispose();
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.rt.texture.minFilter = THREE.LinearFilter;
    this.rt.texture.magFilter = THREE.LinearFilter;
    this.rt.texture.generateMipmaps = false;
  }

  /**
   * Render ONLY the cloud layer of `scene` into the low-res target. The mesh
   * must already be on CLOUD_LOWRES_LAYER (see setMeshLayer) and visible.
   *
   * The cloud shader derives its depth-occlusion UV from gl_FragCoord /
   * uDepthResolution, so while we draw at low resolution that uniform must be
   * the LOW-RES size (the depth texture is sampled with normalized UVs, so the
   * full-res depth still lines up). renderDepthPrepass resets it to full res
   * every frame, so we only need to set it here.
   */
  renderCloud(renderer, scene, camera, mesh, baseSize = null) {
    this._ensureRT(renderer, baseSize);

    const depthRes = mesh?.material?.uniforms?.uDepthResolution;
    if (depthRes) depthRes.value.set(this.rt.width, this.rt.height);

    const savedMask = camera.layers.mask;
    const prevRT = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this._prevClear);
    const prevBg = scene.background;

    // Mutating the shared renderer/camera state must be exception-safe: a throw
    // mid-render (common while the cloud program is still linking right after a
    // mode switch) would otherwise leave the camera stuck on the cloud-only
    // layer and the render target stuck on this offscreen RT, so every later
    // frame renders into nowhere and the scene appears frozen until a reload.
    try {
      camera.layers.set(CLOUD_LOWRES_LAYER);   // only the cloud draws
      scene.background = null;                  // keep the target transparent
      renderer.autoClear = false;
      renderer.setRenderTarget(this.rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.render(scene, camera);
      this._didRender = true;
    } finally {
      renderer.setRenderTarget(prevRT);
      renderer.setClearColor(this._prevClear, prevAlpha);
      renderer.autoClear = prevAutoClear;
      camera.layers.mask = savedMask;
      scene.background = prevBg;
    }
  }

  /** Composite the low-res clouds over the CURRENT render target (no clear). */
  composite(renderer, sceneDepthTex) {
    if (!this._didRender || !this.rt) return;
    const u = this._composite.uniforms;
    u.tCloud.value = this.rt.texture;
    u.tSceneDepth.value = sceneDepthTex;
    u.uLowTexel.value.set(1 / this.rt.width, 1 / this.rt.height);
    u.uUseDepth.value = (this.depthAware && sceneDepthTex) ? 1.0 : 0.0;

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      renderer.render(this._quadScene, this._quadCam);
    } finally {
      renderer.autoClear = prevAutoClear;
      this._didRender = false;
    }
  }

  dispose() {
    if (this.rt) { this.rt.dispose(); this.rt = null; }
    this._quad.geometry.dispose();
    this._composite.dispose();
  }
}
