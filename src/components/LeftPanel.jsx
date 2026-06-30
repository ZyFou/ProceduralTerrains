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
  { key: 'terrainSmoothing', label: 'Peak Smoothing', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'octaves', label: 'Octaves', min: 1, max: 9, step: 1 },
  { key: 'persistence', label: 'Persistence', min: 0.15, max: 0.85, step: 0.01, digits: 2 },
  { key: 'lacunarity', label: 'Lacunarity', min: 1.5, max: 3.5, step: 0.01, digits: 2 },
  { key: 'ridge', label: 'Ridge Intensity', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'warp', label: 'Domain Warp', min: 0, max: 3, step: 0.05, digits: 2 },
  { key: 'falloff', label: 'Edge Falloff Width', min: 0, max: 1, step: 0.01, digits: 2 },

  { section: 'BIOME' },
  { key: 'biomeScale', label: 'Biome Density', min: 0.3, max: 3, step: 0.05, digits: 2 },
  { key: 'tempBias', label: 'Temperature', min: -1, max: 1, step: 0.05, digits: 2 },
  { key: 'moistScale', label: 'Moisture Scale', min: 0.2, max: 3, step: 0.05, digits: 2 },
  { key: 'moistBias', label: 'Moisture Bias', min: -1, max: 1, step: 0.05, digits: 2 },
  { key: 'snowLine', label: 'Snow Line', min: 0.2, max: 1, step: 0.01, digits: 2 },
  { key: 'biomeDebug', label: 'Biome Debug', type: 'toggle' },

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

  const hasLegacy = !params.noiseStack || (params.noiseStack.layers && params.noiseStack.layers.some((l) => l.type === 'legacy' && l.enabled));
  const LEGACY_ONLY_KEYS = new Set(['octaves', 'persistence', 'lacunarity', 'ridge', 'warp']);

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
          if (def.section) {
            return (
              <div key={i}>
                <div className="section-title">{def.section}</div>
                {def.section === 'NOISE' && !hasLegacy && (
                  <div className="section-hint info" style={{
                    margin: '6px 12px 10px',
                    padding: '8px 10px',
                    borderRadius: '4px',
                    background: 'rgba(59, 130, 246, 0.08)',
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                    fontSize: '10.5px',
                    lineHeight: '1.4',
                    color: '#3b82f6',
                    display: 'flex',
                    gap: '6px',
                    alignItems: 'center'
                  }}>
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style={{ flexShrink: 0 }}>
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
                      <path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <span>Global parameters (Warp, Ridge, FBM) will automatically add or update layers in your custom Noise Stack.</span>
                  </div>
                )}
              </div>
            );
          }

          const isLegacyOnly = LEGACY_ONLY_KEYS.has(def.key);
          const infoTooltip = isLegacyOnly && !hasLegacy
            ? "Adjusting this will automatically add or update a suitable layer in your active Noise Stack."
            : def.info;

          if (def.type === 'toggle') {
            return (
              <ToggleRow key={def.key} label={def.label} value={params[def.key]}
                onChange={(v) => onParam(def.key, v)}
                info={infoTooltip} />
            );
          }
          if (def.type === 'select') {
            return (
              <SelectRow key={def.key} label={def.label} value={params[def.key]}
                options={def.options} format={def.format}
                onChange={(v) => onParam(def.key, parseFloat(v))}
                info={infoTooltip} />
            );
          }
          return (
            <SliderCtl key={def.key} def={def} value={params[def.key]}
              onChange={(v) => onParam(def.key, v)}
              info={infoTooltip} />
          );
        })}
      </div>
    </aside>
  );
}
