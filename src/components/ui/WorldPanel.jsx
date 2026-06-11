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
        info="Dimensions of the grid of chunks around the camera (e.g. 16x16)"
        icon={(
          <svg viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 2v12M10 2v12M2 6h12M2 10h12" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        )}
      />
      <SelectRow
        label="Chunk Size"
        value={params.chunkSize}
        options={[64, 128, 192, 256].map((v) => ({ value: v, label: String(v) }))}
        onChange={(v) => onParam('chunkSize', parseFloat(v))}
        info="Number of vertices per side of each grid patch (higher = more detailed)"
        icon={(
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M2 2v12h12M5 11l6-6M7 5h4v4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        )}
      />
      <ToggleRow
        label="Chunk Grid"
        value={params.chunkGrid}
        onChange={(v) => onParam('chunkGrid', v)}
        info="Render borders around individual chunk boundaries"
        icon={(
          <svg viewBox="0 0 16 16" fill="none">
            <rect x="3" y="3" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
          </svg>
        )}
      />
      <ToggleRow
        label="Wireframe"
        value={params.wireframe}
        onChange={(v) => onParam('wireframe', v)}
        info="Display terrain using wire mesh lines instead of solid surface triangles"
        icon={(
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M1.5 12.5l5.5-10 7.5 10-13 0zm5.5-10v10M1.5 12.5l11-5.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        )}
      />
      <ToggleRow
        label="LOD Debug"
        value={params.lodDebug}
        onChange={(v) => onParam('lodDebug', v)}
        info="Color-code chunks based on their active level of detail (LOD) level"
        icon={(
          <svg viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        )}
      />
      <ToggleRow
        label="Auto Update"
        value={params.autoUpdate}
        onChange={(v) => onParam('autoUpdate', v)}
        info="Dynamically rebuild mesh chunks as noise or terrain settings change"
        icon={(
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" strokeWidth="1.2" />
            <path d="M13.5 2v3h-3" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        )}
      />
    </ControlSection>
  );
}
