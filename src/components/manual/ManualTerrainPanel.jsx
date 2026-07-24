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
  { id: 'translate', label: 'Move', Icon: Move3D, shortcut: 'W' },
  { id: 'rotate', label: 'Rotate', Icon: RotateCw, shortcut: 'E' },
  { id: 'scale', label: 'Scale', Icon: Scaling, shortcut: 'R' },
];

export default function ManualTerrainPanel({
  state,
  boardSize,
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

  const positionX = { label: 'Position X', min: -half, max: half, step: 1, digits: 0, unit: 'u' };
  const positionZ = { label: 'Position Z', min: -half, max: half, step: 1, digits: 0, unit: 'u' };
  const rotation = { label: 'Rotation', min: -180, max: 180, step: 1, digits: 0, unit: 'deg' };
  const scaleX = { label: 'Scale X', min: 8, max: Math.max(1000, boardSize), step: 2, digits: 0, unit: 'u' };
  const scaleZ = { label: 'Scale Z', min: 8, max: Math.max(1000, boardSize), step: 2, digits: 0, unit: 'u' };
  const height = { label: 'Height', min: -1000, max: 1000, step: 2, digits: 0, unit: 'u' };
  const detail = { label: 'Detail', min: 0, max: 1, step: 0.01, digits: 2 };

  return (
    <aside className="manual-terrain-panel" aria-label="Manual Terrain">
      <header className="manual-panel-header">
        <div className="manual-panel-title">
          <span className="manual-panel-icon"><Mountain size={18} aria-hidden /></span>
          <div>
            <h2>Manual Terrain</h2>
            <p>Compose editable procedural landforms.</p>
          </div>
        </div>
        <div className="manual-transform-tools" role="toolbar" aria-label="Transform mode">
          {TRANSFORMS.map(({ id, label, Icon, shortcut }) => (
            <button
              key={id}
              type="button"
              className={state?.transformMode === id ? 'active' : ''}
              onClick={() => onTransformMode(id)}
              title={`${label} (${shortcut})`}
              aria-label={`${label} selected shape`}
              aria-pressed={state?.transformMode === id}
              disabled={!selected}
            >
              <Icon size={15} aria-hidden />
              <kbd>{shortcut}</kbd>
            </button>
          ))}
        </div>
      </header>

      <div className="manual-panel-scroll">
        <section className="manual-section">
          <div className="manual-section-heading">
            <div>
              <h3>Shape Library</h3>
              <p>Drag onto the terrain, or click then place.</p>
            </div>
            {state?.placementType && (
              <button type="button" className="manual-cancel-place" onClick={() => onPlacementType(null)}>
                Cancel
              </button>
            )}
          </div>
          {categories.map(([category, entries]) => (
            <div className="manual-library-category" key={category}>
              <h4>{category}</h4>
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
                      <Mountain size={19} aria-hidden />
                    </span>
                    <span>{entry.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="manual-section manual-hierarchy">
          <div className="manual-section-heading">
            <div>
              <h3>Terrain Shapes</h3>
              <p>{shapes.length ? `${shapes.length} editable ${shapes.length === 1 ? 'shape' : 'shapes'}` : 'No shapes placed yet'}</p>
            </div>
          </div>
          {shapes.length === 0 ? (
            <div className="manual-empty-state">
              <MousePointer2 size={18} aria-hidden />
              <span>Choose a shape above and place it on the terrain.</span>
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
                  <GripVertical size={13} aria-hidden />
                  <span className="manual-list-type"><Mountain size={14} aria-hidden /></span>
                  <span>
                    <strong>{shape.name}</strong>
                    <small>{getManualShapeDefinition(shape.type).name}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {selected && (
          <section className="manual-section manual-inspector">
            <div className="manual-section-heading manual-inspector-heading">
              <div>
                <h3>Shape Inspector</h3>
                <p>{getManualShapeDefinition(selected.type).description}</p>
              </div>
              <div className="manual-shape-actions">
                <button type="button" onClick={() => onDuplicate(selected.id)} title="Duplicate (Ctrl/Cmd+D)" aria-label="Duplicate selected shape">
                  <Copy size={14} aria-hidden />
                </button>
                <button type="button" className="danger" onClick={() => onDelete(selected.id)} title="Delete" aria-label="Delete selected shape">
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            </div>
            <label className="manual-name-field">
              <span>Name</span>
              <input
                value={selected.name}
                maxLength={80}
                onChange={(event) => onUpdate(selected.id, { name: event.target.value })}
              />
            </label>
            <div className="manual-inspector-controls">
              <SliderCtl def={positionX} value={selected.position.x} onChange={(value) => onUpdate(selected.id, { position: { x: value } })} />
              <SliderCtl def={positionZ} value={selected.position.z} onChange={(value) => onUpdate(selected.id, { position: { z: value } })} />
              <SliderCtl def={rotation} value={selected.rotation * 180 / Math.PI} onChange={(value) => onUpdate(selected.id, { rotation: value * Math.PI / 180 })} />
              <SliderCtl def={scaleX} value={selected.scale.x} onChange={(value) => onUpdate(selected.id, { scale: { x: value } })} />
              <SliderCtl def={scaleZ} value={selected.scale.z} onChange={(value) => onUpdate(selected.id, { scale: { z: value } })} />
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
            </div>
          </section>
        )}
      </div>

      <footer className="manual-panel-footer">
        <span><kbd>W</kbd> Move</span>
        <span><kbd>E</kbd> Rotate</span>
        <span><kbd>R</kbd> Scale</span>
        <span><kbd>Del</kbd> Delete</span>
      </footer>
    </aside>
  );
}
