import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageUp, RefreshCw, RotateCcw } from 'lucide-react';
import { unzipSync } from 'fflate';
import CollapsibleGroup from './CollapsibleGroup.jsx';
import SurfaceMaterialPreviewSphere from './SurfaceMaterialPreviewSphere.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';
import { colorToHex } from '../../engine/style/ColorPalette.js';
import { detectSlotFromFilename } from '../../engine/terrain/surface/SurfaceTextureDetector.js';
import {
  loadMaterialsManifest, resolveCustomMapUrl,
  setOverrideUrl, clearOverrideUrl, getOverrideUrl, MAP_SLOT_LABELS,
  resetMaterialSurfaceState, SURFACE_LIBRARY_CHANGE_EVENT, CUSTOM_SURFACE_VARIANT,
  getCustomVariantKey,
} from '../../engine/terrain/surface/SurfaceLibrary.js';
import {
  SURFACE_TEXTURE_ROLE_GROUPS,
  SURFACE_TEXTURE_VARIANT_COUNT,
} from '../../engine/terrain/surface/SurfaceTextureRoles.js';
import {
  SURFACE_TEXTURE_SOURCE,
  normalizeSurfaceTextureSource,
  sourceUsesTextureAtlas,
} from '../../engine/terrain/surface/SurfaceTextureSources.js';

const PREVIEW_SLOTS = ['diffuse', 'normalDX', 'roughness', 'ao'];
const RENDERED_SLOTS = new Set(PREVIEW_SLOTS);
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|avif|gif|bmp)$/i;
const ZIP_EXT_RE = /\.zip$/i;

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

function layerStatusClass(status) {
  if (status === 'ready') return 'custom';
  if (status === 'missingOptional') return 'missing-optional';
  return 'missing';
}

function coverageText(coverage) {
  if (!coverage) return 'Custom atlas not baked';
  return `${coverage.diffuseReady}/${coverage.total} custom roles ready`;
}

function previewUrlsFor(role, variantIndex) {
  const urls = {};
  PREVIEW_SLOTS.forEach((slot) => {
    urls[slot] = resolveCustomMapUrl(role, slot, variantIndex);
  });
  return urls;
}

function mimeForTextureName(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'application/octet-stream';
}

function isZipFile(file) {
  return ZIP_EXT_RE.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}

function isTextureEntryPath(name) {
  const normalized = name.replace(/\\/g, '/').toLowerCase();
  return normalized.startsWith('textures/') || normalized.includes('/textures/');
}

async function textureFilesFromZip(file, mapSlots) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(bytes);
  const matchedBySlot = new Map();
  const unmatched = [];

  Object.entries(entries).forEach(([entryName, data]) => {
    if (!data?.length || !isTextureEntryPath(entryName) || !IMAGE_EXT_RE.test(entryName)) return;
    const slot = detectSlotFromFilename(entryName);
    if (!slot || !mapSlots.includes(slot)) {
      unmatched.push(entryName.split(/[\\/]/).pop() || entryName);
      return;
    }
    if (matchedBySlot.has(slot)) return;
    const blob = new Blob([data], { type: mimeForTextureName(entryName) });
    matchedBySlot.set(slot, {
      name: entryName.split(/[\\/]/).pop() || entryName,
      url: URL.createObjectURL(blob),
    });
  });

  return { matchedBySlot, unmatched };
}

async function importDroppedTextures({ files, role, mapSlots, variantIndex }) {
  const matched = [];
  const unmatched = [];
  const variantKey = getCustomVariantKey(variantIndex);
  const filledSlots = new Set();

  for (const file of files) {
    if (isZipFile(file)) {
      const { matchedBySlot, unmatched: zipUnmatched } = await textureFilesFromZip(file, mapSlots);
      for (const [slot, item] of matchedBySlot.entries()) {
        if (filledSlots.has(slot)) continue;
        setOverrideUrl(role.id, variantKey, slot, item.url);
        filledSlots.add(slot);
        matched.push(`${MAP_SLOT_LABELS[slot]} (${item.name})`);
      }
      if (!matchedBySlot.size) unmatched.push(file.name);
      else unmatched.push(...zipUnmatched.slice(0, 4));
      continue;
    }

    const slot = detectSlotFromFilename(file.name);
    if (slot && mapSlots.includes(slot) && IMAGE_EXT_RE.test(file.name) && !filledSlots.has(slot)) {
      setOverrideUrl(role.id, variantKey, slot, URL.createObjectURL(file));
      filledSlots.add(slot);
      matched.push(`${MAP_SLOT_LABELS[slot]} (${file.name})`);
    } else {
      unmatched.push(file.name);
    }
  }

  return { matched, unmatched: unmatched.slice(0, 6) };
}

function FileSlotRow({ role, variantIndex, slot, onChanged }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('checking');
  const [dragOver, setDragOver] = useState(false);
  const variantKey = getCustomVariantKey(variantIndex);
  const directOverride = getOverrideUrl(role.id, variantKey, slot);
  const resolved = resolveCustomMapUrl(role, slot, variantIndex);

  useEffect(() => {
    setStatus(resolved ? 'custom' : 'missing');
  }, [resolved]);

  const pick = (file) => {
    const url = URL.createObjectURL(file);
    setOverrideUrl(role.id, variantKey, slot, url);
    onChanged();
  };

  const reset = () => {
    clearOverrideUrl(role.id, variantKey, slot);
    if (variantIndex === 0) {
      clearOverrideUrl(role.id, CUSTOM_SURFACE_VARIANT, slot);
      if (role.id === 'swamp') clearOverrideUrl('mud', CUSTOM_SURFACE_VARIANT, slot);
    }
    onChanged();
  };

  return (
    <div
      className={`surface-slot-row${dragOver ? ' drag-over' : ''}`}
      data-setting-id={`surface.${role.id}.v${variantIndex}.${slot}`}
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
          <span>{directOverride || resolved ? 'Replace' : 'Upload'}</span>
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
        {resolved && (
          <button type="button" className="file-picker-btn surface-slot-reset" onClick={reset} title="Clear upload">
            <RotateCcw size={13} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

function VariantBlock({ role, variantIndex, mapSlots, atlasVariant, onMaterialChanged }) {
  const [dropSummary, setDropSummary] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const urls = previewUrlsFor(role, variantIndex);
  const layerStatus = atlasVariant?.status ?? 'notBaked';
  const statusLabel = LAYER_STATUS_LABEL[layerStatus] ?? 'Not baked';

  const onBatchDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    setImporting(true);
    try {
      // Drop a ZIP containing textures/*_diff_*, *_nor_dx_*, *_rough_* and *_ao_*,
      // or drop loose image maps directly onto the active variant.
      // The first valid map per slot wins so accidental duplicates are ignored.
      const { matched, unmatched } = await importDroppedTextures({ files, role, mapSlots, variantIndex });
      if (matched.length) onMaterialChanged?.();
      setDropSummary({ matched, unmatched });
    } catch (err) {
      setDropSummary({ matched: [], unmatched: [`${files[0]?.name || 'ZIP'} import failed`] });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className={`surface-variant-block${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        setDragOver(false);
      }}
      onDrop={onBatchDrop}
    >
      <div className="surface-variant-head">
        <span className="surface-variant-title">Variant {variantIndex + 1}</span>
        <span className="surface-variant-drop-chip">{importing ? 'Importing' : 'Drop ZIP / maps'}</span>
        <span className={`surface-layer-status surface-slot-status-${layerStatusClass(layerStatus)}`}>
          {statusLabel}
        </span>
      </div>
      <div className="surface-material-body">
        <SurfaceMaterialPreviewSphere
          diffuseUrl={urls.diffuse}
          normalUrl={urls.normalDX}
          roughnessUrl={urls.roughness}
          aoUrl={urls.ao}
        />
        <div className="surface-material-side">
          <div className="surface-variant-map-badges">
            {mapSlots.map((slot) => (
              <span
                key={slot}
                className={`surface-map-badge${urls[slot] ? ' filled' : ''}`}
                title={MAP_SLOT_LABELS[slot]}
              >
                {MAP_SLOT_LABELS[slot]}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="surface-slot-list">
        {mapSlots.map((slot) => (
          <FileSlotRow
            key={`${variantIndex}-${slot}`}
            role={role}
            variantIndex={variantIndex}
            slot={slot}
            onChanged={onMaterialChanged}
          />
        ))}
      </div>
      {dropSummary && (
        <p className="section-hint surface-drop-summary">
          {dropSummary.matched.length > 0 && <>Matched: {dropSummary.matched.join(', ')}. </>}
          {dropSummary.unmatched.length > 0 && <span className="warning">Could not match: {dropSummary.unmatched.join(', ')}.</span>}
        </p>
      )}
    </div>
  );
}

function variantFromTarget(targetId, roleId) {
  const match = targetId?.match(new RegExp(`^surface\\.${roleId}\\.v(\\d+)\\.`));
  if (!match) return 0;
  return Math.max(0, Math.min(SURFACE_TEXTURE_VARIANT_COUNT - 1, Number(match[1]) || 0));
}

function firstAvailableVariantIndex(role, atlasLayer) {
  for (let variantIndex = 0; variantIndex < SURFACE_TEXTURE_VARIANT_COUNT; variantIndex += 1) {
    if (!resolveCustomMapUrl(role, 'diffuse', variantIndex)) return variantIndex;
  }
  const variants = atlasLayer?.variants || [];
  const emptyIndex = variants.findIndex((variant) => !variant?.hasDiffuse);
  return emptyIndex >= 0 ? emptyIndex : 0;
}

function RoleCard({ role, mapSlots, targetId, atlasLayer, palette, onMaterialChanged }) {
  const [open, setOpen] = useState(false);
  const [activeVariant, setActiveVariant] = useState(() => variantFromTarget(targetId, role.id));
  const [forceOpenAfterDrop, setForceOpenAfterDrop] = useState(false);
  const [roleDragOver, setRoleDragOver] = useState(false);
  const paletteHex = colorToHex(palette?.[role.id] ?? [0.5, 0.5, 0.5]);
  const layerStatus = atlasLayer?.status ?? 'notBaked';
  const statusLabel = LAYER_STATUS_LABEL[layerStatus] ?? 'Not baked';

  useEffect(() => {
    if (targetId?.startsWith(`surface.${role.id}.`)) {
      setActiveVariant(variantFromTarget(targetId, role.id));
      setOpen(true);
    }
  }, [role.id, targetId]);

  const resetMaterial = () => {
    resetMaterialSurfaceState(role.id);
    onMaterialChanged?.();
  };

  return (
    <div
      className={`surface-role-drop-zone${roleDragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setRoleDragOver(true);
      }}
      onDragLeave={() => setRoleDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setRoleDragOver(false);
        const files = [...(e.dataTransfer.files || [])];
        if (!files.length) return;
        const nextVariant = firstAvailableVariantIndex(role, atlasLayer);
        setActiveVariant(nextVariant);
        setOpen(true);
        setForceOpenAfterDrop(true);
        try {
          const { matched } = await importDroppedTextures({ files, role, mapSlots, variantIndex: nextVariant });
          if (matched.length) onMaterialChanged?.();
        } catch {
          // Variant panel import shows detailed failures; closed-row drops stay quiet.
        }
      }}
    >
      <CollapsibleGroup
        title={role.label}
        defaultOpen={false}
        forceOpen={targetId?.startsWith(`surface.${role.id}.`) || forceOpenAfterDrop}
        settingId={`surface.${role.id}`}
        statusDot={layerStatus === 'ready' ? 'active' : null}
        onToggle={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setForceOpenAfterDrop(false);
        }}
      >
        {open && (
          <>
            <div className="surface-role-head">
              <span className="surface-role-swatch" style={{ background: paletteHex }} />
              <span className={`surface-layer-status surface-slot-status-${layerStatusClass(layerStatus)}`}>
                {statusLabel}
              </span>
              <span className="surface-role-count">
                {atlasLayer?.readyVariants ?? 0}/{SURFACE_TEXTURE_VARIANT_COUNT} variants
              </span>
              <button
                type="button"
                className="file-picker-btn surface-card-reset"
                onClick={resetMaterial}
                title="Clear this role's custom uploads"
              >
                <RotateCcw size={13} strokeWidth={1.8} aria-hidden />
              </button>
            </div>
            <div className="surface-variant-tabs" role="tablist" aria-label={`${role.label} variants`}>
              {Array.from({ length: SURFACE_TEXTURE_VARIANT_COUNT }, (_, variantIndex) => {
                const variant = atlasLayer?.variants?.[variantIndex];
                const ready = variant?.hasDiffuse;
                const active = activeVariant === variantIndex;
                return (
                  <button
                    key={`${role.id}-tab-${variantIndex}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`surface-variant-tab${active ? ' active' : ''}${ready ? ' ready' : ''}`}
                    onClick={() => setActiveVariant(variantIndex)}
                  >
                    <span>V{variantIndex + 1}</span>
                    <small>{ready ? 'Ready' : 'Empty'}</small>
                  </button>
                );
              })}
            </div>
            <VariantBlock
              key={`${role.id}-${activeVariant}`}
              role={role}
              variantIndex={activeVariant}
              mapSlots={mapSlots}
              atlasVariant={atlasLayer?.variants?.[activeVariant]}
              onMaterialChanged={onMaterialChanged}
            />
          </>
        )}
      </CollapsibleGroup>
    </div>
  );
}

const slider = (key, label, min, max, step, opts = {}) => ({ key, label, min, max, step, ...opts });
const SURFACE_MODE_SLIDERS = [
  slider('surfaceTextureScale', 'Scale', 0.25, 4, 0.05, { digits: 2, fallback: 1 }),
  slider('surfaceTextureBreakup', 'Break Tiling', 0, 1, 0.02, { digits: 2, fallback: 0.5 }),
  slider('surfaceTextureBlend', 'Blend Textures', 0, 1, 0.02, { digits: 2, fallback: 0.35 }),
  slider('surfaceTexturePaletteInfluence', 'Palette Influence', 0, 1, 0.02, { digits: 2, fallback: 0.6 }),
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

  return (
    <div className="surface-mode-bar">
      <SelectRow
        label="Surface Source"
        value={source}
        options={[
          { value: SURFACE_TEXTURE_SOURCE.PROCEDURAL, label: 'Procedural' },
          { value: SURFACE_TEXTURE_SOURCE.CUSTOM, label: 'Custom Materials' },
        ]}
        onChange={(value) => onParam('surfaceTextureSource', value)}
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
              {applying ? 'Building atlas' : coverageText(coverage)}
            </span>
          </div>
          {SURFACE_MODE_SLIDERS.map((def) => (
            <SliderCtl
              key={def.key}
              def={def}
              value={params[def.key] ?? def.fallback ?? 1}
              onChange={(v) => onParam(def.key, v)}
              settingId={`surface.${def.key}`}
            />
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
  const palette = ctx?.planetStyleProps?.planetStyle?.palette || {};
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
  const layersById = new Map((status?.layers || []).map((layer) => [layer.id, layer]));
  const showMaterials = sourceUsesTextureAtlas(source);

  return (
    <div className="surface-library">
      <SurfaceModeControls ctx={ctx} source={source} onBake={bake} applying={applying} status={status} />
      {showMaterials && SURFACE_TEXTURE_ROLE_GROUPS.map((group) => (
        <div key={group.id} className="surface-role-group">
          <div className="surface-role-group-title">{group.label}</div>
          {group.roles.map((role) => (
            <RoleCard
              key={`${source}-${role.id}`}
              role={role}
              mapSlots={mapSlots}
              targetId={settingsTarget?.settingId}
              atlasLayer={layersById.get(role.id)}
              palette={palette}
              onMaterialChanged={scheduleBake}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
