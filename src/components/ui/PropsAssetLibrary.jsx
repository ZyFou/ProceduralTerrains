import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  Copy, Flower2, Mountain, Move3D, Plus, RefreshCw, RotateCcw, Search,
  Sprout, Trash2, TreeDeciduous, TreePine, Upload, X,
} from 'lucide-react';
import { createPropAssetPreviewModel } from '../../engine/props/ProceduralPropsManager.js';
import {
  PROP_ASSET_PRESETS,
  PROP_ASSET_TYPES,
  createImportedPropAsset,
  createPropAsset,
  normalizePropAssetLibrary,
} from '../../engine/props/PropAssetLibrary.js';
import {
  disposeImportedModelParts,
  importedModelFormat,
  loadImportedPropModel,
} from '../../engine/props/ImportedPropModel.js';

const PROP_TYPE_ICONS = {
  grass: Sprout,
  flower: Flower2,
  rock: Mountain,
  broadleaf: TreeDeciduous,
  conifer: TreePine,
};

const propTypeLabel = (type) => PROP_ASSET_TYPES.find((entry) => entry.id === type)?.label || type;

function PropTypeIcon({ type, color, compact = false }) {
  const Icon = PROP_TYPE_ICONS[type] || Sprout;
  return (
    <span className={`prop-type-icon${compact ? ' compact' : ''}`} style={{ color }} aria-hidden>
      <Icon size={compact ? 14 : 16} strokeWidth={1.8} />
    </span>
  );
}

async function setPreviewAsset(state, asset) {
  if (!state || !asset) return;
  const loadToken = ++state.loadToken;
  if (state.model) {
    state.pivot.remove(state.model);
    state.model.userData.disposePreview?.();
    state.model = null;
  }
  state.host.dataset.previewState = 'loading';
  let model;
  try {
    model = await createPropAssetPreviewModel(asset);
  } catch (error) {
    if (loadToken === state.loadToken) {
      state.host.dataset.previewState = 'error';
      state.host.title = error?.message || 'Could not preview this model.';
    }
    return;
  }
  if (loadToken !== state.loadToken) {
    model.userData.disposePreview?.();
    return;
  }
  state.host.dataset.previewState = 'ready';
  state.host.removeAttribute('title');
  state.model = model;
  // Measure before parenting: the preview pivot may already be scaled from a
  // previous asset and must not contaminate the next asset's fit calculation.
  const bounds = new THREE.Box3().setFromObject(model);
  model.position.y -= bounds.min.y;
  const size = bounds.getSize(new THREE.Vector3());
  const targetSize = Math.max(size.x, size.y, size.z, 0.1);
  state.pivot.position.y = 0;
  state.pivot.scale.setScalar((2.18 * Math.sqrt(asset.scale)) / targetSize);
  state.pivot.add(model);
}

function uniqueId(assets, prefix) {
  const base = `${prefix}-${Date.now().toString(36)}`;
  let id = base;
  let suffix = 2;
  const used = new Set(assets.map((asset) => asset.id));
  while (used.has(id)) id = `${base}-${suffix++}`;
  return id;
}

function Preview({ asset }) {
  const hostRef = useRef(null);
  const sceneRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      host.dataset.previewUnavailable = 'true';
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
    const pivot = new THREE.Group();
    scene.add(pivot);
    sceneRef.current = { host, pivot, model: null, loadToken: 0, view: { yaw: 0, pitch: 0 } };

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(1.05, 48),
      new THREE.MeshStandardMaterial({ color: 0x242824, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.025;
    scene.add(ground);
    scene.add(new THREE.HemisphereLight(0xdce9ff, 0x283322, 2.2));
    const key = new THREE.DirectionalLight(0xfff0d5, 3.2);
    key.position.set(3, 4, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x83b7ff, 1.25);
    rim.position.set(-3, 2, -2);
    scene.add(rim);
    camera.position.set(2.65, 1.55, 3.55);
    camera.lookAt(0, 1.02, 0);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let frame = 0;
    const onDown = (event) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture?.(event.pointerId);
    };
    const onMove = (event) => {
      if (!dragging) return;
      const view = sceneRef.current?.view;
      if (!view) return;
      view.yaw += (event.clientX - lastX) * 0.012;
      view.pitch = THREE.MathUtils.clamp(
        view.pitch + (event.clientY - lastY) * 0.01,
        -Math.PI * 0.42,
        Math.PI * 0.42,
      );
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onUp = () => { dragging = false; };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onUp);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const render = () => {
      const view = sceneRef.current?.view;
      if (view) {
        if (!dragging) view.yaw += 0.0035;
        pivot.rotation.set(view.pitch, view.yaw, 0, 'YXZ');
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      if (sceneRef.current) sceneRef.current.loadToken++;
      sceneRef.current?.model?.userData.disposePreview?.();
      sceneRef.current = null;
      ground.geometry.dispose();
      ground.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    const state = sceneRef.current;
    void setPreviewAsset(state, asset);
    return undefined;
  }, [asset]);

  const resetView = () => {
    const state = sceneRef.current;
    if (!state) return;
    state.view.yaw = 0;
    state.view.pitch = 0;
    state.pivot.rotation.set(0, 0, 0);
  };

  return (
    <div ref={hostRef} className="prop-asset-preview" aria-label={`3D preview of ${asset?.name || 'prop'}`}>
      <button type="button" className="prop-preview-reset" onClick={resetView} title="Reset preview rotation" aria-label="Reset preview rotation">
        <RotateCcw size={14} strokeWidth={1.8} aria-hidden />
      </button>
    </div>
  );
}

function MiniSlider({ label, value, min, max, step, onChange }) {
  return (
    <label className="prop-asset-slider">
      <span>{label}<output>{Number(value).toFixed(2)}</output></span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

export default function PropsAssetLibrary({ value, onChange }) {
  const assets = useMemo(() => normalizePropAssetLibrary(value), [value]);
  const [selectedId, setSelectedId] = useState(assets[0]?.id || null);
  const [pickerMode, setPickerMode] = useState(null);
  const [assetQuery, setAssetQuery] = useState('');
  const [presetQuery, setPresetQuery] = useState('');
  const [visibleAssetCount, setVisibleAssetCount] = useState(80);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef(null);
  const selected = assets.find((asset) => asset.id === selectedId) || assets[0] || null;
  const [nameDraft, setNameDraft] = useState(selected?.name || '');

  const filteredAssets = useMemo(() => {
    const query = assetQuery.trim().toLowerCase();
    if (!query) return assets;
    return assets.filter((asset) => `${asset.name} ${asset.type} ${propTypeLabel(asset.type)}`.toLowerCase().includes(query));
  }, [assetQuery, assets]);
  const selectedFilteredIndex = filteredAssets.findIndex((asset) => asset.id === selected?.id);
  const visibleAssets = useMemo(() => {
    const firstPage = filteredAssets.slice(0, visibleAssetCount);
    if (selected && selectedFilteredIndex >= visibleAssetCount) {
      return [selected, ...firstPage.filter((asset) => asset.id !== selected.id)];
    }
    return firstPage;
  }, [filteredAssets, selected, selectedFilteredIndex, visibleAssetCount]);
  const hasMoreAssets = visibleAssetCount < filteredAssets.length;
  const filteredPresets = useMemo(() => {
    const query = presetQuery.trim().toLowerCase();
    if (!query) return PROP_ASSET_PRESETS;
    return PROP_ASSET_PRESETS.filter((preset) => `${preset.name} ${preset.type} ${propTypeLabel(preset.type)}`.toLowerCase().includes(query));
  }, [presetQuery]);

  useEffect(() => {
    if (!selected && assets[0]) setSelectedId(assets[0].id);
  }, [assets, selected]);
  useEffect(() => { setNameDraft(selected?.name || ''); }, [selected?.id, selected?.name]);
  useEffect(() => { setVisibleAssetCount(80); }, [assetQuery]);

  const commit = (next) => onChange(normalizePropAssetLibrary(next));
  const patchSelected = (patch) => {
    if (!selected) return;
    commit(assets.map((asset) => asset.id === selected.id ? { ...asset, ...patch } : asset));
  };
  const choosePreset = (preset) => {
    const mode = pickerMode;
    if (pickerMode === 'replace' && selected) {
      const replacement = createPropAsset(preset.id, selected.id);
      commit(assets.map((asset) => asset.id === selected.id ? replacement : asset));
    } else {
      const next = createPropAsset(preset.id, uniqueId(assets, preset.type));
      commit([...assets, next]);
      setSelectedId(next.id);
    }
    if (mode === 'replace') setPickerMode(null);
  };
  const duplicate = () => {
    if (!selected) return;
    const copy = { ...selected, id: uniqueId(assets, selected.type), name: `${selected.name} Copy` };
    commit([...assets, copy]);
    setSelectedId(copy.id);
  };
  const remove = () => {
    if (!selected) return;
    const index = assets.findIndex((asset) => asset.id === selected.id);
    const next = assets.filter((asset) => asset.id !== selected.id);
    commit(next);
    setSelectedId(next[Math.min(index, next.length - 1)]?.id || null);
  };
  const commitName = () => {
    if (!selected) return;
    const name = nameDraft.trim() || 'Untitled asset';
    setNameDraft(name);
    patchSelected({ name });
  };
  const togglePicker = (mode) => {
    setPresetQuery('');
    setPickerMode((current) => current === mode ? null : mode);
  };
  const importModel = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const format = importedModelFormat(file.name);
    if (!format) {
      setImportError('Choose a .glb, .gltf, or .obj model.');
      return;
    }
    if (file.size > 40 * 1024 * 1024) {
      setImportError('Models must be 40 MB or smaller.');
      return;
    }
    setImporting(true);
    setImportError('');
    try {
      const model = { name: file.name, format, size: file.size, data: await fileAsDataUrl(file) };
      const validationParts = await loadImportedPropModel(model);
      disposeImportedModelParts(validationParts);
      const next = createImportedPropAsset(model, uniqueId(assets, 'imported'));
      commit([...assets, next]);
      setSelectedId(next.id);
      setPickerMode(null);
    } catch (error) {
      const detail = format === 'gltf' ? ' Use a self-contained glTF or export as GLB.' : '';
      setImportError(`${error?.message || 'Could not import this model.'}${detail}`);
    } finally {
      setImporting(false);
    }
  };
  const assetCountLabel = filteredAssets.length === assets.length
    ? `${assets.length} ${assets.length === 1 ? 'asset' : 'assets'}`
    : `${filteredAssets.length} of ${assets.length}`;

  return (
    <div className="prop-asset-library" data-setting-id="props.assetLibrary">
      <div className="prop-library-toolbar">
        <button type="button" className="action-btn primary" onClick={() => togglePicker('add')}>
          {pickerMode === 'add' ? 'Close' : <><Plus size={13} aria-hidden /> Add preset</>}
        </button>
        <button type="button" className="action-btn prop-import-button" disabled={importing}
          onClick={() => fileInputRef.current?.click()}>
          <Upload size={13} aria-hidden /> {importing ? 'Importing…' : 'Import 3D'}
        </button>
        <input ref={fileInputRef} className="prop-model-file-input" type="file"
          accept=".glb,.gltf,.obj,model/gltf-binary,model/gltf+json" onChange={importModel} />
        <button type="button" className="icon-btn" disabled={!selected} onClick={() => togglePicker('replace')} title="Replace selected asset">
          <RefreshCw size={14} aria-hidden />
        </button>
        <button type="button" className="icon-btn" disabled={!selected} onClick={duplicate} title="Duplicate selected asset">
          <Copy size={14} aria-hidden />
        </button>
        <button type="button" className="icon-btn danger" disabled={!selected} onClick={remove} title="Remove selected asset">
          <Trash2 size={14} aria-hidden />
        </button>
      </div>

      {pickerMode && (
        <div className="prop-preset-picker">
          <div className="prop-preset-picker-head">
            <strong>{pickerMode === 'replace' ? 'Replace asset' : 'Add asset'}</strong>
          </div>
          <label className="prop-search-field prop-preset-search">
            <Search size={13} aria-hidden />
            <input
              type="search"
              value={presetQuery}
              onChange={(event) => setPresetQuery(event.target.value)}
              placeholder="Search asset presets…"
              aria-label="Search asset presets"
            />
          </label>
          <div className="prop-preset-grid">
            {filteredPresets.map((preset) => (
              <button key={preset.id} type="button" onClick={() => choosePreset(preset)}>
                <PropTypeIcon type={preset.type} color={preset.color} compact />
                <span>{preset.name}</span>
                <small>{propTypeLabel(preset.type)}</small>
              </button>
            ))}
            {!filteredPresets.length && <p className="prop-library-empty">No matching presets.</p>}
          </div>
        </div>
      )}

      <div className="prop-library-list-header">
        <span>Library</span>
        <small>{assetCountLabel}</small>
      </div>

      {importError && (
        <div className="prop-import-error" role="alert">
          <span>{importError}</span>
          <button type="button" onClick={() => setImportError('')} aria-label="Dismiss import error"><X size={12} /></button>
        </div>
      )}
      <label className="prop-search-field">
        <Search size={13} aria-hidden />
        <input
          type="search"
          value={assetQuery}
          onChange={(event) => setAssetQuery(event.target.value)}
          placeholder="Search your assets…"
          aria-label="Search your prop assets"
        />
      </label>
      <div className="prop-asset-strip" role="listbox" aria-label="Terrain prop assets">
        {visibleAssets.map((asset) => (
          <button key={asset.id} type="button" role="option" aria-selected={asset.id === selected?.id}
            className={`prop-asset-card${asset.id === selected?.id ? ' active' : ''}${asset.enabled ? '' : ' disabled'}`}
            onClick={() => setSelectedId(asset.id)}>
            <PropTypeIcon type={asset.type} color={asset.color} />
            <span>{asset.name}</span>
            <small>{asset.model ? `Imported · ${propTypeLabel(asset.type)}` : propTypeLabel(asset.type)}</small>
          </button>
        ))}
        {!assets.length && <p className="prop-library-empty">No assets. Add a preset to populate the terrain.</p>}
        {!!assets.length && !filteredAssets.length && <p className="prop-library-empty">No matching assets.</p>}
      </div>
      {hasMoreAssets && (
        <button
          type="button"
          className="action-btn prop-load-more"
          onClick={() => setVisibleAssetCount((count) => count + 80)}
        >
          Show more <span>({filteredAssets.length - visibleAssetCount} remaining)</span>
        </button>
      )}

      {selected && (
        <>
          <Preview asset={selected} />
          <p className="prop-preview-hint"><Move3D size={11} aria-hidden /> Drag vertically and horizontally to rotate</p>
          <div className="prop-asset-editor">
            {selected.model && (
              <div className="prop-model-source">
                <span><strong>3D model</strong><small title={selected.model.name}>{selected.model.name}</small></span>
                <button type="button" className="icon-btn danger" title="Use the built-in mesh instead"
                  aria-label="Remove imported model" onClick={() => patchSelected({ model: null })}>
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
            )}
            <label className="prop-asset-name">
              <span>Name</span>
              <input value={nameDraft} maxLength={48} onChange={(event) => setNameDraft(event.target.value)}
                onBlur={commitName} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()} />
            </label>
            <label className="prop-asset-name">
              <span>Category</span>
              <select value={selected.type} onChange={(event) => patchSelected({ type: event.target.value })}>
                {PROP_ASSET_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select>
            </label>
            <label className="prop-asset-enabled">
              <input type="checkbox" checked={selected.enabled} onChange={(event) => patchSelected({ enabled: event.target.checked })} />
              <span>Use in terrain scattering</span>
            </label>
            <label className="prop-asset-color">
              <span>Tint</span>
              <input type="color" value={selected.color} onChange={(event) => patchSelected({ color: event.target.value })} />
              <code>{selected.color.toUpperCase()}</code>
            </label>
            <MiniSlider label="Mix weight" value={selected.density} min={0} max={2} step={0.05} onChange={(density) => patchSelected({ density })} />
            <MiniSlider label="Overall scale" value={selected.scale} min={0.25} max={2.5} step={0.05} onChange={(scale) => patchSelected({ scale })} />
            <MiniSlider label="Width" value={selected.width} min={0.5} max={1.6} step={0.01} onChange={(width) => patchSelected({ width })} />
            <MiniSlider label="Height" value={selected.height} min={0.5} max={1.6} step={0.01} onChange={(height) => patchSelected({ height })} />
          </div>
        </>
      )}
    </div>
  );
}
