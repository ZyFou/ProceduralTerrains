import ControlSection from './ControlSection.jsx';
import { ToggleRow, SelectRow } from '../controls.jsx';

export default function WorldPanel({ params, worldMode, onParam }) {
  const isPlanet = worldMode === 'planet';
  return (
    <ControlSection
      id="inspector-world"
      title={isPlanet ? 'PLANET' : 'WORLD'}
      defaultOpen={true}
      icon={(
        <svg viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
          <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
          <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
          <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      )}
    >
      {isPlanet ? (
        <>
          <SelectRow
            label="Planet Radius"
            value={params.planetRadius}
            options={[8000, 12000, 16000, 24000, 32000].map((v) => ({ value: v, label: `${(v / 1000)}k` }))}
            onChange={(v) => onParam('planetRadius', parseFloat(v))}
            info="Base sphere radius in world units. Terrain rises above it; bigger = gentler curvature."
            icon={(
              <svg viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
                <path d="M8 8h6" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          />
          <SelectRow
            label="Surface Detail"
            value={params.planetFaceGrid}
            options={[6, 8, 10, 12].map((v) => ({ value: v, label: `${v} × ${v} / face` }))}
            onChange={(v) => onParam('planetFaceGrid', parseFloat(v))}
            info="Chunks per cube-face side — the spherical equivalent of chunk count (more = finer LOD streaming, more draw calls)."
            icon={(
              <svg viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <path d="M6 2v12M10 2v12M2 6h12M2 10h12" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          />
        </>
      ) : (
        <>
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
        </>
      )}
      <p className="section-hint">Wireframe, LOD Debug and Auto Update have moved to the <strong>Debug</strong> panel.</p>
    </ControlSection>
  );
}
