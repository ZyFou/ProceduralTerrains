import ControlSection from './ControlSection.jsx';
import { ToggleRow, SelectRow } from '../controls.jsx';

export default function WorldPanel({ params, onParam }) {
  return (
    <ControlSection
      id="inspector-world"
      title="WORLD"
      defaultOpen={false}
      icon={(
        <svg viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
          <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
          <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
          <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      )}
    >
      <SelectRow
        label="Chunk Count"
        value={params.chunkCount}
        options={[8, 12, 16, 20, 24].map((v) => ({ value: v, label: `${v} × ${v}` }))}
        onChange={(v) => onParam('chunkCount', parseFloat(v))}
      />
      <SelectRow
        label="Chunk Size"
        value={params.chunkSize}
        options={[64, 128, 192, 256].map((v) => ({ value: v, label: String(v) }))}
        onChange={(v) => onParam('chunkSize', parseFloat(v))}
      />
      <ToggleRow label="Chunk Grid" value={params.chunkGrid} onChange={(v) => onParam('chunkGrid', v)} />
      <ToggleRow label="Wireframe" value={params.wireframe} onChange={(v) => onParam('wireframe', v)} />
      <ToggleRow label="LOD Debug" value={params.lodDebug} onChange={(v) => onParam('lodDebug', v)} />
      <ToggleRow label="Auto Update" value={params.autoUpdate} onChange={(v) => onParam('autoUpdate', v)} />
    </ControlSection>
  );
}
