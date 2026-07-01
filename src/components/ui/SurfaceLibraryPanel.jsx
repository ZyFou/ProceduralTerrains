import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageUp, RefreshCw, RotateCcw } from 'lucide-react';
import CollapsibleGroup from './CollapsibleGroup.jsx';
import SurfaceMaterialPreviewSphere from './SurfaceMaterialPreviewSphere.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';
import { detectSlotFromFilename } from '../../engine/terrain/surface/SurfaceTextureDetector.js';
import {
  loadMaterialsManifest, resolveCustomMapUrl,
  setOverrideUrl, clearOverrideUrl, getOverrideUrl, MAP_SLOT_LABELS,
  resetMaterialSurfaceState, SURFACE_LIBRARY_CHANGE_EVENT, CUSTOM_SURFACE_VARIANT,
} from '../../engine/terrain/surface/SurfaceLibrary.js';
import { SURFACE_TEXTURE_LAYERS } from '../../engine/terrain/surface/terrainSurfaceTextureGLSL.js';
import {
  SURFACE_TEXTURE_SOURCE,
  normalizeSurfaceTextureSource,
  sourceUsesTextureAtlas,
} from '../../engine/terrain/surface/SurfaceTextureSources.js';

const PREVIEW_SLOTS = ['diffuse', 'normalDX', 'roughness', 'ao'];
const RENDERED_SLOTS = new Set(PREVIEW_SLOTS);
const RENDERED_MATERIAL_IDS = new Set(SURFACE_TEXTURE_LAYERS);

const STATUS_LABEL = {
  checking: '...',
  custom: 'Custom',
  missing: 'Missing',
};

const LAYER_STATUS_LABEL = {
  notBaked: 'Not Baked',
  ready: 'Ready',
  missingDiffuse: 'Missing Diffuse',
  missingOptional: 'Missing Optional Maps',
};

function slotUrlForSource(material, source, slot) {
  if (source === SURFACE_TEXTURE_SOURCE.CUSTOM) return resolveCustomMapUrl(material, slot);
  return null;
}

function layerStatusClass(status) {
  if (status === 'ready') return 'custom';
  if (status === 'missingOptional') return 'missing-optional';
  return 'missing';
}

function coverageText(source, coverage) {
  if (!coverage) return 'Custom atlas not baked';
  return `${coverage.diffuseReady}/${coverage.total} custom diffuse layers ready`;
}

function FileSlotRow({ material, source, slot, onChanged }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('checking');
  const [dragOver, setDragOver] = useState(false);
  const override = getOverrideUrl(material.id, CUSTOM_SURFACE_VARIANT, slot);

  useEffect(() => {
    setStatus(override ? 'custom' : 'missing');
  }, [override]);

  const pick = (file) => {
    const url = URL.createObjectURL(file);
    setOverrideUrl(material.id, CUSTOM_SURFACE_VARIANT, slot, url);
    onChanged();
  };

  const reset = () => {
    clearOverrideUrl(material.id, CUSTOM_SURFACE_VARIANT, slot);
    onChanged();
  };

  return (
    <div
      className={`surface-slot-row${dragOver ? ' drag-over' : ''}`}
      data-setting-id={`surface.${material.id}.${source}.${slot}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) pick(file);
      }}
    >
      <span className="surface-slot-label">{MAP_SLOT_LABELS[slot]}</span>
      <span className={`surface-slot-status surface-slot-status-${status}`}>
        {STATUS_LABEL[status] ?? status}
      </span>
      <div className="file-picker surface-slot-picker">
        <button type="button" className="file-picker-btn" onClick={() => inputRef.current?.click()}>
          <ImageUp size={13} strokeWidth={1.75} aria-hidden />
          <span>{override ? 'Replace' : 'Upload'}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          className="file-picker-input"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pick(file);
            e.target.value = '';
          }}
        />
        {override && (
          <button type="button" className="file-picker-btn surface-slot-reset" onClick={reset} title="Clear upload">
            <RotateCcw size={13} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

function MaterialCard({ material, mapSlots, source, targetId, atlasLayer, onMaterialChanged }) {
  const [changeTick, setChangeTick] = useState(0);
  const [dropSummary, setDropSummary] = useState(null);
  const [listDragOver, setListDragOver] = useState(false);
  const [open, setOpen] = useState(false);
  const custom = source === SURFACE_TEXTURE_SOURCE.CUSTOM;

  const bump = () => {
    setChangeTick((n) => n + 1);
    onMaterialChanged?.();
  };

  const resetMaterial = () => {
    resetMaterialSurfaceState(material.id);
    setDropSummary(null);
    bump();
  };

  const onBatchDrop = (e) => {
    if (!custom) return;
    e.preventDefault();
    setListDragOver(false);
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    const matched = [];
    const unmatched = [];
    files.forEach((file) => {
      const slot = detectSlotFromFilename(file.name);
      if (slot && mapSlots.includes(slot)) {
        setOverrideUrl(material.id, CUSTOM_SURFACE_VARIANT, slot, URL.createObjectURL(file));
        matched.push(MAP_SLOT_LABELS[slot]);
      } else {
        unmatched.push(file.name);
      }
    });
    if (matched.length) bump();
    setDropSummary({ matched, unmatched });
  };

  const previewUrls = {};
  PREVIEW_SLOTS.forEach((slot) => {
    previewUrls[slot] = slotUrlForSource(material, source, slot);
  });

  const layerStatus = atlasLayer?.status ?? 'notBaked';
  const statusLabel = LAYER_STATUS_LABEL[layerStatus] ?? 'Not baked';

  return (
    <CollapsibleGroup
      title={material.name}
      defaultOpen={false}
      forceOpen={targetId?.startsWith(`surface.${material.id}.`)}
      settingId={`surface.${material.id}`}
      statusDot={layerStatus === 'ready' ? 'active' : null}
      onToggle={setOpen}
    >
      {open && (
        <>
          <div className="surface-material-body">
            <SurfaceMaterialPreviewSphere
              diffuseUrl={previewUrls.diffuse}
              normalUrl={previewUrls.normalDX}
              roughnessUrl={previewUrls.roughness}
              aoUrl={previewUrls.ao}
            />
            <div className="surface-material-side">
              <div className="surface-card-actions">
                <span className={`surface-layer-status surface-slot-status-${layerStatusClass(layerStatus)}`}>
                  {statusLabel}
                </span>
                {custom && (
                  <button
                    type="button"
                    className="file-picker-btn surface-card-reset"
                    onClick={resetMaterial}
                    title="Clear this material's custom uploads"
                  >
                    <RotateCcw size={13} strokeWidth={1.8} aria-hidden />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div
            key={changeTick}
            className={`surface-slot-list${listDragOver ? ' drag-over' : ''}`}
            onDragOver={(e) => {
              if (!custom) return;
              e.preventDefault();
              setListDragOver(true);
            }}
            onDragLeave={() => setListDragOver(false)}
            onDrop={onBatchDrop}
          >
            {mapSlots.map((slot) => (
              <FileSlotRow key={slot} material={material} source={source} slot={slot} onChanged={bump} />
            ))}
          </div>
          {dropSummary && (
            <p className="section-hint surface-drop-summary">
              {dropSummary.matched.length > 0 && <>Matched: {dropSummary.matched.join(', ')}. </>}
              {dropSummary.unmatched.length > 0 && <span className="warning">Could not match: {dropSummary.unmatched.join(', ')}.</span>}
            </p>
          )}
        </>
      )}
    </CollapsibleGroup>
  );
}

const slider = (key, label, min, max, step, opts = {}) => ({ key, label, min, max, step, ...opts });
const SURFACE_MODE_SLIDERS = [
  slider('surfaceTextureScale', 'Scale', 0.25, 4, 0.05, { digits: 2, fallback: 1 }),
  slider('surfaceTextureBreakup', 'Break Tiling', 0, 1, 0.02, { digits: 2, fallback: 0 }),
  slider('surfaceTextureBlend', 'Blend Textures', 0, 1, 0.02, { digits: 2, fallback: 0 }),
  slider('surfaceTextureNormal', 'Normal Strength', 0, 2, 0.05, { digits: 2, fallback: 1 }),
];

function SurfaceModeControls({ ctx, source, onBake, applying, status }) {
  const { params, onParam } = ctx;
  const textureMode = sourceUsesTextureAtlas(source);
  const coverage = status?.coverage;
  const coverageClass = !textureMode
    ? ''
    : coverage?.missingDiffuse ? 'warning'
      : coverage?.missingOptional ? 'pending'
        : 'ok';

  const setSource = async (value) => {
    onParam('surfaceTextureSource', value);
  };

  return (
    <div className="surface-mode-bar">
      <SelectRow
        label="Surface Source"
        value={source}
        options={[
          { value: SURFACE_TEXTURE_SOURCE.PROCEDURAL, label: 'Procedural' },
          { value: SURFACE_TEXTURE_SOURCE.CUSTOM, label: 'Custom Materials' },
        ]}
        onChange={setSource}
        settingId="surface.mode"
        info="Procedural uses shader colours. Custom Materials uses only uploaded maps and shows missing layers in the viewport."
      />
      {textureMode && (
        <>
          <div className="surface-apply-row">
            <button type="button" className="action-btn primary" onClick={() => onBake({ source, force: true })} disabled={applying}>
              <RefreshCw size={13} strokeWidth={1.8} aria-hidden />
              {applying ? 'Baking...' : 'Bake Custom Materials'}
            </button>
            <span className={`surface-apply-status ${coverageClass}`}>
              {applying ? 'Building atlas' : coverageText(source, coverage)}
            </span>
          </div>
          {SURFACE_MODE_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={params[def.key] ?? def.fallback ?? 1} onChange={(v) => onParam(def.key, v)} settingId={`surface.${def.key}`} />
          ))}
          <ToggleRow
            label="Triplanar Projection"
            value={params.surfaceTextureTriplanar !== false}
            onChange={(v) => onParam('surfaceTextureTriplanar', v)}
            settingId="surface.surfaceTextureTriplanar"
            info="Blends X/Y/Z projections so cliffs don't stretch. Off = cheaper planar world-XZ."
          />
        </>
      )}
    </div>
  );
}

export default function SurfaceLibraryPanel({ ctx }) {
  const settingsTarget = ctx?.settingsTarget;
  const source = normalizeSurfaceTextureSource(ctx?.params || {});
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState(null);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState(null);
  const bakeTimerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadMaterialsManifest()
      .then((m) => { if (!cancelled) setManifest(m); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onChanged = () => setLibraryRevision((n) => n + 1);
    window.addEventListener(SURFACE_LIBRARY_CHANGE_EVENT, onChanged);
    return () => window.removeEventListener(SURFACE_LIBRARY_CHANGE_EVENT, onChanged);
  }, []);

  const bake = useCallback(async ({ source: requestedSource = source, force = false } = {}) => {
    if (!ctx?.onApplySurfaceTextures || !sourceUsesTextureAtlas(requestedSource)) {
      setStatus(null);
      return null;
    }
    setApplying(true);
    setStatus((cur) => ({ ...(cur || {}), source: requestedSource, building: true }));
    try {
      const res = await ctx.onApplySurfaceTextures({ source: requestedSource, force });
      setStatus(res);
      return res;
    } catch {
      setStatus({ source: requestedSource, error: true });
      return null;
    } finally {
      setApplying(false);
    }
  }, [ctx, source]);

  const scheduleBake = useCallback(() => {
    if (!sourceUsesTextureAtlas(source)) return;
    setStatus((cur) => ({ ...(cur || {}), source, dirty: true }));
    if (bakeTimerRef.current) window.clearTimeout(bakeTimerRef.current);
    bakeTimerRef.current = window.setTimeout(() => {
      bakeTimerRef.current = null;
      bake({ source, force: true });
    }, 160);
  }, [bake, source]);

  useEffect(() => () => {
    if (bakeTimerRef.current) window.clearTimeout(bakeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!sourceUsesTextureAtlas(source)) {
      setStatus(null);
      return;
    }
    if (status?.source !== source || (!status?.coverage && !status?.building)) bake({ source });
  }, [bake, source, status?.source, status?.coverage, status?.building]);

  useEffect(() => {
    if (libraryRevision && sourceUsesTextureAtlas(source)) scheduleBake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryRevision]);

  if (error) return <p className="section-hint warning">Could not load the surface material manifest ({error}).</p>;
  if (!manifest) return <p className="section-hint">Loading surface library...</p>;

  const mapSlots = manifest.mapSlots.filter((slot) => RENDERED_SLOTS.has(slot));
  const materials = manifest.materials.filter((material) => RENDERED_MATERIAL_IDS.has(material.id));
  const layersById = new Map((status?.layers || []).map((layer) => [layer.id, layer]));
  const showMaterials = sourceUsesTextureAtlas(source);

  return (
    <div className="surface-library">
      <SurfaceModeControls ctx={ctx} source={source} onBake={bake} applying={applying} status={status} />
      {showMaterials && materials.map((material) => (
        <MaterialCard
          key={`${source}-${material.id}`}
          material={material}
          mapSlots={mapSlots}
          source={source}
          targetId={settingsTarget?.settingId}
          atlasLayer={layersById.get(material.id)}
          onMaterialChanged={scheduleBake}
        />
      ))}
    </div>
  );
}
