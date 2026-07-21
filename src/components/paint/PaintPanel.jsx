import React, { useState } from 'react';
import { SelectRow, SliderCtl } from '../controls.jsx';
import SidePanel from '../panels/SidePanel.jsx';
import PaintToolbar, { PAINT_TOOLS } from './PaintToolbar.jsx';

const BIOME_OPTIONS = [
  { value: 'desert', label: 'Desert' },
  { value: 'canyon', label: 'Canyon' },
  { value: 'wetland', label: 'Wetland' },
  { value: 'mountains', label: 'Mountains' },
];

const BRUSH_SHAPE_OPTIONS = [
  { value: 'round', label: 'Round' },
  { value: 'ellipse', label: 'Ellipse' },
  { value: 'organic', label: 'Organic' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'ribbon', label: 'Ribbon' },
];

const PROP_OPTIONS = [
  { value: 'mixed', label: 'Mixed Grass + Flowers' },
  { value: 'grass', label: 'Grass' },
  { value: 'flowers', label: 'Flowers' },
  { value: 'eraseProps', label: 'Erase Props' },
];

const SCULPT_DIRECTION_OPTIONS = [
  { value: 'raise', label: 'Raise' },
  { value: 'lower', label: 'Lower' },
];

const BASE_MODE_OPTIONS = [
  { value: 'generated', label: 'Generated Terrain' },
  { value: 'flat', label: 'Flat (Empty Terrain)' },
];

const defs = {
  brushSize: { label: 'Brush Size', min: 4, max: 900, step: 1, digits: 0, unit: ' u' },
  strength: { label: 'Strength', min: 0.01, max: 1, step: 0.01, digits: 2 },
  falloff: { label: 'Falloff', min: 0, max: 1, step: 0.01, digits: 2 },
  brushRotation: { label: 'Brush Rotation', min: -180, max: 180, step: 1, digits: 0, unit: ' deg' },
  brushScatter: { label: 'Scatter Amount', min: 0.05, max: 1, step: 0.01, digits: 2 },
  brushSpacing: { label: 'Stroke Spacing', min: 0.08, max: 1, step: 0.01, digits: 2 },
  targetHeight: { label: 'Target Height', min: -120, max: 900, step: 1, digits: 0, unit: ' u' },
  riverDepth: { label: 'River Depth', min: 1, max: 220, step: 1, digits: 0, unit: ' u' },
  riverBankSoftness: { label: 'Bank Softness', min: 0.05, max: 1, step: 0.01, digits: 2 },
  layerOpacity: { label: 'Layer Opacity', min: 0, max: 1, step: 0.01, digits: 2 },
};

// Which paint tab a given PaintModeManager `tool` value belongs to, so
// reopening the panel (or reacting to Shift+scroll etc.) shows the right tab.
function panelForTool(tool) {
  switch (tool) {
    case 'raise': case 'lower': return 'sculpt';
    case 'smooth': return 'smooth';
    case 'flatten': case 'setHeight': return 'flatten';
    case 'riverCarve': return 'river';
    case 'biome': return 'biome';
    case 'propsPaint': return 'mask';
    case 'erase': return 'erase';
    default: return 'sculpt';
  }
}

// Which `tool` value a tab activates when selected (brush settings doesn't
// have one — it just changes what's shown, not what a stroke does).
function toolForPanel(id, state) {
  switch (id) {
    case 'sculpt': return state.tool === 'lower' ? 'lower' : 'raise';
    case 'smooth': return 'smooth';
    case 'flatten': return 'flatten';
    case 'river': return 'riverCarve';
    case 'biome': return 'biome';
    case 'mask': return 'propsPaint';
    case 'erase': return 'erase';
    default: return null;
  }
}

export default function PaintPanel({ paintState, onSetting, onClear, onSetBaseMode, onStartEmpty, onExit }) {
  const state = paintState ?? {};
  const set = (key) => (value) => onSetting(key, value);
  const [activeTool, setActiveTool] = useState(() => panelForTool(state.tool));

  const selectTool = (id) => {
    setActiveTool(id);
    const toolValue = toolForPanel(id, state);
    if (toolValue) onSetting('tool', toolValue);
  };

  const meta = PAINT_TOOLS.find((t) => t.id === activeTool) ?? PAINT_TOOLS[0];

  return (
    <>
      <PaintToolbar activeTool={activeTool} onSelect={selectTool} />
      <aside className="paint-panel side-drawer open">
        <SidePanel title={meta.title} description={meta.description} onClose={onExit}>
          {activeTool === 'sculpt' && (
            <div className="paint-section">
              <SelectRow label="Direction" value={state.tool === 'lower' ? 'lower' : 'raise'} options={SCULPT_DIRECTION_OPTIONS} onChange={set('tool')} />
              <SliderCtl def={defs.strength} value={state.strength ?? 0.35} onChange={set('strength')} />
            </div>
          )}

          {activeTool === 'smooth' && (
            <div className="paint-section">
              <SliderCtl def={defs.strength} value={state.strength ?? 0.35} onChange={set('strength')} />
            </div>
          )}

          {activeTool === 'flatten' && (
            <div className="paint-section">
              <SliderCtl def={defs.targetHeight} value={state.targetHeight ?? 120} onChange={set('targetHeight')} />
              <SliderCtl def={defs.strength} value={state.strength ?? 0.35} onChange={set('strength')} />
            </div>
          )}

          {activeTool === 'river' && (
            <div className="paint-section">
              <SliderCtl def={defs.riverDepth} value={state.riverDepth ?? 28} onChange={set('riverDepth')} />
              <SliderCtl def={defs.riverBankSoftness} value={state.riverBankSoftness ?? 0.65} onChange={set('riverBankSoftness')} />
              <SliderCtl def={defs.strength} value={state.strength ?? 0.35} onChange={set('strength')} />
            </div>
          )}

          {activeTool === 'biome' && (
            <div className="paint-section">
              <SelectRow label="Biome" value={state.biome ?? 'desert'} options={BIOME_OPTIONS} onChange={set('biome')} />
              <SliderCtl def={defs.strength} value={state.strength ?? 0.35} onChange={set('strength')} />
            </div>
          )}

          {activeTool === 'mask' && (
            <div className="paint-section">
              <SelectRow label="Mask" value={state.propType ?? 'mixed'} options={PROP_OPTIONS} onChange={set('propType')} />
              <SliderCtl def={defs.strength} value={state.strength ?? 0.35} onChange={set('strength')} />
            </div>
          )}

          {activeTool === 'erase' && (
            <>
              <div className="paint-section">
                <SliderCtl def={defs.strength} value={state.strength ?? 0.35} onChange={set('strength')} />
                <button className="wide-btn danger" type="button" onClick={onClear}>Clear Painted Layers</button>
              </div>
              <div className="paint-section">
                <div className="subsection-label">Terrain Base</div>
                <SelectRow label="Base" value={state.baseMode ?? 'generated'} options={BASE_MODE_OPTIONS} onChange={onSetBaseMode} />
                <button className="wide-btn danger" type="button" onClick={onStartEmpty}>Start Empty Terrain</button>
                <p className="section-hint">
                  <b>Base</b> swaps what you're painting on top of without touching existing strokes.
                  <b> Start Empty Terrain</b> flattens the board and clears all paint layers for a fresh start.
                </p>
              </div>
            </>
          )}

          {activeTool === 'brush' && (
            <div className="paint-section">
              <SelectRow label="Brush Shape" value={state.brushShape ?? 'round'} options={BRUSH_SHAPE_OPTIONS} onChange={set('brushShape')} />
              <SliderCtl def={defs.brushSize} value={state.brushSize ?? 90} onChange={set('brushSize')} />
              <SliderCtl def={defs.falloff} value={state.falloff ?? 0.75} onChange={set('falloff')} />
              {(state.brushShape === 'ellipse' || state.brushShape === 'ribbon') && (
                <SliderCtl def={defs.brushRotation} value={state.brushRotation ?? 0} onChange={set('brushRotation')} />
              )}
              {(state.brushShape === 'scatter') && (
                <SliderCtl def={defs.brushScatter} value={state.brushScatter ?? 0.55} onChange={set('brushScatter')} />
              )}
              <SliderCtl def={defs.brushSpacing} value={state.brushSpacing ?? 0.35} onChange={set('brushSpacing')} />
              <SliderCtl def={defs.layerOpacity} value={state.layerOpacity ?? 1} onChange={set('layerOpacity')} />
              <p className="section-hint">Hold <b>Shift</b> and scroll to resize the brush. Right-click drag still orbits the Studio camera.</p>
            </div>
          )}
        </SidePanel>
      </aside>
    </>
  );
}
