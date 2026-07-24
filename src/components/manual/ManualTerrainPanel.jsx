import React, { useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Dices,
  Droplet,
  Eraser,
  Eye,
  EyeOff,
  GripVertical,
  Mountain,
  Minus,
  MousePointer2,
  Move3D,
  RotateCw,
  Scaling,
  SlidersHorizontal,
  Trash2,
  Waves,
} from 'lucide-react';
import { SliderCtl } from '../controls.jsx';
import {
  MANUAL_BLEND_MODES,
  MANUAL_MASK_TYPES,
  MANUAL_SHAPE_CATALOG,
  getManualShapeDefinition,
} from '../../manual/ManualShapeCatalog.js';

const TRANSFORMS = [
  { id: 'translate', label: 'Move', Icon: Move3D, shortcut: 'M' },
  { id: 'rotate', label: 'Rotate', Icon: RotateCw, shortcut: 'R' },
  { id: 'scale', label: 'Scale', Icon: Scaling, shortcut: 'S' },
];

const SCULPT_TOOLS = [
  { id: 'raise', label: 'Raise', Icon: Mountain },
  { id: 'lower', label: 'Lower', Icon: Minus },
  { id: 'smooth', label: 'Smooth', Icon: Waves },
  { id: 'flatten', label: 'Flatten', Icon: SlidersHorizontal },
  { id: 'erode', label: 'Erode', Icon: Droplet },
  { id: 'erase', label: 'Erase', Icon: Eraser },
];

export default function ManualTerrainPanel({
  state,
  boardSize,
  inspectorReplaced = false,
  toolsRailVisible = false,
  toolsRailEdge = 'left',
  onPlacementType,
  onBeginDrag,
  onEndDrag,
  onSelect,
  onTransformMode,
  onUpdate,
  onDelete,
  onDuplicate,
  onReorder,
  onSculptEnabled,
  onSculptSetting,
  onClearSculpt,
}) {
  const shapes = state?.shapes ?? [];
  const selected = shapes.find((shape) => shape.id === state?.selectedId) ?? null;
  const categories = useMemo(() => {
    const grouped = new Map();
    for (const shape of MANUAL_SHAPE_CATALOG) {
      if (!grouped.has(shape.category)) grouped.set(shape.category, []);
      grouped.get(shape.category).push(shape);
    }
    return [...grouped.entries()];
  }, []);
  const half = Math.max(500, boardSize * 0.5);
  const sideToolOffset = (side) => (toolsRailVisible && toolsRailEdge === side ? 64 : 0);
  const topToolOffset = toolsRailVisible && toolsRailEdge === 'top' ? 58 : 0;
  const bottomToolOffset = toolsRailVisible && toolsRailEdge === 'bottom' ? 58 : 0;
  const inspectorWidth = 304;

  const positionX = { label: 'Position X', min: -half, max: half, step: 1, digits: 0, unit: 'u' };
  const positionZ = { label: 'Position Z', min: -half, max: half, step: 1, digits: 0, unit: 'u' };
  const rotation = { label: 'Rotation', min: -180, max: 180, step: 1, digits: 0, unit: 'deg' };
  const scaleX = { label: 'Scale X', min: 8, max: Math.max(1000, boardSize), step: 2, digits: 0, unit: 'u' };
  const scaleZ = { label: 'Scale Z', min: 8, max: Math.max(1000, boardSize), step: 2, digits: 0, unit: 'u' };
  const height = { label: 'Height', min: -1000, max: 1000, step: 2, digits: 0, unit: 'u' };
  const detail = { label: 'Detail', min: 0, max: 1, step: 0.01, digits: 2 };
  const opacity = { label: 'Opacity', min: 0, max: 1, step: 0.01, digits: 2 };
  const sharpness = { label: 'Sharpness', min: 0.2, max: 4, step: 0.05, digits: 2 };
  const terraces = { label: 'Terraces', min: 0, max: 16, step: 1, digits: 0 };
  const maskFeather = { label: 'Mask Feather', min: 0.02, max: 1, step: 0.01, digits: 2 };
  const maskStrength = { label: 'Mask Strength', min: 0, max: 1, step: 0.01, digits: 2 };
  const brushSize = { label: 'Brush Size', min: 4, max: 900, step: 2, digits: 0, unit: 'u' };
  const brushStrength = { label: 'Strength', min: 0.01, max: 1, step: 0.01, digits: 2 };
  const brushFalloff = { label: 'Falloff', min: 0.02, max: 1, step: 0.01, digits: 2 };
  const targetHeight = { label: 'Target Height', min: -1000, max: 1000, step: 2, digits: 0, unit: 'u' };

  const libraryStyle = {
    left: sideToolOffset('left'),
    right: sideToolOffset('right') + (inspectorReplaced ? 0 : inspectorWidth),
    bottom: bottomToolOffset,
  };
  const inspectorStyle = {
    right: sideToolOffset('right'),
    top: topToolOffset,
    bottom: bottomToolOffset,
    width: inspectorWidth,
  };

  return (
    <section className={`manual-terrain-workspace${inspectorReplaced ? ' inspector-replaced' : ''}`} aria-label="Manual Terrain workspace">
      <div className="manual-viewport-tools" role="toolbar" aria-label="Shape transform tools">
        {TRANSFORMS.map(({ id, label, Icon, shortcut }) => (
          <button
            key={id}
            type="button"
            className={state?.transformMode === id ? 'active' : ''}
            onClick={() => onTransformMode(id)}
            title={`${label} (${shortcut})`}
            aria-label={`${label} selected shape (${shortcut})`}
            aria-pressed={state?.transformMode === id}
            disabled={!selected || state?.sculpt?.enabled}
          >
            <Icon size={18} aria-hidden />
            <kbd>{shortcut}</kbd>
          </button>
        ))}
        <span className="manual-tool-separator" aria-hidden />
        <button
          type="button"
          className={state?.sculpt?.enabled ? 'active sculpt-active' : ''}
          onClick={() => onSculptEnabled(!state?.sculpt?.enabled)}
          title="Manual Sculpt (B)"
          aria-label="Toggle Manual Sculpt (B)"
          aria-pressed={!!state?.sculpt?.enabled}
        >
          <SlidersHorizontal size={18} aria-hidden />
          <kbd>B</kbd>
        </button>
      </div>

      <div className="manual-library-dock" style={libraryStyle}>
        <header className="manual-dock-header">
          <div className="node-dock-heading">
            <span className="node-dock-kicker">Manual</span>
            <strong>Shape Library</strong>
          </div>
          <span>Drag a shape onto the terrain, or click then place.</span>
          {state?.placementType ? (
            <button type="button" className="manual-cancel-place" onClick={() => onPlacementType(null)}>
              Cancel placement
            </button>
          ) : null}
        </header>

        <div className="manual-dock-body">
          <section className="manual-hierarchy">
            <div className="manual-dock-section-title">
              <strong>Terrain Shapes</strong>
              <span>{shapes.length}</span>
            </div>
            {shapes.length === 0 ? (
              <div className="manual-empty-state">
                <MousePointer2 size={16} aria-hidden />
                <span>Place a shape to begin.</span>
              </div>
            ) : (
              <div className="manual-shape-list">
                {[...shapes].reverse().map((shape, visibleIndex) => (
                  <div className={`manual-shape-row${shape.id === state.selectedId ? ' active' : ''}${shape.enabled === false ? ' disabled' : ''}`} key={shape.id}>
                    <button
                      type="button"
                      className="manual-shape-select"
                      onClick={() => onSelect(shape.id)}
                    >
                      <GripVertical size={12} aria-hidden />
                      <span className="manual-list-type"><Mountain size={13} aria-hidden /></span>
                      <span>
                        <strong>{shape.name}</strong>
                        <small>{getManualShapeDefinition(shape.type).name} · {shape.blendMode}</small>
                      </span>
                    </button>
                    <div className="manual-layer-actions">
                      <button type="button" onClick={() => onUpdate(shape.id, { enabled: shape.enabled === false })} title={shape.enabled === false ? 'Show layer' : 'Hide layer'} aria-label={shape.enabled === false ? `Show ${shape.name}` : `Hide ${shape.name}`}>
                        {shape.enabled === false ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                      <button type="button" onClick={() => onReorder(shape.id, 1)} disabled={visibleIndex === 0} title="Move layer up" aria-label={`Move ${shape.name} up`}>
                        <ChevronUp size={12} />
                      </button>
                      <button type="button" onClick={() => onReorder(shape.id, -1)} disabled={visibleIndex === shapes.length - 1} title="Move layer down" aria-label={`Move ${shape.name} down`}>
                        <ChevronDown size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="manual-library-scroll">
            {categories.map(([category, entries]) => (
              <section className="manual-library-category" key={category}>
                <h3>{category}</h3>
                <div className="manual-shape-grid">
                  {entries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      draggable
                      className={`manual-shape-card${state?.placementType === entry.id ? ' placing' : ''}`}
                      onClick={() => onPlacementType(state?.placementType === entry.id ? null : entry.id)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'copy';
                        event.dataTransfer.setData('application/x-terrain-shape', entry.id);
                        onBeginDrag(entry.id);
                      }}
                      onDragEnd={onEndDrag}
                      title={entry.description}
                    >
                      <span className={`manual-shape-thumb type-${entry.id}`}>
                        <Mountain size={18} aria-hidden />
                      </span>
                      <span>{entry.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      {!inspectorReplaced ? (
        <aside className="manual-inspector-dock" style={inspectorStyle} aria-label="Terrain shape inspector">
          <header className="node-dock-header manual-inspector-header">
            <div className="node-dock-heading">
              <span className="node-dock-kicker">Manual terrain</span>
              <strong>{state?.sculpt?.enabled ? 'Sculpt' : selected?.name || 'Shape Inspector'}</strong>
            </div>
            {selected && !state?.sculpt?.enabled ? (
              <div className="manual-shape-actions">
                <button type="button" onClick={() => onDuplicate(selected.id)} title="Duplicate (Ctrl/Cmd+D)" aria-label="Duplicate selected shape">
                  <Copy size={14} aria-hidden />
                </button>
                <button type="button" className="danger" onClick={() => onDelete(selected.id)} title="Delete" aria-label="Delete selected shape">
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            ) : null}
          </header>

          {state?.sculpt?.enabled ? (
            <div className="manual-inspector-body">
              <p className="manual-inspector-description">Paint non-destructive terrain detail over the procedural shape stack.</p>
              <section className="manual-inspector-section">
                <h3>Sculpt Tool</h3>
                <div className="manual-sculpt-tool-grid" role="toolbar" aria-label="Sculpt tools">
                  {SCULPT_TOOLS.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      className={state.sculpt.tool === id ? 'active' : ''}
                      onClick={() => onSculptSetting('tool', id)}
                      aria-pressed={state.sculpt.tool === id}
                    >
                      <Icon size={14} aria-hidden />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="manual-inspector-section manual-inspector-controls">
                <h3>Brush</h3>
                <SliderCtl def={brushSize} value={state.sculpt.brushSize} onChange={(value) => onSculptSetting('brushSize', value)} />
                <SliderCtl def={brushStrength} value={state.sculpt.strength} onChange={(value) => onSculptSetting('strength', value)} />
                <SliderCtl def={brushFalloff} value={state.sculpt.falloff} onChange={(value) => onSculptSetting('falloff', value)} />
                {state.sculpt.tool === 'flatten' ? (
                  <SliderCtl def={targetHeight} value={state.sculpt.targetHeight} onChange={(value) => onSculptSetting('targetHeight', value)} />
                ) : null}
              </section>
              <div className="manual-sculpt-help">
                <span>Left drag: sculpt</span>
                <span>Alt + left drag: pan</span>
                <span>Shift + wheel: brush size</span>
                <span>Right drag: orbit</span>
              </div>
              <button type="button" className="manual-clear-sculpt" onClick={onClearSculpt} disabled={!state.sculpt.hasData}>
                <Trash2 size={14} aria-hidden /> Clear sculpt layer
              </button>
            </div>
          ) : selected ? (
            <div className="manual-inspector-body">
              <p className="manual-inspector-description">{getManualShapeDefinition(selected.type).description}</p>
              <section className="manual-inspector-section">
                <h3>Shape</h3>
                <label className="manual-toggle-field">
                  <span>Enabled</span>
                  <input type="checkbox" checked={selected.enabled !== false} onChange={(event) => onUpdate(selected.id, { enabled: event.target.checked })} />
                </label>
                <label className="manual-name-field">
                  <span>Name</span>
                  <input
                    value={selected.name}
                    maxLength={80}
                    onChange={(event) => onUpdate(selected.id, { name: event.target.value })}
                  />
                </label>
              </section>
              <section className="manual-inspector-section manual-inspector-controls">
                <h3>Layer Blend</h3>
                <label className="manual-select-field">
                  <span>Blend Mode</span>
                  <select value={selected.blendMode} onChange={(event) => onUpdate(selected.id, { blendMode: event.target.value })}>
                    {MANUAL_BLEND_MODES.map((mode) => <option value={mode.id} key={mode.id}>{mode.name}</option>)}
                  </select>
                </label>
                <SliderCtl def={opacity} value={selected.opacity} onChange={(value) => onUpdate(selected.id, { opacity: value })} />
              </section>
              <section className="manual-inspector-section manual-inspector-controls">
                <h3>Transform</h3>
                <SliderCtl def={positionX} value={selected.position.x} onChange={(value) => onUpdate(selected.id, { position: { x: value } })} />
                <SliderCtl def={positionZ} value={selected.position.z} onChange={(value) => onUpdate(selected.id, { position: { z: value } })} />
                <SliderCtl def={rotation} value={selected.rotation * 180 / Math.PI} onChange={(value) => onUpdate(selected.id, { rotation: value * Math.PI / 180 })} />
                <SliderCtl def={scaleX} value={selected.scale.x} onChange={(value) => onUpdate(selected.id, { scale: { x: value } })} />
                <SliderCtl def={scaleZ} value={selected.scale.z} onChange={(value) => onUpdate(selected.id, { scale: { z: value } })} />
              </section>
              <section className="manual-inspector-section manual-inspector-controls">
                <h3>Terrain Shape</h3>
                <SliderCtl def={height} value={selected.height} onChange={(value) => onUpdate(selected.id, { height: value })} />
                <SliderCtl def={detail} value={selected.detail} onChange={(value) => onUpdate(selected.id, { detail: value })} />
                <SliderCtl def={sharpness} value={selected.sharpness} onChange={(value) => onUpdate(selected.id, { sharpness: value })} />
                <SliderCtl def={terraces} value={selected.terraces} onChange={(value) => onUpdate(selected.id, { terraces: value })} />
                <label className="manual-name-field">
                  <span>Seed</span>
                  <span className="manual-seed-row">
                    <input
                      type="number"
                      min="0"
                      max="2147483647"
                      value={selected.seed}
                      onChange={(event) => onUpdate(selected.id, { seed: Number(event.target.value) || 0 })}
                    />
                    <button type="button" onClick={() => onUpdate(selected.id, { seed: Math.floor(Math.random() * 0x7fffffff) })} title="Randomize seed" aria-label="Randomize shape seed">
                      <Dices size={14} aria-hidden />
                    </button>
                  </span>
                </label>
              </section>
              <section className="manual-inspector-section manual-inspector-controls">
                <h3>Shape Mask</h3>
                <label className="manual-select-field">
                  <span>Mask</span>
                  <select value={selected.mask.type} onChange={(event) => onUpdate(selected.id, { mask: { type: event.target.value } })}>
                    {MANUAL_MASK_TYPES.map((mask) => <option value={mask.id} key={mask.id}>{mask.name}</option>)}
                  </select>
                </label>
                {selected.mask.type !== 'none' ? (
                  <>
                    <SliderCtl def={maskFeather} value={selected.mask.feather} onChange={(value) => onUpdate(selected.id, { mask: { feather: value } })} />
                    <SliderCtl def={maskStrength} value={selected.mask.strength} onChange={(value) => onUpdate(selected.id, { mask: { strength: value } })} />
                    <label className="manual-toggle-field">
                      <span>Invert Mask</span>
                      <input type="checkbox" checked={selected.mask.invert} onChange={(event) => onUpdate(selected.id, { mask: { invert: event.target.checked } })} />
                    </label>
                  </>
                ) : null}
              </section>
            </div>
          ) : (
            <div className="manual-inspector-empty">
              <MousePointer2 size={22} aria-hidden />
              <strong>No shape selected</strong>
              <span>Select a terrain shape in the viewport or hierarchy to edit its settings.</span>
            </div>
          )}
        </aside>
      ) : null}
    </section>
  );
}
