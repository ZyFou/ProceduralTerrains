import React, { useMemo } from 'react';
import {
  Copy,
  GripVertical,
  Mountain,
  MousePointer2,
  Move3D,
  RotateCw,
  Scaling,
  Trash2,
} from 'lucide-react';
import { SliderCtl } from '../controls.jsx';
import { MANUAL_SHAPE_CATALOG, getManualShapeDefinition } from '../../manual/ManualShapeCatalog.js';

const TRANSFORMS = [
  { id: 'translate', label: 'Move', Icon: Move3D, shortcut: 'M' },
  { id: 'rotate', label: 'Rotate', Icon: RotateCw, shortcut: 'R' },
  { id: 'scale', label: 'Scale', Icon: Scaling, shortcut: 'S' },
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
            disabled={!selected}
          >
            <Icon size={18} aria-hidden />
            <kbd>{shortcut}</kbd>
          </button>
        ))}
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
                {[...shapes].reverse().map((shape) => (
                  <button
                    key={shape.id}
                    type="button"
                    className={shape.id === state.selectedId ? 'active' : ''}
                    onClick={() => onSelect(shape.id)}
                  >
                    <GripVertical size={12} aria-hidden />
                    <span className="manual-list-type"><Mountain size={13} aria-hidden /></span>
                    <span>
                      <strong>{shape.name}</strong>
                      <small>{getManualShapeDefinition(shape.type).name}</small>
                    </span>
                  </button>
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
              <strong>{selected?.name || 'Shape Inspector'}</strong>
            </div>
            {selected ? (
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

          {selected ? (
            <div className="manual-inspector-body">
              <p className="manual-inspector-description">{getManualShapeDefinition(selected.type).description}</p>
              <section className="manual-inspector-section">
                <h3>Shape</h3>
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
                <label className="manual-name-field">
                  <span>Seed</span>
                  <input
                    type="number"
                    min="0"
                    max="2147483647"
                    value={selected.seed}
                    onChange={(event) => onUpdate(selected.id, { seed: Number(event.target.value) || 0 })}
                  />
                </label>
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
