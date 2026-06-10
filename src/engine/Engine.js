import * as THREE from 'three';
import { createTerrainUniforms, createTerrainMaterial } from './terrain/TerrainMaterial.js';
import { createWaterMaterial } from './terrain/WaterMaterial.js';
import { TerrainBoard } from './terrain/TerrainBoard.js';
import { EditorControls } from './EditorControls.js';
import { Minimap } from './Minimap.js';
import { DEFAULT_PARAMS, applyPreset } from './presets.js';

// ============================================================================
// Terrain Studio engine. Framework-agnostic: owns the renderer/scene, the
// single fixed terrain board, shared shader uniforms and camera controls.
// The React UI talks to it through methods + the `callbacks` object:
//   onParams(params)            full param mirror after any change
//   onStatus(text, busy)        status bar text
//   onStats({fps,triangles,drawCalls})
//   onLod(counts, chunkCount)
//   onCamera({angle,distance})
//   onBoard(boardSize)
//   onToast(message)
//   onFirstInteract()
// ============================================================================

// Deterministic PRNG used ONLY to derive noise-domain offsets from the seed.
// Terrain itself is a pure GPU function of (worldXZ, uniforms).
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Parameter keys that change the terrain shape (deferred when Auto Update is
// off). Everything else (debug toggles, sun, fog…) always applies instantly.
const SHAPE_KEYS = new Set([
  'seed', 'heightScale', 'seaLevel', 'noiseScale', 'noiseStrength', 'octaves',
  'persistence', 'lacunarity', 'ridge', 'warp', 'falloff',
  'moistScale', 'moistBias', 'snowLine', 'chunkCount', 'chunkSize',
]);

const REBUILD_KEYS = new Set(['chunkCount', 'chunkSize']);

export class Engine {
  constructor({ canvas, minimapBase, minimapOverlay, callbacks }) {
    this.canvas = canvas;
    this.cb = callbacks;
    this.params = { ...DEFAULT_PARAMS };
    this.appliedChunkCount = 0;
    this.appliedChunkSize = 0;
    this._minimapDirtyAt = 0;
    this._lastLodUpdate = 0;
    this._lastHudUpdate = 0;
    this._frames = 0;
    this._fpsTime = 0;
    this._fps = 0;
    this._clock = new THREE.Clock();
    this._disposed = false;

    this._initRenderer();
    this._initScene(minimapBase, minimapOverlay);
    this._initControls();

    this.applyAll({ force: true });
    this.controls.reset(this.boardSize);
    this.cb.onStatus('Ready', false);
    this.cb.onParams({ ...this.params });

    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(canvas.parentElement);
    this._onResize();

    this.renderer.setAnimationLoop(() => this._tick());
  }

  // ----------------------------------------------------------------- setup

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setClearColor(0x0b0e14, 1);

    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    let gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'WebGL2';
    const angle = /ANGLE \([^,]+,\s*(.+?),\s*[^,]*\)\s*$/.exec(gpu);
    if (angle) gpu = angle[1];
    gpu = gpu.replace(/\s*\(0x[0-9A-F]+\)/i, '').replace(/\s*Direct3D.*$/i, '').trim();
    if (gpu.length > 42) gpu = gpu.slice(0, 42) + '…';
    this.gpuName = gpu;
  }

  _initScene(minimapBase, minimapOverlay) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e14);

    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 50000);

    // shared shader uniforms: terrain + water read the same objects
    this.uniforms = createTerrainUniforms();
    this.terrainMaterial = createTerrainMaterial(this.uniforms);
    this.board = new TerrainBoard(this.scene, this.terrainMaterial);

    // water plane at sea level
    this.waterMaterial = createWaterMaterial(this.uniforms);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.waterMaterial);
    this.water.geometry.rotateX(-Math.PI / 2);
    this.water.renderOrder = 10;
    this.water.frustumCulled = false;
    this.scene.add(this.water);

    // dark plinth under the board so it reads as a single solid slab
    this.plinth = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x231e19, roughness: 0.95, metalness: 0 })
    );
    this.scene.add(this.plinth);

    // lights only affect the plinth (terrain/water have custom shaders)
    this.sunLight = new THREE.DirectionalLight(0xfff2dd, 1.6);
    this.scene.add(this.sunLight);
    this.scene.add(new THREE.AmbientLight(0x4a5568, 0.5));

    this.minimap = new Minimap(this.renderer, this.scene, minimapBase, minimapOverlay);
  }

  _initControls() {
    this.controls = new EditorControls(this.camera, this.canvas);
    this.controls.onFirstInteract = () => this.cb.onFirstInteract();
  }

  // ------------------------------------------------------------ parameters

  get boardSize() { return this.params.chunkCount * this.params.chunkSize; }

  setParam(key, value) {
    this.params[key] = value;
    this.cb.onParams({ ...this.params });

    if (SHAPE_KEYS.has(key) && !this.params.autoUpdate) {
      this.cb.onStatus('Pending changes — press Regenerate', true);
      return;
    }
    this._afterParamChange(REBUILD_KEYS.has(key));
  }

  applyPresetByKey(presetKey) {
    this.params = applyPreset(this.params, presetKey);
    this.cb.onParams({ ...this.params });
    this._afterParamChange(true);
  }

  regenerate() { this.applyAll({ force: false }); }

  randomizeSeed() {
    this.setParam('seed', (Math.random() * 0xffffffff) >>> 0);
    this.cb.onToast(`Seed → ${this.params.seed}`);
  }

  newProject() {
    this.params = { ...DEFAULT_PARAMS };
    this.cb.onParams({ ...this.params });
    this.applyAll({ force: true });
    this.controls.reset(this.boardSize);
    this.cb.onToast('New project');
  }

  _afterParamChange(needsRebuild) {
    if (needsRebuild) this.applyAll({ force: false });
    else this._applyUniforms();
    this._minimapDirtyAt = performance.now();
    this.minimap.requestRedraw();
  }

  // Push every parameter into uniforms; rebuild the chunk grid if the world
  // layout changed.
  applyAll({ force }) {
    const p = this.params;
    const rebuildNeeded = force
      || p.chunkCount !== this.appliedChunkCount
      || p.chunkSize !== this.appliedChunkSize;

    if (rebuildNeeded) {
      this.cb.onStatus('Rebuilding board…', true);
      const maxHeight = this._maxHeight();
      this.board.build({
        chunkCount: p.chunkCount,
        chunkSize: p.chunkSize,
        maxHeight,
        skirtDepth: this._skirtDepth(),
      });
      this.appliedChunkCount = p.chunkCount;
      this.appliedChunkSize = p.chunkSize;

      const size = this.boardSize;
      this.water.scale.set(size, 1, size);
      this.plinth.scale.set(size, 160, size);
      this.plinth.position.y = -80.5;
      this.controls.setBoardSize(size);
      this.minimap.setBoard(size, maxHeight);
      this.cb.onBoard(size);
    }

    this._applyUniforms();
    this._minimapDirtyAt = performance.now();
    this.minimap.requestRedraw();
    this.cb.onStatus('Ready', false);
  }

  _maxHeight() { return this.params.heightScale * 1.35 + 2; }
  _skirtDepth() { return Math.max(24, this.params.heightScale * 0.08); }

  _applyUniforms() {
    const p = this.params;
    const u = this.uniforms;
    const size = this.boardSize;

    const rng = mulberry32(p.seed >>> 0);
    u.uSeedOffset.value.set(rng() * 2048 - 1024, rng() * 2048 - 1024);

    u.uFrequency.value = (p.noiseScale * 0.1) / size;
    u.uHeightScale.value = p.heightScale;
    u.uSeaLevel.value = p.seaLevel;
    u.uAmplitude.value = p.noiseStrength;
    u.uPersistence.value = p.persistence;
    u.uLacunarity.value = p.lacunarity;
    u.uRidge.value = p.ridge;
    u.uWarp.value = p.warp;
    u.uFalloff.value = p.falloff;
    u.uBoardHalf.value = size / 2;
    u.uChunkSize.value = p.chunkSize;
    u.uMoistScale.value = p.moistScale;
    u.uMoistBias.value = p.moistBias;
    u.uSnowLine.value = p.snowLine;
    u.uNormalStrength.value = p.normalStrength;
    u.uAO.value = p.aoStrength;
    u.uGrid.value = p.chunkGrid ? 1 : 0;
    u.uLodDebug.value = p.lodDebug ? 1 : 0;
    u.uEps.value = Math.max(0.35, size / 4096);
    u.uSkirtDepth.value = this._skirtDepth();

    const az = p.sunAzimuth * Math.PI / 180;
    const el = p.sunElevation * Math.PI / 180;
    u.uSunDir.value.set(
      Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)
    ).normalize();
    this.sunLight.position.copy(u.uSunDir.value).multiplyScalar(2000);

    u.uFogDensity.value = p.fogDensity * 0.0001;

    // octave count is a compile-time constant (keeps loop bounds static for
    // the D3D11 shader compiler) — changing it triggers a quick recompile
    const oct = Math.round(p.octaves);
    if (this.terrainMaterial.defines.OCTAVES !== oct) {
      this.terrainMaterial.defines.OCTAVES = oct;
      this.terrainMaterial.needsUpdate = true;
      this.waterMaterial.defines.OCTAVES = oct;
      this.waterMaterial.needsUpdate = true;
    }

    this.terrainMaterial.wireframe = p.wireframe;
    this.waterMaterial.uniforms.uWaterAnim.value = p.waterAnim ? 1 : 0;
    this.water.position.y = p.seaLevel;
    this.water.visible = p.seaLevel > 0.5;

    this.board.updateBounds(this._maxHeight(), this._skirtDepth());
    this._applyPixelRatio();
  }

  _applyPixelRatio() {
    const p = this.params?.pixelRatio || 0;
    this.renderer.setPixelRatio(p > 0 ? p : Math.min(window.devicePixelRatio, 2));
  }

  // ------------------------------------------------------------------ camera

  resetView() { this.controls.reset(this.boardSize); }
  focusCenter() { this.controls.focusCenter(); }
  setCameraMode(mode) { this.controls.setMode(mode); }
  setCameraView(view) { this.controls.setView(view); }
  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------- save/load

  saveSeed() {
    const data = {
      app: 'terrain-studio',
      version: 1,
      savedAt: new Date().toISOString(),
      params: this.params,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    this._download(URL.createObjectURL(blob), `terrain-seed-${this.params.seed}.json`);
    this.cb.onToast('Seed saved as JSON');
  }

  loadSeedJSON(json) {
    const src = json?.params && typeof json.params === 'object' ? json.params : json;
    if (!src || typeof src !== 'object' || !('seed' in src)) {
      this.cb.onToast('Not a valid terrain seed file');
      return;
    }
    const next = { ...DEFAULT_PARAMS };
    for (const key of Object.keys(DEFAULT_PARAMS)) {
      if (key in src && typeof src[key] === typeof DEFAULT_PARAMS[key]) next[key] = src[key];
    }
    this.params = next;
    this.cb.onParams({ ...this.params });
    this.applyAll({ force: true });
    this.cb.onToast(`Loaded seed ${this.params.seed}`);
  }

  // --------------------------------------------------------------- exports

  _download(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  exportScreenshot() {
    this.renderer.render(this.scene, this.camera);
    this.renderer.domElement.toBlob((blob) => {
      if (!blob) return this.cb.onToast('Export failed');
      this._download(URL.createObjectURL(blob), `terrain-${this.params.seed}.png`);
      this.cb.onToast('Screenshot exported');
    });
  }

  exportHeightmap() {
    const SIZE = 1024;
    const rt = new THREE.WebGLRenderTarget(SIZE, SIZE);
    const half = this.boardSize / 2;
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, 20000);
    cam.up.set(0, 0, -1);
    cam.position.set(0, this._maxHeight() + 2000, 0);
    cam.lookAt(0, 0, 0);

    this.uniforms.uColorMode.value = 1;
    const waterWasVisible = this.water.visible;
    this.water.visible = false;
    this.plinth.visible = false;

    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, cam);
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, pixels);
    this.renderer.setRenderTarget(null);

    this.uniforms.uColorMode.value = 0;
    this.water.visible = waterWasVisible;
    this.plinth.visible = true;
    rt.dispose();

    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      const src = (SIZE - 1 - y) * SIZE * 4;
      img.data.set(pixels.subarray(src, src + SIZE * 4), y * SIZE * 4);
    }
    ctx.putImageData(img, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return this.cb.onToast('Export failed');
      this._download(URL.createObjectURL(blob), `heightmap-${this.params.seed}.png`);
      this.cb.onToast('Heightmap exported');
    });
  }

  // ------------------------------------------------------------- main loop

  _onResize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _tick() {
    const dt = Math.min(this._clock.getDelta(), 0.05);
    const now = performance.now();

    this.controls.update(dt);
    this.uniforms.uTime.value += dt;

    // LOD selection: throttled, distance-based, internal to the fixed board
    if (now - this._lastLodUpdate > 150) {
      this._lastLodUpdate = now;
      this.board.updateLOD(this.camera.position);
      this.cb.onLod([...this.board.lodCounts], this.params.chunkCount);
    }

    this.renderer.render(this.scene, this.camera);
    const triangles = this.renderer.info.render.triangles;
    const drawCalls = this.renderer.info.render.calls;

    // minimap: re-render base only after params settle, marker every frame
    if (this.minimap._dirty && now - this._minimapDirtyAt > 280) {
      this.minimap.renderBase();
    }
    this.minimap.drawOverlay(this.controls);

    // HUD updates at ~6 Hz
    this._frames++;
    if (now - this._fpsTime >= 1000) {
      this._fps = this._frames;
      this._frames = 0;
      this._fpsTime = now;
    }
    if (now - this._lastHudUpdate > 160) {
      this._lastHudUpdate = now;
      this.cb.onCamera({
        angle: `${this.controls.azimuthDeg.toFixed(0)}°, ${this.controls.elevationDeg.toFixed(0)}°`,
        distance: this.controls.distance.toFixed(0),
      });
      this.cb.onStats({ fps: this._fps, triangles, drawCalls });
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._resizeObserver.disconnect();
    this.renderer.setAnimationLoop(null);
    this.board.dispose();
    this.minimap.dispose();
    this.terrainMaterial.dispose();
    this.waterMaterial.dispose();
    this.renderer.dispose();
  }
}
