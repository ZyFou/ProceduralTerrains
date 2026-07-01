import { useEffect, useRef, useState } from 'react';
import { ImageUp, Plus, RotateCcw } from 'lucide-react';
import CollapsibleGroup from './CollapsibleGroup.jsx';
import SurfaceMaterialPreviewSphere from './SurfaceMaterialPreviewSphere.jsx';
import { detectSlotFromFilename } from '../../engine/terrain/surface/SurfaceTextureDetector.js';
import {
  loadMaterialsManifest, listVariants, createVariant, getMapUrl, resolveMapUrl,
  probeUrlExists, getActiveVariant, setActiveVariant,
  setOverrideUrl, clearOverrideUrl, getOverrideUrl, MAP_SLOT_LABELS,
} from '../../engine/terrain/surface/SurfaceLibrary.js';

const PREVIEW_SLOTS = ['diffuse', 'normalDX', 'roughness', 'ao'];

function prettyVariantLabel(variant) {
  if (variant === 'base') return 'Base';
  return variant.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function nextVariantName(existing) {
  let n = 1;
  while (existing.includes(`variant_${n}`)) n += 1;
  return `variant_${n}`;
}

function FileSlotRow({ material, variant, slot, onChanged }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('checking');
  const [dragOver, setDragOver] = useState(false);
  const override = getOverrideUrl(material.id, variant, slot);

  useEffect(() => {
    let cancelled = false;
    if (override) { setStatus('custom'); return undefined; }
    setStatus('checking');
    probeUrlExists(getMapUrl(material, variant, slot)).then((exists) => {
      if (!cancelled) setStatus(exists ? 'ok' : 'missing');
    });
    return () => { cancelled = true; };
  }, [material, variant, slot, override]);

  const pick = (file) => {
    const url = URL.createObjectURL(file);
    setOverrideUrl(material.id, variant, slot, url);
    onChanged();
  };

  const reset = () => {
    clearOverrideUrl(material.id, variant, slot);
    onChanged();
  };

  return (
    <div
      className={`surface-slot-row${dragOver ? ' drag-over' : ''}`}
      data-setting-id={`surface.${material.id}.${variant}.${slot}`}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
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
        {status === 'checking' ? '…' : status === 'custom' ? 'Custom' : status === 'ok' ? 'OK' : 'Missing'}
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
          accept={slot === 'displacement' ? 'image/*,.exr' : 'image/png,image/jpeg,image/webp'}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pick(file);
            e.target.value = '';
          }}
        />
        {override && (
          <button type="button" className="file-picker-btn surface-slot-reset" onClick={reset} title="Reset to default file">
            <RotateCcw size={13} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

function AddVariantRow({ material, existing, onCreated }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const start = () => {
    setName(nextVariantName(existing));
    setAdding(true);
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const variants = await createVariant(material, name);
      onCreated(variants, name);
      setAdding(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!adding) {
    return (
      <button type="button" className="surface-variant-pill surface-variant-add" onClick={start}>
        <Plus size={12} strokeWidth={2} aria-hidden />
        Add Variant
      </button>
    );
  }

  return (
    <div className="surface-add-variant">
      <input
        type="text"
        className="surface-add-variant-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="variant_3"
        disabled={busy}
        autoFocus
      />
      <button type="button" className="file-picker-btn" onClick={submit} disabled={busy || !name.trim()}>
        {busy ? 'Creating…' : 'Create'}
      </button>
      <button type="button" className="file-picker-btn surface-slot-reset" onClick={() => setAdding(false)} disabled={busy}>
        ✕
      </button>
      {error && <p className="section-hint warning surface-add-variant-error">{error}</p>}
    </div>
  );
}

function MaterialCard({ material, mapSlots, targetId }) {
  const [variant, setVariant] = useState(() => getActiveVariant(material.id));
  const [variants, setVariants] = useState(['base']);
  const [variantsLoaded, setVariantsLoaded] = useState(false);
  const [changeTick, setChangeTick] = useState(0);
  const [dropSummary, setDropSummary] = useState(null);
  const [listDragOver, setListDragOver] = useState(false);
  const bump = () => setChangeTick((n) => n + 1);
  // ControlSection keeps its body mounted (just CSS-hidden) when collapsed, so
  // without this the sphere's WebGLRenderer + rAF loop would keep running for
  // every material card at once. Only render it while actually open.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || variantsLoaded) return;
    let cancelled = false;
    listVariants(material).then((list) => {
      if (cancelled) return;
      setVariants(list);
      setVariantsLoaded(true);
      if (!list.includes(variant)) chooseVariant(list[0] || 'base');
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variantsLoaded, material]);

  const chooseVariant = (v) => {
    setVariant(v);
    setActiveVariant(material.id, v);
  };

  const onVariantCreated = (list, created) => {
    setVariants(list);
    chooseVariant(created);
  };

  // Batch drop onto the slot list: auto-detect each dropped file's slot from
  // its filename so a whole texture pack can be dragged in at once. Individual
  // rows handle their own single-file drop first (stopPropagation), so this
  // only fires for drops on the list background / multi-file drops.
  const onBatchDrop = (e) => {
    e.preventDefault();
    setListDragOver(false);
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    const matched = [];
    const unmatched = [];
    files.forEach((file) => {
      const slot = detectSlotFromFilename(file.name);
      if (slot && mapSlots.includes(slot)) {
        setOverrideUrl(material.id, variant, slot, URL.createObjectURL(file));
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
    previewUrls[slot] = resolveMapUrl(material, variant, slot);
  });

  return (
    <CollapsibleGroup
      title={material.name}
      defaultOpen={false}
      forceOpen={targetId?.startsWith(`surface.${material.id}.`)}
      settingId={`surface.${material.id}`}
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
              <div className="surface-variant-pills">
                {variants.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`surface-variant-pill${v === variant ? ' active' : ''}`}
                    onClick={() => chooseVariant(v)}
                    title={v === variant ? 'Currently used as default for this material' : 'Preview and set as default'}
                  >
                    {prettyVariantLabel(v)}
                  </button>
                ))}
                <AddVariantRow material={material} existing={variants} onCreated={onVariantCreated} />
              </div>
              <p className="section-hint">Drag the sphere to inspect. The highlighted variant is used as this material's default.</p>
            </div>
          </div>
          <div
            key={changeTick}
            className={`surface-slot-list${listDragOver ? ' drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setListDragOver(true); }}
            onDragLeave={() => setListDragOver(false)}
            onDrop={onBatchDrop}
          >
            {mapSlots.map((slot) => (
              <FileSlotRow key={slot} material={material} variant={variant} slot={slot} onChanged={bump} />
            ))}
          </div>
          <p className="section-hint">Drop one file on a row to fill that slot, or drop several files here at once — filenames like <code>_diffuse</code> / <code>_normal_dx</code> / <code>_roughness</code> / <code>_ao</code> / <code>_displacement</code> are matched automatically.</p>
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

export default function SurfaceLibraryPanel({ settingsTarget }) {
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadMaterialsManifest()
      .then((m) => { if (!cancelled) setManifest(m); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="section-hint warning">Could not load the surface material manifest ({error}).</p>;
  if (!manifest) return <p className="section-hint">Loading surface library…</p>;

  return (
    <div className="surface-library">
      <p className="section-hint">
        Default terrain materials. Each has a <code>base/</code> texture set — drop matching files into
        <code> public/textures/terrain/&lt;material&gt;/base/</code>, drag-and-drop them below, or upload
        directly. Use <strong>Add Variant</strong> for extra look-alikes (each gets its own folder); pick a
        variant to preview it on the sphere and set it as the material's default.
      </p>
      {manifest.materials.map((material) => (
        <MaterialCard key={material.id} material={material} mapSlots={manifest.mapSlots} targetId={settingsTarget?.settingId} />
      ))}
    </div>
  );
}
