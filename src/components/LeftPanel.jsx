import { useEffect, useState } from 'react';
import { PRESETS } from '../engine/presets.js';
import { SliderCtl, ToggleRow, SelectRow } from './controls.jsx';

// Schema for the terrain controls — same definitions as the vanilla version.
const CONTROL_SCHEMA = [
  { section: 'HEIGHT' },
  { key: 'heightScale', label: 'Height Scale', min: 20, max: 1000, step: 5, unit: 'm' },
  { key: 'seaLevel', label: 'Sea Level', min: 0, max: 250, step: 1, unit: 'm' },

  { section: 'NOISE' },
  { key: 'noiseScale', label: 'Noise Scale', min: 8, max: 160, step: 0.5, digits: 1 },
  { key: 'noiseStrength', label: 'Noise Strength', min: 0.1, max: 2, step: 0.01, digits: 2 },
  { key: 'octaves', label: 'Octaves', min: 1, max: 9, step: 1 },
  { key: 'persistence', label: 'Persistence', min: 0.15, max: 0.85, step: 0.01, digits: 2 },
  { key: 'lacunarity', label: 'Lacunarity', min: 1.5, max: 3.5, step: 0.01, digits: 2 },
  { key: 'ridge', label: 'Ridge Intensity', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'warp', label: 'Domain Warp', min: 0, max: 3, step: 0.05, digits: 2 },
  { key: 'falloff', label: 'Island Falloff', min: 0.05, max: 1, step: 0.01, digits: 2 },

  { section: 'BIOME' },
  { key: 'moistScale', label: 'Moisture Scale', min: 0.2, max: 3, step: 0.05, digits: 2 },
  { key: 'moistBias', label: 'Moisture Bias', min: -1, max: 1, step: 0.05, digits: 2 },
  { key: 'snowLine', label: 'Snow Line', min: 0.2, max: 1, step: 0.01, digits: 2 },

  { section: 'RENDER' },
  { key: 'normalStrength', label: 'Normal Strength', min: 0.2, max: 3, step: 0.05, digits: 2 },
  { key: 'aoStrength', label: 'Ambient Occlusion', min: 0, max: 1, step: 0.05, digits: 2 },
  { key: 'chunkGrid', label: 'Chunk Grid', type: 'toggle' },

  { section: 'WORLD' },
  { key: 'chunkCount', label: 'Chunk Count', type: 'select', options: [8, 12, 16, 20, 24], format: (v) => `${v} × ${v}` },
  { key: 'chunkSize', label: 'Chunk Size', type: 'select', options: [64, 128, 192, 256] },
  { key: 'wireframe', label: 'Wireframe', type: 'toggle' },
  { key: 'lodDebug', label: 'LOD Debug', type: 'toggle' },
  { key: 'autoUpdate', label: 'Auto Update', type: 'toggle' },
];

export default function LeftPanel({ params, onParam, onPreset, onRandomizeSeed, onRegenerate }) {
  const [open, setOpen] = useState(true);
  const [seedText, setSeedText] = useState(String(params.seed));
  useEffect(() => { setSeedText(String(params.seed)); }, [params.seed]);

  const commitSeed = () => {
    const v = parseInt(seedText, 10);
    if (Number.isFinite(v)) onParam('seed', v >>> 0);
    else setSeedText(String(params.seed));
  };

  return (
    <aside id="left-panel" className="panel">
      <div className="panel-header">
        <span>TERRAIN CONTROLS</span>
        <button className="collapse-btn" onClick={() => setOpen(!open)}>{open ? '‹' : '›'}</button>
      </div>
      <div className={`panel-body${open ? '' : ' collapsed'}`} id="left-panel-body">
        <div className="section-title">GENERATE</div>

        <div className="row">
          <label>Preset</label>
          <select value={params.preset} onChange={(e) => onPreset(e.target.value)}>
            {Object.entries(PRESETS).map(([key, preset]) => (
              <option key={key} value={key}>{preset.label}</option>
            ))}
          </select>
        </div>

        <div className="seed-row">
          <input
            type="text"
            spellCheck="false"
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            onBlur={commitSeed}
            onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
          />
          <button title="Random seed" onClick={onRandomizeSeed}>⚄</button>
        </div>

        <button className="wide-btn primary" onClick={onRegenerate}>
          <svg viewBox="0 0 16 16">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" fill="none" strokeWidth="1.3" />
            <path d="M13.7 1.8v2.8h-2.8" stroke="currentColor" fill="none" strokeWidth="1.3" />
          </svg>
          Regenerate
        </button>

        {CONTROL_SCHEMA.map((def, i) => {
          if (def.section) return <div key={i} className="section-title">{def.section}</div>;
          if (def.type === 'toggle') {
            return (
              <ToggleRow key={def.key} label={def.label} value={params[def.key]}
                onChange={(v) => onParam(def.key, v)} />
            );
          }
          if (def.type === 'select') {
            return (
              <SelectRow key={def.key} label={def.label} value={params[def.key]}
                options={def.options} format={def.format}
                onChange={(v) => onParam(def.key, parseFloat(v))} />
            );
          }
          return (
            <SliderCtl key={def.key} def={def} value={params[def.key]}
              onChange={(v) => onParam(def.key, v)} />
          );
        })}
      </div>
    </aside>
  );
}
