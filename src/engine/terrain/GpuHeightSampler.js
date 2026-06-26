import * as THREE from 'three';

// ============================================================================
// GPU-backed terrain height sampler for player collision.
//
// The terrain height field lives in the shaders; a CPU re-implementation
// cannot match it bit-for-bit (the value-noise hash depends on exact float32
// rounding, and the D3D11/ANGLE compiler reorders/fuses the arithmetic), so
// heights drift visibly from the rendered mesh. Instead, this sampler asks
// the GPU directly: it renders a small orthographic height tile around the
// player using the REAL terrain material (uColorMode = 2 packs the analytic
// per-pixel height into 16 bits of RG), reads it back once, and bilinearly
// samples the cached tile. By construction it matches the rendered terrain
// in both studio and infinite mode, for any seed / preset / octave count.
//
// The tile covers tileWorld units and is only re-rendered when the player
// approaches its edge or the terrain parameters change — a 128×128 readback
// every ~80 units walked, zero cost per frame otherwise.
//
// The analytic CPU sampler (TerrainHeightSampler) remains the fallback for
// points outside rendered geometry (off-board in studio, not-yet-streamed
// chunks in infinite mode) — it is within a few units of the GPU, which is
// fine for those transient cases.
// ============================================================================

export class GpuHeightSampler {
  /**
   * @param {object} opts
   * @param {THREE.WebGLRenderer} opts.renderer
   * @param {THREE.Scene} opts.scene
   * @param {object} opts.uniforms            shared terrain uniforms (live)
   * @param {TerrainHeightSampler} opts.cpuSampler  analytic fallback
   * @param {function} opts.isTerrainMaterial (material) => boolean
   * @param {function} opts.getGeneration     () => number — bumps on terrain change
   * @param {function} opts.getMaxHeight      () => number
   */
  constructor({ renderer, scene, uniforms, cpuSampler, isTerrainMaterial, getGeneration, getMaxHeight,
    colorMode = 2, tileSize = 128, tileWorld = 256, edgeMargin = 48 }) {
    this.renderer = renderer;
    this.scene = scene;
    this.uniforms = uniforms;
    this.cpu = cpuSampler;
    this.isTerrainMaterial = isTerrainMaterial;
    this.getGeneration = getGeneration;
    this.getMaxHeight = getMaxHeight;
    // colorMode 2 = smooth analytic height (player collision); 3 = the actual
    // rendered faceted surface height (prop placement that hugs the LOD mesh).
    this.colorMode = colorMode;

    this.tileSize = tileSize;      // pixels
    this.tileWorld = tileWorld;    // world units covered by the tile
    this.edgeMargin = edgeMargin;  // re-render when a sample gets this close to the edge

    this._rt = null;
    this._data = null;        // Uint8Array RGBA readback
    this._cx = 0;
    this._cz = 0;
    this._valid = false;
    this._gen = -1;
    this._cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
    this._cam.up.set(0, 0, -1);
  }

  dispose() {
    if (this._rt) { this._rt.dispose(); this._rt = null; }
    this._data = null;
    this._valid = false;
  }

  invalidate() { this._valid = false; }

  /** Render/center the tile on (x,z) up-front so a whole batch of samples in
   *  that area hits one cached readback (no mid-loop re-renders). */
  prime(x, z) { this._ensureTile(x, z); }

  // -------------------------------------------------------------- sampling

  /** World-space terrain height at (x, z). */
  heightAt(x, z) {
    this._ensureTile(x, z);
    if (!this._valid) return this.cpu.heightAt(x, z);

    const N = this.tileSize;
    const step = this.tileWorld / N;
    // pixel-center mapping (row 0 of the readback = +Z edge of the tile)
    const fx = (x - (this._cx - this.tileWorld / 2)) / step - 0.5;
    const fy = ((this._cz + this.tileWorld / 2) - z) / step - 0.5;
    const x0 = Math.max(0, Math.min(N - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(N - 1, Math.floor(fy)));
    const x1 = Math.min(N - 1, x0 + 1);
    const y1 = Math.min(N - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));

    const h00 = this._texel(x0, y0);
    const h10 = this._texel(x1, y0);
    const h01 = this._texel(x0, y1);
    const h11 = this._texel(x1, y1);
    // any corner not covered by terrain geometry -> analytic fallback, and
    // periodically retry the tile (chunks may still have been streaming in
    // when it was captured)
    if (h00 === null || h10 === null || h01 === null || h11 === null) {
      const now = performance.now();
      if (now - (this._holeRetryAt || 0) > 700) {
        this._holeRetryAt = now;
        this._valid = false;
      }
      return this.cpu.heightAt(x, z);
    }

    const top = h00 + (h10 - h00) * tx;
    const bot = h01 + (h11 - h01) * tx;
    return top + (bot - top) * ty;
  }

  /** Approximate surface normal at (x, z) via central differences. */
  normalAt(x, z, eps = 1.0) {
    const hL = this.heightAt(x - eps, z);
    const hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps);
    const hU = this.heightAt(x, z + eps);
    const nx = hL - hR, ny = 2 * eps, nz = hD - hU;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  // --------------------------------------------------------------- internals

  /** Decoded height of one texel, or null where no terrain was rendered. */
  _texel(px, py) {
    const i = (py * this.tileSize + px) * 4;
    const d = this._data;
    if (d[i + 3] < 128) return null;     // alpha 0 = nothing rendered here
    const h01 = d[i] / 255 + d[i + 1] / (255 * 255);
    return h01 * this.uniforms.uHeightScale.value;
  }

  _ensureTile(x, z) {
    const gen = this.getGeneration();
    const half = this.tileWorld / 2;
    const fits = this._valid
      && gen === this._gen
      && Math.abs(x - this._cx) < half - this.edgeMargin
      && Math.abs(z - this._cz) < half - this.edgeMargin;
    if (fits) return;
    this._renderTile(x, z);
    this._gen = gen;
  }

  _renderTile(cx, cz) {
    const r = this.renderer;
    const N = this.tileSize;
    const half = this.tileWorld / 2;

    if (!this._rt) {
      this._rt = new THREE.WebGLRenderTarget(N, N, { depthBuffer: true });
      this._data = new Uint8Array(N * N * 4);
    }

    // top-down ortho camera over the tile
    const cam = this._cam;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.position.set(cx, this.getMaxHeight() + 2000, cz);
    cam.lookAt(cx, 0, cz);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // hide everything that is not terrain (water, plinth, sky dome, …) and
    // clear to alpha 0 so uncovered texels are detectable
    const hidden = [];
    this.scene.traverse((o) => {
      if (o.isMesh && o.visible && !this.isTerrainMaterial(o.material)) {
        hidden.push(o);
        o.visible = false;
      }
    });
    const bg = this.scene.background;
    this.scene.background = null;
    const prevClearColor = new THREE.Color();
    r.getClearColor(prevClearColor);
    const prevClearAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);

    this.uniforms.uColorMode.value = this.colorMode;
    r.setRenderTarget(this._rt);
    r.clear();
    r.render(this.scene, cam);
    r.readRenderTargetPixels(this._rt, 0, 0, N, N, this._data);
    r.setRenderTarget(null);
    this.uniforms.uColorMode.value = 0;

    r.setClearColor(prevClearColor, prevClearAlpha);
    this.scene.background = bg;
    for (const o of hidden) o.visible = true;

    this._cx = cx;
    this._cz = cz;
    this._valid = true;
  }
}
