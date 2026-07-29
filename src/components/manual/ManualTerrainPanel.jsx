import React, { useEffect, useMemo, useRef } from 'react';
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
  Palette,
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
import {
  MANUAL_SURFACE_MATERIALS,
  manualSurfaceDiffuseUrl,
} from '../../manual/ManualSurfaceCatalog.js';

const TRANSFORMS = [
  { id: 'translate', label: 'Move', Icon: Move3D, shortcut: 'M' },
  { id: 'rotate', label: 'Rotate', Icon: RotateCw, shortcut: 'R' },
  { id: 'scale', label: 'Scale', Icon: Scaling, shortcut: 'S' },
];

const SCULPT_TOOLS = [
  { id: 'raise', label: 'Raise', Icon: Mountain, description: 'Build broad positive relief.' },
  { id: 'lower', label: 'Lower', Icon: Minus, description: 'Carve broad depressions into the terrain.' },
  { id: 'smooth', label: 'Smooth', Icon: Waves, description: 'Relax abrupt height changes without flattening the whole form.' },
  { id: 'flatten', label: 'Flatten', Icon: SlidersHorizontal, description: 'Move the terrain toward an exact elevation.' },
  { id: 'erode', label: 'Erode', Icon: Droplet, description: 'Move material downhill and deposit sediment in lower areas.' },
  { id: 'crease', label: 'Crease', Icon: Minus, description: 'Cut narrow gullies, cracks, and drainage lines.' },
  { id: 'ridge', label: 'Ridge', Icon: Mountain, description: 'Pinch terrain upward into narrow ridges and spines.' },
  { id: 'detail', label: 'Detail', Icon: Dices, description: 'Paint seeded multi-scale rocky relief over larger forms.' },
  { id: 'terrace', label: 'Terrace', Icon: GripVertical, description: 'Quantize elevation into editable steps and shelves.' },
  { id: 'erase', label: 'Erase', Icon: Eraser, description: 'Remove sculpted detail and reveal the procedural shapes.' },
];

const TEXTURE_TOOLS = [
  { id: 'paint', label: 'Paint', Icon: Palette },
  { id: 'blend', label: 'Blend', Icon: Waves },
  { id: 'erase', label: 'Erase', Icon: Eraser },
];

const MIN_LIBRARY_HEIGHT = 150;
const MAX_LIBRARY_HEIGHT = 520;
const MIN_VISIBLE_VIEWPORT_HEIGHT = 220;

const PIXEL_PREVIEWS = {
  mountain: [
    '0000000010000000',
    '0000000121000000',
    '0000001222100000',
    '0000012222210000',
    '0000122233221000',
    '0001222333322100',
    '0012233333332210',
    '0122333333333221',
    '1223333333333222',
    '2222222222222222',
  ],
  'sharp-peak': [
    '0000000010000000',
    '0000000131000000',
    '0000001333100000',
    '0000001333210000',
    '0000013333221000',
    '0000133333322100',
    '0001333333332210',
    '0013333333333221',
    '0133333333333322',
    '1333333333333332',
  ],
  ridge: [
    '0000000000000000',
    '0000100000010000',
    '0001210000121000',
    '0012321001232100',
    '0123332123333210',
    '1233332333333321',
    '2333333333333332',
    '3333333333333333',
    '3333333333333333',
    '2222222222222222',
  ],
  valley: [
    '4444444444444444',
    '4444444444444444',
    '4422222222222244',
    '4222222222222224',
    '2222111111112222',
    '2221100000011222',
    '2211000000001122',
    '2221100000011222',
    '2222111111112222',
    '4222222222222224',
  ],
  canyon: [
    '4444444444444444',
    '4222222222222224',
    '2222222222222222',
    '2222211111122222',
    '2222110000112222',
    '2221100000011222',
    '2221100000011222',
    '2222110000112222',
    '2222211111122222',
    '2222222222222222',
  ],
  plateau: [
    '0000000000000000',
    '0001111111111000',
    '0012222222222100',
    '0122222222222210',
    '1222222222222221',
    '2333333333333332',
    '2333333333333332',
    '2333333333333332',
    '2333333333333332',
    '2222222222222222',
  ],
  crater: [
    '0000011111100000',
    '0001222222210000',
    '0012222222222100',
    '0122233333222210',
    '1223300000332221',
    '1223000000032221',
    '1223300000332221',
    '0122233333222210',
    '0012222222222100',
    '0001222222210000',
  ],
};

const PIXEL_COLORS = {
  '0': 'transparent',
  '1': 'var(--terrain-preview-highlight)',
  '2': 'var(--terrain-preview-light)',
  '3': 'var(--terrain-preview-mid)',
  '4': 'var(--terrain-preview-ground)',
};

function TerrainShapePreview({ type }) {
  const pixels = PIXEL_PREVIEWS[type] ?? PIXEL_PREVIEWS.mountain;

  return (
    <svg className="manual-pixel-preview" viewBox="0 0 64 40" aria-hidden="true" shapeRendering="crispEdges">
      {pixels.flatMap((row, y) => [...row].map((pixel, x) => (
        pixel === '0' ? null : <rect key={`${x}-${y}`} x={x * 4} y={y * 4} width="4" height="4" fill={PIXEL_COLORS[pixel]} />
      )))}
    </svg>
  );
}
export default function ManualTerrainPanel({
  state,
  boardSize,
  libraryHeight = 214,
  onLibraryHeightChange,
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
  onTexturePaintEnabled,
  onTexturePaintSetting,
  onClearTexturePaint,
}) {
  const shapes = state?.shapes ?? [];
  const selected = shapes.find((shape) => shape.id === state?.selectedId) ?? null;
  const activeSculptTool = SCULPT_TOOLS.find((tool) => tool.id === state?.sculpt?.tool) ?? SCULPT_TOOLS[0];
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
  const workspaceRef = useRef(null);
  const libraryResizeRef = useRef(null);

  const clampLibraryHeight = (height, target) => {
    const workspace = target?.matches?.('.manual-terrain-workspace')
      ? target
      : target?.closest('.manual-terrain-workspace');
    const workspaceHeight = workspace?.getBoundingClientRect().height ?? window.innerHeight;
    const availableHeight = Math.max(
      MIN_LIBRARY_HEIGHT,
      workspaceHeight - bottomToolOffset - MIN_VISIBLE_VIEWPORT_HEIGHT,
    );
    return Math.round(Math.min(MAX_LIBRARY_HEIGHT, availableHeight, Math.max(MIN_LIBRARY_HEIGHT, height)));
  };

  const startLibraryResize = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    libraryResizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: libraryHeight,
    };
  };

  const resizeLibrary = (event) => {
    const resize = libraryResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    onLibraryHeightChange?.(clampLibraryHeight(
      resize.startHeight + resize.startY - event.clientY,
      event.currentTarget,
    ));
  };

  const finishLibraryResize = (event) => {
    const resize = libraryResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    libraryResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeLibraryWithKeyboard = (event) => {
    const step = event.shiftKey ? 32 : 12;
    let nextHeight = null;
    if (event.key === 'ArrowUp') nextHeight = libraryHeight + step;
    if (event.key === 'ArrowDown') nextHeight = libraryHeight - step;
    if (event.key === 'Home') nextHeight = MIN_LIBRARY_HEIGHT;
    if (event.key === 'End') nextHeight = MAX_LIBRARY_HEIGHT;
    if (nextHeight == null) return;
    event.preventDefault();
    onLibraryHeightChange?.(clampLibraryHeight(nextHeight, event.currentTarget));
  };

  useEffect(() => {
    const fitLibraryToWorkspace = () => {
      const nextHeight = clampLibraryHeight(libraryHeight, workspaceRef.current);
      if (nextHeight !== libraryHeight) onLibraryHeightChange?.(nextHeight);
    };
    fitLibraryToWorkspace();
    window.addEventListener('resize', fitLibraryToWorkspace);
    return () => window.removeEventListener('resize', fitLibraryToWorkspace);
  }, [libraryHeight, bottomToolOffset, onLibraryHeightChange]);
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
  const creaseWidth = { label: 'Profile Width', min: 0.04, max: 0.8, step: 0.01, digits: 2 };
  const detailScale = { label: 'Detail Scale', min: 2, max: 240, step: 2, digits: 0, unit: 'u' };
  const detailRoughness = { label: 'Roughness', min: 0, max: 1, step: 0.01, digits: 2 };
  const terraceStep = { label: 'Step Height', min: 1, max: 400, step: 1, digits: 0, unit: 'u' };
  const erosionIterations = { label: 'Iterations', min: 1, max: 10, step: 1, digits: 0 };
  const erosionDeposition = { label: 'Sediment Deposit', min: 0, max: 1, step: 0.01, digits: 2 };
  const erosionTalus = { label: 'Talus Threshold', min: 0, max: 20, step: 0.1, digits: 1 };
  const textureBrushSize = { label: 'Brush Size', min: 4, max: 900, step: 2, digits: 0, unit: 'u' };
  const textureStrength = { label: 'Strength', min: 0.01, max: 1, step: 0.01, digits: 2 };
  const textureFalloff = { label: 'Edge Blend', min: 0.02, max: 1, step: 0.01, digits: 2 };

  const libraryStyle = {
    left: sideToolOffset('left'),
    right: sideToolOffset('right') + (inspectorReplaced ? 0 : inspectorWidth),
    bottom: bottomToolOffset,
    height: libraryHeight,
  };
  const inspectorStyle = {
    right: sideToolOffset('right'),
    top: topToolOffset,
    bottom: bottomToolOffset,
    width: inspectorWidth,
  };

  return (
    <section ref={workspaceRef} className={`manual-terrain-workspace${inspectorReplaced ? ' inspector-replaced' : ''}`} aria-label="Manual Terrain workspace">
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
            disabled={!selected || state?.sculpt?.enabled || state?.texturePaint?.enabled}
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
        <span className="manual-tool-separator" aria-hidden />
        <button
          type="button"
          className={state?.texturePaint?.enabled ? 'active texture-active' : ''}
          onClick={() => onTexturePaintEnabled(!state?.texturePaint?.enabled)}
          title="Texture Paint (T)"
          aria-label="Toggle Texture Paint (T)"
          aria-pressed={!!state?.texturePaint?.enabled}
        >
          <Palette size={18} aria-hidden />
          <kbd>T</kbd>
        </button>
      </div>

      <div className="manual-library-dock" style={libraryStyle}>
        <div
          className="manual-library-resizer"
          role="separator"
          aria-label="Resize Shape Library"
          aria-orientation="horizontal"
          aria-valuemin={MIN_LIBRARY_HEIGHT}
          aria-valuemax={MAX_LIBRARY_HEIGHT}
          aria-valuenow={Math.round(libraryHeight)}
          tabIndex={0}
          onPointerDown={startLibraryResize}
          onPointerMove={resizeLibrary}
          onPointerUp={finishLibraryResize}
          onPointerCancel={finishLibraryResize}
          onKeyDown={resizeLibraryWithKeyboard}
          title="Drag to resize the Shape Library"
        />
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
                        <TerrainShapePreview type={entry.id} />
                      </span>
                      <span className="manual-shape-card-label">{entry.name}</span>
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
              <strong>{state?.texturePaint?.enabled ? 'Texture Paint' : state?.sculpt?.enabled ? 'Sculpt' : selected?.name || 'Shape Inspector'}</strong>
            </div>
            {selected && !state?.sculpt?.enabled && !state?.texturePaint?.enabled ? (
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

          {state?.texturePaint?.enabled ? (
            <div className="manual-inspector-body">
              <p className="manual-inspector-description">Paint the shipped terrain materials directly onto the final surface. Soft weights and triplanar projection keep transitions continuous.</p>
              <section className="manual-inspector-section">
                <h3>Texture Tool</h3>
                <div className="manual-sculpt-tool-grid manual-texture-tool-grid" role="toolbar" aria-label="Texture paint tools">
                  {TEXTURE_TOOLS.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      className={state.texturePaint.tool === id ? 'active' : ''}
                      onClick={() => onTexturePaintSetting('tool', id)}
                      aria-pressed={state.texturePaint.tool === id}
                    >
                      <Icon size={14} aria-hidden />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <p className="manual-sculpt-tool-description">
                  {state.texturePaint.tool === 'paint'
                    ? 'Crossfade the selected material over existing terrain textures.'
                    : state.texturePaint.tool === 'blend'
                      ? 'Smooth neighboring material weights without flattening the terrain.'
                      : 'Fade painted materials back to the original manual terrain surface.'}
                </p>
              </section>
              {state.texturePaint.tool === 'paint' ? (
                <section className="manual-inspector-section">
                  <h3>Material</h3>
                  <div className="manual-material-grid" role="listbox" aria-label="Terrain material">
                    {MANUAL_SURFACE_MATERIALS.map((material) => (
                      <button
                        key={material.id}
                        type="button"
                        className={state.texturePaint.material === material.id ? 'active' : ''}
                        onClick={() => onTexturePaintSetting('material', material.id)}
                        aria-selected={state.texturePaint.material === material.id}
                        role="option"
                      >
                        <img src={manualSurfaceDiffuseUrl(material)} alt="" draggable="false" />
                        <span>{material.label}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
              <section className="manual-inspector-section manual-inspector-controls">
                <h3>Brush</h3>
                <SliderCtl def={textureBrushSize} value={state.texturePaint.brushSize} onChange={(value) => onTexturePaintSetting('brushSize', value)} />
                <SliderCtl def={textureStrength} value={state.texturePaint.strength} onChange={(value) => onTexturePaintSetting('strength', value)} />
                <SliderCtl def={textureFalloff} value={state.texturePaint.falloff} onChange={(value) => onTexturePaintSetting('falloff', value)} />
              </section>
              <div className="manual-sculpt-help">
                <span>Left drag: apply tool</span>
                <span>Alt + left drag: pan</span>
                <span>Shift + wheel: brush size</span>
                <span>Right drag: orbit</span>
              </div>
              <button type="button" className="manual-clear-sculpt" onClick={onClearTexturePaint} disabled={!state.texturePaint.hasData}>
                <Trash2 size={14} aria-hidden /> Clear texture layer
              </button>
            </div>
          ) : state?.sculpt?.enabled ? (
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
                <p className="manual-sculpt-tool-description">{activeSculptTool.description}</p>
              </section>
              <section className="manual-inspector-section manual-inspector-controls">
                <h3>Brush</h3>
                <SliderCtl def={brushSize} value={state.sculpt.brushSize} onChange={(value) => onSculptSetting('brushSize', value)} />
                <SliderCtl def={brushStrength} value={state.sculpt.strength} onChange={(value) => onSculptSetting('strength', value)} />
                <SliderCtl def={brushFalloff} value={state.sculpt.falloff} onChange={(value) => onSculptSetting('falloff', value)} />
              </section>
              {state.sculpt.tool === 'flatten' ? (
                <section className="manual-inspector-section manual-inspector-controls">
                  <h3>Flatten</h3>
                  <SliderCtl def={targetHeight} value={state.sculpt.targetHeight} onChange={(value) => onSculptSetting('targetHeight', value)} />
                </section>
              ) : null}
              {state.sculpt.tool === 'erode' ? (
                <section className="manual-inspector-section manual-inspector-controls">
                  <h3>Hydraulic Erosion</h3>
                  <SliderCtl def={erosionIterations} value={state.sculpt.erosionIterations} onChange={(value) => onSculptSetting('erosionIterations', value)} />
                  <SliderCtl def={erosionDeposition} value={state.sculpt.erosionDeposition} onChange={(value) => onSculptSetting('erosionDeposition', value)} />
                  <SliderCtl def={erosionTalus} value={state.sculpt.erosionTalus} onChange={(value) => onSculptSetting('erosionTalus', value)} />
                </section>
              ) : null}
              {state.sculpt.tool === 'crease' || state.sculpt.tool === 'ridge' ? (
                <section className="manual-inspector-section manual-inspector-controls">
                  <h3>{state.sculpt.tool === 'crease' ? 'Crease Profile' : 'Ridge Profile'}</h3>
                  <SliderCtl def={creaseWidth} value={state.sculpt.creaseWidth} onChange={(value) => onSculptSetting('creaseWidth', value)} />
                </section>
              ) : null}
              {state.sculpt.tool === 'detail' ? (
                <section className="manual-inspector-section manual-inspector-controls">
                  <h3>Relief Detail</h3>
                  <SliderCtl def={detailScale} value={state.sculpt.detailScale} onChange={(value) => onSculptSetting('detailScale', value)} />
                  <SliderCtl def={detailRoughness} value={state.sculpt.detailRoughness} onChange={(value) => onSculptSetting('detailRoughness', value)} />
                  <label className="manual-name-field">
                    <span>Detail Seed</span>
                    <span className="manual-seed-row">
                      <input
                        type="number"
                        min="0"
                        max="2147483647"
                        value={state.sculpt.detailSeed}
                        onChange={(event) => onSculptSetting('detailSeed', Number(event.target.value) || 0)}
                      />
                      <button type="button" onClick={() => onSculptSetting('detailSeed', Math.floor(Math.random() * 0x7fffffff))} title="Randomize detail seed" aria-label="Randomize detail seed">
                        <Dices size={14} aria-hidden />
                      </button>
                    </span>
                  </label>
                </section>
              ) : null}
              {state.sculpt.tool === 'terrace' ? (
                <section className="manual-inspector-section manual-inspector-controls">
                  <h3>Terraces</h3>
                  <SliderCtl def={terraceStep} value={state.sculpt.terraceStep} onChange={(value) => onSculptSetting('terraceStep', value)} />
                </section>
              ) : null}
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
                <SliderCtl def={height} value={selected.height} onChange={(value) => onUpdate(selected.id, { height: value })} />
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
