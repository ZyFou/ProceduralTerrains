import React, { useCallback, useRef, useState } from 'react';
import SidePanel, { PanelTabs } from './panels/SidePanel.jsx';
import { SliderCtl, ToggleRow, SelectRow } from './controls.jsx';
import {
  NOISE_TYPES, ADDABLE_TYPES, getNoiseType,
} from '../engine/terrain/noise/noiseTypes.js';
import {
  cloneStack, addLayer, duplicateLayer, removeLayer,
  updateLayer, updateLayerParam, moveLayer, BLEND_MODES, MAX_LAYERS,
} from '../engine/terrain/noise/NoiseStack.js';
import { BLEND_LABELS } from '../engine/terrain/noise/blendModes.js';
import { MASK_TYPES, defaultMask } from '../engine/terrain/noise/masks.js';
import {
  NOISE_STACK_PRESETS, NOISE_STACK_PRESET_KEYS, buildNoiseStackPreset,
} from '../engine/terrain/noise/noisePresets.js';

// ---- icons (inline SVGs) ---------------------------------------------------
const GripIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style={{ cursor: 'var(--cursor-grab)', opacity: 0.45 }}>
    <circle cx="5" cy="3" r="1.2" /><circle cx="11" cy="3" r="1.2" />
    <circle cx="5" cy="8" r="1.2" /><circle cx="11" cy="8" r="1.2" />
    <circle cx="5" cy="13" r="1.2" /><circle cx="11" cy="13" r="1.2" />
  </svg>
);
const EyeIcon = ({ on }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" style={{ opacity: on ? 1 : 0.35 }}>
    {on
      ? <><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.2" /><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" /></>
      : <><path d="M2.5 13.5l11-11M1.5 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.2" /></>}
  </svg>
);
const SoloIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
    <circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="8" cy="8" r="1.5" fill="currentColor" />
  </svg>
);
const DupIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
    <rect x="1" y="4" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M6 4V2.5A1.5 1.5 0 0 1 7.5 1H13.5A1.5 1.5 0 0 1 15 2.5V10.5A1.5 1.5 0 0 1 13.5 12H11" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
    <path d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.2" />
    <path d="M4.5 4l.8 9a1 1 0 0 0 1 .9h3.4a1 1 0 0 0 1-.9l.8-9" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

// ---- blend mode options for select ------------------------------------------
const BLEND_OPTIONS = BLEND_MODES.map((m) => ({ value: m, label: BLEND_LABELS[m] || m }));
const OUTPUT_MIN_DEF = { key: 'outputMin', label: 'Min', min: -1, max: 1, step: 0.01, digits: 2, info: 'Raw stack value mapped to zero when output normalization is enabled.' };
const OUTPUT_MAX_DEF = { key: 'outputMax', label: 'Max', min: 0.5, max: 3, step: 0.01, digits: 2, info: 'Raw stack value mapped to full height before the soft clamp.' };
const OUTPUT_RANGE_GAP = 0.01;

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ---- add-layer type menu items (grouped) ------------------------------------
const TYPE_GROUPS = [
  { label: 'Height', items: ADDABLE_TYPES.filter((t) => { const d = getNoiseType(t); return d && d.category === 'height'; }) },
  { label: 'Modifier', items: ADDABLE_TYPES.filter((t) => { const d = getNoiseType(t); return d && d.category === 'modifier'; }) },
];

// ---- drag & drop state (module-scoped to avoid re-render churn) -------------
let _dragIdx = -1;

// ============================================================================
// NoiseLayerItem — collapsed / expanded single layer in the stack list
// ============================================================================
function NoiseLayerItem({
  layer, index, total, expanded, onToggleExpand,
  onUpdate, onUpdateParam, onDuplicate, onRemove, onSolo, soloActive,
  onDragStart, onDragEnter, onDragEnd,
}) {
  const def = getNoiseType(layer.type);
  if (!def) return null;

  const isSolo = soloActive === layer.id;
  const hasMasks = (layer.masks || []).filter((m) => m.enabled !== false).length > 0;

  return (
    <div
      className={`nl-item${expanded ? ' expanded' : ''}${!layer.enabled ? ' disabled' : ''}${isSolo ? ' solo' : ''}`}
      draggable={!expanded}
      onDragStart={(e) => {
        // Only allow drag from the header row (grip area); cancel if the user
        // is interacting with sliders / inputs / buttons inside the body.
        if (e.target.closest('.nl-body')) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(index);
      }}
      onDragEnter={() => onDragEnter(index)}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
    >
      {/* collapsed header */}
      <div className="nl-header" onClick={() => onToggleExpand(layer.id)}>
        <span className="nl-grip" onMouseDown={(e) => e.stopPropagation()}><GripIcon /></span>
        <button type="button" className="nl-vis" title={layer.enabled ? 'Disable layer' : 'Enable layer'}
          onClick={(e) => { e.stopPropagation(); onUpdate(layer.id, { enabled: !layer.enabled }); }}>
          <EyeIcon on={layer.enabled} />
        </button>
        <span className="nl-name" title={layer.name}>{layer.name}</span>
        {def.badge && <span className={`nl-badge nl-badge-${def.badge.toLowerCase()}`}>{def.badge}</span>}
        <span className="nl-type-tag">{def.label}</span>
        <span className="nl-strength-compact">{Math.round(layer.strength * 100)}%</span>
      </div>

      {/* expanded detail */}
      {expanded && (
        <div className="nl-body">
          {/* action bar */}
          <div className="nl-actions">
            <button type="button" className={`nl-icon-btn${isSolo ? ' active' : ''}`} title="Solo preview" onClick={() => onSolo(isSolo ? null : layer.id)}><SoloIcon /></button>
            <button type="button" className="nl-icon-btn" title="Duplicate" onClick={() => onDuplicate(layer.id)} disabled={total >= MAX_LAYERS}><DupIcon /></button>
            <button type="button" className="nl-icon-btn danger" title="Delete" onClick={() => onRemove(layer.id)} disabled={total <= 0}><TrashIcon /></button>
          </div>

          {/* name */}
          <div className="nl-field">
            <label className="nl-label">Name</label>
            <input className="nl-input" type="text" value={layer.name}
              onChange={(e) => onUpdate(layer.id, { name: e.target.value })} />
          </div>

          {/* blend mode */}
          <SelectRow label="Blend Mode" value={layer.blendMode} options={BLEND_OPTIONS}
            onChange={(v) => onUpdate(layer.id, { blendMode: v })} />

          {/* strength slider */}
          <SliderCtl
            def={{ key: '_str', label: 'Strength', min: 0, max: 2, step: 0.01, digits: 2 }}
            value={layer.strength}
            onChange={(v) => onUpdate(layer.id, { strength: v })}
          />

          {/* seed offset */}
          <SliderCtl
            def={{ key: '_seed', label: 'Seed Offset', min: 0, max: 20, step: 1, digits: 0 }}
            value={layer.seedOffset}
            onChange={(v) => onUpdate(layer.id, { seedOffset: v })}
          />

          {/* type-specific params */}
          {def.params.map((p) => {
            if (p.type === 'enum') {
              return (
                <SelectRow key={p.key} label={p.label}
                  value={layer.params[p.key] ?? p.default}
                  options={p.options}
                  settingId={p.settingId}
                  onChange={(v) => onUpdateParam(layer.id, p.key, Number(v))} />
              );
            }
            return (
              <SliderCtl key={p.key}
                def={{ ...p, key: `_${p.key}` }}
                value={layer.params[p.key] ?? p.default}
                settingId={p.settingId}
                onChange={(v) => onUpdateParam(layer.id, p.key, v)} />
            );
          })}

          {/* masks section */}
          <MaskSection layer={layer} onUpdate={onUpdate} />
        </div>
      )}
    </div>
  );
}

// ---- masks -----------------------------------------------------------------
function MaskSection({ layer, onUpdate }) {
  const masks = layer.masks || [];
  const available = MASK_TYPES.filter((mt) => !mt.soon && !masks.some((m) => m.type === mt.id));

  const addMask = (type) => {
    const m = defaultMask(type);
    onUpdate(layer.id, { masks: [...masks, m] });
  };
  const removeMask = (type) => {
    onUpdate(layer.id, { masks: masks.filter((m) => m.type !== type) });
  };
  const setMaskParam = (type, key, value) => {
    onUpdate(layer.id, {
      masks: masks.map((m) => m.type === type ? { ...m, params: { ...m.params, [key]: value } } : m),
    });
  };
  const toggleMask = (type) => {
    onUpdate(layer.id, {
      masks: masks.map((m) => m.type === type ? { ...m, enabled: !m.enabled } : m),
    });
  };
  const toggleInvert = (type) => {
    onUpdate(layer.id, {
      masks: masks.map((m) => m.type === type ? { ...m, invert: !m.invert } : m),
    });
  };

  return (
    <div className="nl-masks">
      <div className="nl-masks-header">
        <span className="nl-label">Masks</span>
        {available.length > 0 && (
          <select className="nl-mask-add" value="" onChange={(e) => { if (e.target.value) addMask(e.target.value); e.target.value = ''; }}>
            <option value="">+ Add…</option>
            {available.map((mt) => <option key={mt.id} value={mt.id}>{mt.label}</option>)}
          </select>
        )}
      </div>
      {masks.map((m) => (
        <MaskItem key={m.type} mask={m} onRemove={removeMask}
          onToggle={toggleMask} onInvert={toggleInvert} onParam={setMaskParam} />
      ))}
      {masks.length === 0 && <span className="nl-hint">No masks — layer applies everywhere.</span>}
    </div>
  );
}

function MaskItem({ mask, onRemove, onToggle, onInvert, onParam }) {
  const label = MASK_TYPES.find((mt) => mt.id === mask.type)?.label ?? mask.type;
  return (
    <div className={`nl-mask${mask.enabled === false ? ' disabled' : ''}`}>
      <div className="nl-mask-row">
        <button type="button" className="nl-vis" onClick={() => onToggle(mask.type)}>
          <EyeIcon on={mask.enabled !== false} />
        </button>
        <span className="nl-mask-label">{label}</span>
        <ToggleRow label="Invert" value={!!mask.invert} onChange={() => onInvert(mask.type)} />
        <button type="button" className="nl-icon-btn danger" title="Remove mask" onClick={() => onRemove(mask.type)}>
          <TrashIcon />
        </button>
      </div>
      {mask.type === 'height' && mask.enabled !== false && (
        <>
          <SliderCtl def={{ key: '_hmin', label: 'Min', min: -0.5, max: 2, step: 0.01, digits: 2 }}
            value={mask.params.min ?? 0} onChange={(v) => onParam('height', 'min', v)} />
          <SliderCtl def={{ key: '_hmax', label: 'Max', min: -0.5, max: 2, step: 0.01, digits: 2 }}
            value={mask.params.max ?? 1.35} onChange={(v) => onParam('height', 'max', v)} />
          <SliderCtl def={{ key: '_hfall', label: 'Falloff', min: 0, max: 0.5, step: 0.005, digits: 3 }}
            value={mask.params.falloff ?? 0.06} onChange={(v) => onParam('height', 'falloff', v)} />
        </>
      )}
      {mask.type === 'noise' && mask.enabled !== false && (
        <>
          <SliderCtl def={{ key: '_nsc', label: 'Scale', min: 0.1, max: 10, step: 0.05, digits: 2 }}
            value={mask.params.scale ?? 1} onChange={(v) => onParam('noise', 'scale', v)} />
          <SliderCtl def={{ key: '_nth', label: 'Threshold', min: 0, max: 1, step: 0.01, digits: 2 }}
            value={mask.params.threshold ?? 0.5} onChange={(v) => onParam('noise', 'threshold', v)} />
          <SliderCtl def={{ key: '_nsf', label: 'Softness', min: 0, max: 0.5, step: 0.005, digits: 3 }}
            value={mask.params.softness ?? 0.12} onChange={(v) => onParam('noise', 'softness', v)} />
        </>
      )}
      {mask.type === 'slope' && mask.enabled !== false && (
        <>
          <SliderCtl
            def={{ key: '_smin', label: 'Min', min: 0, max: 3, step: 0.01, digits: 2 }}
            value={mask.params.min ?? 0}
            onChange={(v) => onParam('slope', 'min', v)}
            settingId="noise.mask.slopeMin"
          />
          <SliderCtl
            def={{ key: '_smax', label: 'Max', min: 0, max: 3, step: 0.01, digits: 2 }}
            value={mask.params.max ?? 1}
            onChange={(v) => onParam('slope', 'max', v)}
            settingId="noise.mask.slopeMax"
          />
          <SliderCtl
            def={{ key: '_sfall', label: 'Falloff', min: 0, max: 1, step: 0.005, digits: 3 }}
            value={mask.params.falloff ?? 0.1}
            onChange={(v) => onParam('slope', 'falloff', v)}
            settingId="noise.mask.slopeFalloff"
          />
        </>
      )}
    </div>
  );
}

// ---- add-layer flyout menu --------------------------------------------------
function AddLayerMenu({ onAdd, onClose }) {
  return (
    <div className="nl-add-menu">
      {TYPE_GROUPS.map((g) => (
        <div key={g.label}>
          <div className="nl-add-group">{g.label}</div>
          {g.items.map((id) => {
            const def = getNoiseType(id);
            return (
              <button key={id} type="button" className="nl-add-item" onClick={() => { onAdd(id); onClose(); }}>
                <span className="nl-add-name">{def.label}</span>
                {def.badge && <span className={`nl-badge nl-badge-${def.badge.toLowerCase()}`}>{def.badge}</span>}
                <span className="nl-add-desc">{def.desc}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// NoiseLayersPanel — the full side drawer panel
// ============================================================================
export default function NoiseLayersPanel({ ctx, children }) {
  const { params, onNoiseStack, onSoloLayer } = ctx;
  const stack = params.noiseStack;

  // local UI state
  const [expandedId, setExpandedId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [dragOver, setDragOver] = useState(-1);
  const debounceRef = useRef(null);
  const addBtnRef = useRef(null);

  const solo = ctx._soloLayerId ?? null;

  // debounced push (for continuous slider drags)
  const pushStack = useCallback((next, structural = false) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (structural) {
      onNoiseStack(next);
    } else {
      debounceRef.current = setTimeout(() => onNoiseStack(next), 32);
      // also push immediately so the uniform refresh is fast
      onNoiseStack(next);
    }
  }, [onNoiseStack]);

  const handleAdd = (type) => {
    const next = addLayer(cloneStack(stack), type);
    pushStack(next, true);
  };
  const handleDuplicate = (id) => {
    const next = duplicateLayer(cloneStack(stack), id);
    pushStack(next, true);
  };
  const handleRemove = (id) => {
    if (expandedId === id) setExpandedId(null);
    const next = removeLayer(cloneStack(stack), id);
    pushStack(next, true);
  };
  const handleUpdate = (id, patch) => {
    // structural changes: blendMode, enabled, masks
    const structural = 'blendMode' in patch || 'enabled' in patch || 'masks' in patch;
    const next = updateLayer(cloneStack(stack), id, patch);
    pushStack(next, structural);
  };
  const handleUpdateParam = (id, key, value) => {
    const def = getNoiseType(stack.layers.find((l) => l.id === id)?.type);
    const pdef = def?.params?.find((p) => p.key === key);
    const structural = !!pdef?.structural;
    const next = updateLayerParam(cloneStack(stack), id, key, value);
    pushStack(next, structural);
  };
  const handleSolo = (id) => {
    onSoloLayer(id);
  };

  // drag-and-drop reorder
  const handleDragStart = (i) => { _dragIdx = i; };
  const handleDragEnter = (i) => { setDragOver(i); };
  const handleDragEnd = () => {
    if (_dragIdx >= 0 && dragOver >= 0 && _dragIdx !== dragOver) {
      const next = moveLayer(cloneStack(stack), _dragIdx, dragOver);
      pushStack(next, true);
    }
    _dragIdx = -1;
    setDragOver(-1);
  };

  const handlePreset = (key) => {
    const ps = buildNoiseStackPreset(key);
    if (ps) {
      pushStack(ps, true);
      setExpandedId(null);
    }
  };

  const handleStackOutput = (patch) => {
    const next = cloneStack(stack);
    let outputMin = clampNumber(
      finiteNumber(patch.outputMin ?? next.outputMin, 0.0),
      OUTPUT_MIN_DEF.min,
      OUTPUT_MIN_DEF.max,
    );
    let outputMax = clampNumber(
      finiteNumber(patch.outputMax ?? next.outputMax, 1.35),
      OUTPUT_MAX_DEF.min,
      OUTPUT_MAX_DEF.max,
    );

    if (outputMax <= outputMin + OUTPUT_RANGE_GAP) {
      if ('outputMin' in patch) outputMin = Math.max(OUTPUT_MIN_DEF.min, outputMax - OUTPUT_RANGE_GAP);
      else outputMax = Math.min(OUTPUT_MAX_DEF.max, outputMin + OUTPUT_RANGE_GAP);
    }

    pushStack({
      ...next,
      normalizeOutput: patch.normalizeOutput ?? !!next.normalizeOutput,
      outputMin,
      outputMax,
    }, false);
  };

  const toggleExpand = (id) => setExpandedId((cur) => cur === id ? null : id);

  const layers = stack?.layers ?? [];
  const outputMin = clampNumber(finiteNumber(stack?.outputMin, 0.0), OUTPUT_MIN_DEF.min, OUTPUT_MIN_DEF.max);
  const outputMax = clampNumber(
    Math.max(finiteNumber(stack?.outputMax, 1.35), outputMin + OUTPUT_RANGE_GAP),
    OUTPUT_MAX_DEF.min,
    OUTPUT_MAX_DEF.max,
  );
  const normalizeOutput = !!stack?.normalizeOutput;

  return (
    <SidePanel title="Noise Layers" description="Stack noise layers to shape the terrain height." onClose={ctx.onClose}>
      {/* preset quick-select */}
      <SelectRow label="Stack Preset" value="__custom" settingId="noise.stackPreset"
        options={[{ value: '__custom', label: '— Custom Stack —' }, ...NOISE_STACK_PRESET_KEYS.map((k) => ({ value: k, label: NOISE_STACK_PRESETS[k].label }))]}
        onChange={(v) => { if (v !== '__custom') handlePreset(v); }}
        info="Load a preset noise stack. You can edit it freely afterwards." />

      <div className="nl-output-section" data-setting-id="noise.section.output">
        <div className="nl-output-title">Output</div>
        <ToggleRow
          label="Normalize Output"
          value={normalizeOutput}
          onChange={(value) => handleStackOutput({ normalizeOutput: value })}
          settingId="noise.stackNormalize"
          info="Remap the raw stack by Min and Max, then apply a soft ceiling instead of hard flattening peaks."
        />
        <SliderCtl
          def={OUTPUT_MIN_DEF}
          value={outputMin}
          onChange={(value) => handleStackOutput({ outputMin: value })}
          settingId="noise.outputMin"
        />
        <SliderCtl
          def={OUTPUT_MAX_DEF}
          value={outputMax}
          onChange={(value) => handleStackOutput({ outputMax: value })}
          settingId="noise.outputMax"
        />
      </div>

      {/* layer list */}
      <div className="nl-stack">
        {layers.length === 0 && (
          <div className="nl-empty">No noise layers — terrain will be flat.</div>
        )}
        {layers.map((layer, i) => (
          <NoiseLayerItem
            key={layer.id}
            layer={layer}
            index={i}
            total={layers.length}
            expanded={expandedId === layer.id}
            onToggleExpand={toggleExpand}
            onUpdate={handleUpdate}
            onUpdateParam={handleUpdateParam}
            onDuplicate={handleDuplicate}
            onRemove={handleRemove}
            onSolo={handleSolo}
            soloActive={solo}
            onDragStart={handleDragStart}
            onDragEnter={handleDragEnter}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>

      {/* add layer button + flyout */}
      <div className="nl-add-wrap">
        <button type="button" className="action-btn primary nl-add-btn" ref={addBtnRef}
          onClick={() => setAddOpen(!addOpen)} disabled={layers.length >= MAX_LAYERS}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" style={{ marginRight: 6 }}>
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Add Noise Layer {layers.length >= MAX_LAYERS && `(${MAX_LAYERS} max)`}
        </button>
        {addOpen && (
          <>
            <div className="nl-add-backdrop" onClick={() => setAddOpen(false)} />
            <AddLayerMenu onAdd={handleAdd} onClose={() => setAddOpen(false)} />
          </>
        )}
      </div>

      {/* stack info */}
      <p className="section-hint" style={{ marginTop: 12 }}>
        {layers.length} / {MAX_LAYERS} layers. Drag to reorder. The terrain is evaluated top → bottom.
      </p>
      {children}
    </SidePanel>
  );
}
