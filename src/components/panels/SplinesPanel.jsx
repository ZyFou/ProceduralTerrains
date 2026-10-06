import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import React, { useMemo, useState } from 'react';
import { Check, ChevronRight, Plus, Route, Waves } from 'lucide-react';
import SidePanel, { PanelTabs } from './SidePanel.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';

const sliders = [
  { key: 'width', label: 'Width', min: 2, max: 180, step: 1, digits: 0 },
  { key: 'falloff', label: 'Falloff', min: 0, max: 160, step: 1, digits: 0 },
];

const TYPE = {
  road: { label: 'Roads', singular: 'road', Icon: Route, empty: 'No roads yet. Create one to shape a route across the terrain.' },
  river: { label: 'Rivers', singular: 'river', Icon: Waves, empty: 'No rivers yet. Create one to carve a channel and water ribbon.' },
};

export default function SplinesPanel({ ctx }) {
  useLanguage();
  const [type, setType] = useState('road');
  const state = ctx.splineState || { splines: [] };
  const splines = useMemo(() => (state.splines || []).filter((s) => s.type === type), [state.splines, type]);
  const selected = state.splines?.find((s) => s.id === state.selectedId);
  const meta = TYPE[type]; const TypeIcon = meta.Icon;
  const create = () => ctx.onCreateSpline(type);
  const creating = state.creatingType === type;

  return <SidePanel title={translateText("Splines")} description={translateText("Draw and refine terrain routes.")} onClose={ctx.onClose}>
    <PanelTabs active={type} onChange={setType} tabs={[{ id: 'road', label: 'Roads' }, { id: 'river', label: 'Rivers' }]} />
    <div className={`spline-create-card${creating ? ' creating' : ''}`}>
      <div className="spline-create-copy"><TypeIcon size={17} aria-hidden /><div><strong>{translateText(creating ? `Drawing ${meta.singular}` : `Create ${meta.singular}`)}</strong><span>{translateText(creating ? `${state.draftPointCount} points placed · click terrain to add more` : 'Click terrain to add points')}</span></div></div>
      {!creating && <button type="button" className="spline-create-btn" onClick={create} disabled={!!state.creatingType}><Plus size={15} aria-hidden />{translateText(" Create")}</button>}
      {creating && <div className="spline-create-actions"><button type="button" className="spline-create-btn" onClick={ctx.onConfirmSplineCreation} disabled={state.draftPointCount < 2}>{translateText("Confirm ")}<kbd>Enter</kbd></button><button type="button" className="spline-cancel-btn" onClick={ctx.onCancelSplineCreation}>{translateText("Cancel")}</button></div>}
    </div>
    <div className="spline-list" aria-label={translateText(`${meta.label} list`)}>
      {!splines.length && <div className="spline-empty"><TypeIcon size={20} aria-hidden /><p>{translateText(meta.empty)}</p></div>}
      {splines.map((s) => {
        const Icon = s.type === 'river' ? Waves : Route; const active = s.id === state.selectedId;
        return <button key={s.id} type="button" className={`spline-list-row${active ? ' active' : ''}`} onClick={() => ctx.onSelectSpline(s.id)}>
          <span className="spline-list-icon"><Icon size={16} aria-hidden /></span>
          <span className="spline-list-copy"><strong>{s.name}</strong><small>{translateText(s.controlPoints.length)}{translateText(" points · ")}{translateText(Math.round(s.width))}{translateText("u wide")}</small></span>
          {!s.enabled && <span className="spline-state">{translateText("Off")}</span>}
          <ChevronRight size={15} aria-hidden />
        </button>;
      })}
    </div>
    {selected && selected.type === type && <section className="spline-settings">
      <div className="spline-settings-heading"><span>{translateText("Selected ")}{translateText(selected.type)}</span><span>{translateText(selected.controlPoints.length)}{translateText(" points")}</span></div>
      <label className="spline-name-field"><span>{translateText("Name")}</span><div><Route size={14} aria-hidden /><input value={selected.name} onChange={(e) => ctx.onUpdateSpline(selected.id, { name: e.target.value })} aria-label={translateText("Spline name")} /><Check size={14} aria-hidden /></div></label>
      <SelectRow label={translateText("Interpolation")} value={selected.interpolation} options={[{ value: 'catmull-rom', label: 'Smooth' }, { value: 'linear', label: 'Linear' }]} onChange={(v) => ctx.onUpdateSpline(selected.id, { interpolation: v })} />
      {sliders.map((def) => <SliderCtl key={def.key} def={def} value={selected[def.key]} onChange={(v) => ctx.onUpdateSpline(selected.id, { [def.key]: v })} />)}
      {selected.type === 'road' && <SelectRow label={translateText("Terrain mode")} value={selected.heightMode} options={[{ value: 'flatten', label: 'Flatten locally' }, { value: 'follow', label: 'Follow terrain' }, { value: 'fixed', label: 'Fixed elevation' }]} onChange={(v) => ctx.onUpdateSpline(selected.id, { heightMode: v })} />}
      {selected.type === 'river' && <>
        <SliderCtl def={{ key: 'depth', label: 'Channel Depth', min: 1, max: 120, step: 1, digits: 0 }} value={selected.depth} onChange={(v) => ctx.onUpdateSpline(selected.id, { depth: v })} />
        <SliderCtl def={{ key: 'bankWidth', label: 'Bank Width', min: 0, max: 120, step: 1, digits: 0 }} value={selected.bankWidth} onChange={(v) => ctx.onUpdateSpline(selected.id, { bankWidth: v })} />
      </>}
      <div className="spline-toggle-grid">
        <ToggleRow label={translateText("Visible")} value={selected.visible} onChange={(v) => ctx.onUpdateSpline(selected.id, { visible: v })} />
        <ToggleRow label={translateText("Enabled")} value={selected.enabled} onChange={(v) => ctx.onUpdateSpline(selected.id, { enabled: v })} />
        <ToggleRow label={translateText("Clear props")} value={selected.clearProps} onChange={(v) => ctx.onUpdateSpline(selected.id, { clearProps: v })} />
      </div>
      <div className="side-panel-quick"><button type="button" className="action-btn" onClick={() => ctx.onDuplicateSpline(selected.id)}>{translateText("Duplicate")}</button><button type="button" className="action-btn danger" onClick={() => ctx.onDeleteSpline(selected.id)}>{translateText("Delete")}</button></div>
    </section>}
  </SidePanel>;
}
