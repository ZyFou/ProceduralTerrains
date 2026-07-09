import { Plus, Route, Waves } from 'lucide-react';
import SidePanel from './SidePanel.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';

const sliders = [
  { key: 'width', label: 'Width', min: 2, max: 180, step: 1, digits: 0 },
  { key: 'falloff', label: 'Falloff', min: 0, max: 160, step: 1, digits: 0 },
];

export default function SplinesPanel({ ctx }) {
  const state = ctx.splineState || { splines: [] }; const selected = state.splines?.find((s) => s.id === state.selectedId);
  return <SidePanel title="Splines" description="Editable roads and rivers." onClose={ctx.onClose}>
    <div className="side-panel-quick">
      <button type="button" className="action-btn primary" onClick={() => ctx.onCreateSpline('road')}><Route size={14} /> Add Road</button>
      <button type="button" className="action-btn primary" onClick={() => ctx.onCreateSpline('river')}><Waves size={14} /> Add River</button>
    </div>
    {!state.splines?.length && <p className="section-hint">Choose a route type, then click the terrain to place points. Press Enter to finish.</p>}
    <div className="tile-chip-grid">
      {state.splines?.map((s) => <button key={s.id} type="button" className={`action-btn${s.id === state.selectedId ? ' primary' : ''}`} onClick={() => ctx.onSelectSpline(s.id)}>{s.type === 'river' ? 'River' : 'Road'} · {s.name}</button>)}
    </div>
    {selected && <>
      <div className="seed-row"><label className="setting-label">Name</label><input value={selected.name} onChange={(e) => ctx.onUpdateSpline(selected.id, { name: e.target.value })} /></div>
      <SelectRow label="Interpolation" value={selected.interpolation} options={[{ value: 'catmull-rom', label: 'Smooth' }, { value: 'linear', label: 'Linear' }]} onChange={(v) => ctx.onUpdateSpline(selected.id, { interpolation: v })} />
      {sliders.map((def) => <SliderCtl key={def.key} def={def} value={selected[def.key]} onChange={(v) => ctx.onUpdateSpline(selected.id, { [def.key]: v })} />)}
      {selected.type === 'road' && <SelectRow label="Terrain mode" value={selected.heightMode} options={[{ value: 'flatten', label: 'Flatten locally' }, { value: 'follow', label: 'Follow terrain' }, { value: 'fixed', label: 'Fixed elevation' }]} onChange={(v) => ctx.onUpdateSpline(selected.id, { heightMode: v })} />}
      {selected.type === 'river' && <>
        <SliderCtl def={{ key: 'depth', label: 'Channel Depth', min: 1, max: 120, step: 1, digits: 0 }} value={selected.depth} onChange={(v) => ctx.onUpdateSpline(selected.id, { depth: v })} />
        <SliderCtl def={{ key: 'bankWidth', label: 'Bank Width', min: 0, max: 120, step: 1, digits: 0 }} value={selected.bankWidth} onChange={(v) => ctx.onUpdateSpline(selected.id, { bankWidth: v })} />
      </>}
      <ToggleRow label="Visible" value={selected.visible} onChange={(v) => ctx.onUpdateSpline(selected.id, { visible: v })} />
      <ToggleRow label="Enabled" value={selected.enabled} onChange={(v) => ctx.onUpdateSpline(selected.id, { enabled: v })} />
      <ToggleRow label="Clear props" value={selected.clearProps} onChange={(v) => ctx.onUpdateSpline(selected.id, { clearProps: v })} />
      <div className="side-panel-quick"><button type="button" className="action-btn" onClick={() => ctx.onDuplicateSpline(selected.id)}>Duplicate</button><button type="button" className="action-btn danger" onClick={() => ctx.onDeleteSpline(selected.id)}>Delete</button></div>
    </>}
  </SidePanel>;
}
