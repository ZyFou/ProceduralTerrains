import SidePanel from './SidePanel.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';
import { ANALYSIS_LEGENDS } from '../../creator/analysis/TerrainAnalysisManager.js';

export default function AnalysisPanel({ ctx }) {
  const s = ctx.analysisState || {};
  const patch = (p) => ctx.onAnalysisSettings(p);
  return <SidePanel title="Analysis" description="Inspect final terrain structure." onClose={ctx.onClose}>
    <ToggleRow label="Show analysis" value={!!s.enabled} onChange={(v) => patch({ enabled: v })} />
    <SelectRow label="Mode" value={s.mode || 'elevation'} options={[
      { value: 'elevation', label: 'Elevation' }, { value: 'slope', label: 'Slope' }, { value: 'normals', label: 'Normals' }, { value: 'curvature', label: 'Curvature' }, { value: 'waterDepth', label: 'Water depth' }, { value: 'biome', label: 'Biome distribution' }, { value: 'contribution', label: 'Paint + spline contribution' },
    ]} onChange={(v) => ctx.onAnalysisMode(v)} />
    <SelectRow label="Display" value={s.display || 'overlay'} options={[{ value: 'overlay', label: 'Overlay' }, { value: 'replace', label: 'Replace' }]} onChange={(v) => patch({ display: v, opacity: v === 'replace' ? 1 : s.opacity })} />
    <SliderCtl def={{ key: 'opacity', label: 'Opacity', min: 0, max: 1, step: .01, digits: 2 }} value={s.opacity ?? .72} onChange={(v) => patch({ opacity: v })} />
    {(s.mode === 'elevation' || s.mode === 'waterDepth') && <><SliderCtl def={{ key: 'min', label: 'Minimum', min: -300, max: 1000, step: 5, digits: 0 }} value={s.min ?? 0} onChange={(v) => patch({ min: v })} /><SliderCtl def={{ key: 'max', label: 'Maximum', min: 1, max: 2000, step: 5, digits: 0 }} value={s.max ?? 600} onChange={(v) => patch({ max: v })} /></>}
    {s.mode === 'slope' && <><SliderCtl def={{ key: 'thresholdA', label: 'Walkable', min: 0, max: 70, step: 1, digits: 0 }} value={s.thresholdA ?? 35} onChange={(v) => patch({ thresholdA: v })} /><SliderCtl def={{ key: 'thresholdB', label: 'Cliff', min: 5, max: 90, step: 1, digits: 0 }} value={s.thresholdB ?? 55} onChange={(v) => patch({ thresholdB: v })} /></>}
    <ToggleRow label="Show legend" value={s.legend !== false} onChange={(v) => patch({ legend: v })} />
    {s.legend !== false && <p className="section-hint">{ANALYSIS_LEGENDS[s.mode] || ANALYSIS_LEGENDS.elevation}</p>}
  </SidePanel>;
}
