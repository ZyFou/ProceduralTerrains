import { useEffect, useRef, useState } from 'react';
import { PRESETS } from '../../engine/presets.js';
import { NOISE_PRESETS } from '../../engine/style/NoisePresets.js';
import { colorToHex, parseColor } from '../../engine/style/ColorPalette.js';
import PlanetStylePanel from '../PlanetStylePanel.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';
import ControlSection from './ControlSection.jsx';

const TERRAIN_SLIDERS = [
  { key: 'heightScale', label: 'Height Scale', min: 20, max: 1000, step: 5, unit: 'm' },
  { key: 'seaLevel', label: 'Sea Level', min: 0, max: 250, step: 1, unit: 'm' },
  { key: 'falloff', label: 'Island Falloff', min: 0.05, max: 1, step: 0.01, digits: 2 },
];

const NOISE_SLIDERS = [
  { key: 'noiseScale', label: 'Noise Scale', min: 8, max: 160, step: 0.5, digits: 1 },
  { key: 'noiseStrength', label: 'Noise Strength', min: 0.1, max: 2, step: 0.01, digits: 2 },
  { key: 'octaves', label: 'Octaves', min: 1, max: 9, step: 1 },
  { key: 'persistence', label: 'Persistence', min: 0.15, max: 0.85, step: 0.01, digits: 2 },
  { key: 'lacunarity', label: 'Lacunarity', min: 1.5, max: 3.5, step: 0.01, digits: 2 },
  { key: 'ridge', label: 'Ridge Intensity', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'warp', label: 'Domain Warp', min: 0, max: 3, step: 0.05, digits: 2 },
];

const BIOME_SLIDERS = [
  { key: 'biomeScale', label: 'Biome Density', min: 0.3, max: 3, step: 0.05, digits: 2 },
  { key: 'tempBias', label: 'Temperature', min: -1, max: 1, step: 0.05, digits: 2 },
  { key: 'moistScale', label: 'Moisture Scale', min: 0.2, max: 3, step: 0.05, digits: 2 },
  { key: 'moistBias', label: 'Moisture Bias', min: -1, max: 1, step: 0.05, digits: 2 },
  { key: 'snowLine', label: 'Snow Line', min: 0.2, max: 1, step: 0.01, digits: 2 },
];

const RENDER_SLIDERS = [
  { key: 'normalStrength', label: 'Normal Strength', min: 0.2, max: 3, step: 0.05, digits: 2 },
  { key: 'aoStrength', label: 'Ambient Occlusion', min: 0, max: 1, step: 0.05, digits: 2 },
];

const WATER_COLORS = [
  { key: 'deep', label: 'Deep Water' },
  { key: 'shallow', label: 'Shallow' },
  { key: 'foam', label: 'Foam' },
];

function SectionIcon({ children }) {
  return <span className="section-inline-icon">{children}</span>;
}

export default function LeftControlPanel({
  params,
  onParam,
  onPreset,
  onRandomizeSeed,
  onRegenerate,
  planetStyleProps,
  scrollContainerRef,
  onSectionVisible,
}) {
  const [seedText, setSeedText] = useState(String(params.seed));
  const internalRef = useRef(null);
  const ref = scrollContainerRef ?? internalRef;

  useEffect(() => { setSeedText(String(params.seed)); }, [params.seed]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !onSectionVisible) return;

    const sections = el.querySelectorAll('[data-section]');
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) onSectionVisible(visible[0].target.dataset.section);
      },
      { root: el, threshold: [0.2, 0.5, 0.8] },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [ref, onSectionVisible]);

  const commitSeed = () => {
    const v = parseInt(seedText, 10);
    if (Number.isFinite(v)) onParam('seed', v >>> 0);
    else setSeedText(String(params.seed));
  };

  const palette = params.planetStyle?.palette ?? {};

  return (
    <aside className="left-control-panel">
      <div className="left-control-scroll" ref={ref}>
        <ControlSection
          id="section-generate"
          title="GENERATE"
          defaultOpen
          icon={<SectionIcon><svg viewBox="0 0 16 16" fill="none"><path d="M2 12l3-6 2 3 2-2 5 5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg></SectionIcon>}
        >
          <SelectRow label="Preset" value={params.preset}
            options={Object.entries(PRESETS).map(([key, p]) => ({ value: key, label: p.label }))}
            onChange={onPreset} />
          <div className="seed-row">
            <label className="field-label" htmlFor="seed-input">Seed</label>
            <div className="seed-input-wrap">
              <input
                id="seed-input"
                type="text"
                spellCheck="false"
                value={seedText}
                onChange={(e) => setSeedText(e.target.value)}
                onBlur={commitSeed}
                onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
              />
              <button type="button" className="icon-btn" title="Randomize seed" onClick={onRandomizeSeed}>
                <svg viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.1" />
                  <circle cx="5.5" cy="5.5" r="1" fill="currentColor" />
                  <circle cx="10.5" cy="10.5" r="1" fill="currentColor" />
                </svg>
              </button>
            </div>
          </div>
          <button type="button" className="action-btn primary" onClick={onRegenerate}>
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" strokeWidth="1.3" />
              <path d="M13.7 1.8v2.8h-2.8" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            Regenerate
          </button>
        </ControlSection>

        <ControlSection
          id="section-terrain"
          title="HEIGHT / TERRAIN"
          defaultOpen
          icon={<SectionIcon><svg viewBox="0 0 16 16" fill="none"><path d="M2 12 L6 5 L9 8 L11 6 L14 12 Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg></SectionIcon>}
        >
          {TERRAIN_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} />
          ))}
        </ControlSection>

        <ControlSection
          id="section-planet-style"
          title="PLANET STYLE"
          defaultOpen
          statusDot={params.planetStyle?.customEdits ? 'active' : null}
          icon={<SectionIcon><svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" /><ellipse cx="8" cy="8" rx="2.5" ry="5.5" stroke="currentColor" strokeWidth="0.9" /></svg></SectionIcon>}
        >
          <PlanetStylePanel {...planetStyleProps} embedded />
        </ControlSection>

        <ControlSection
          id="section-water"
          title="WATER"
          defaultOpen={false}
          icon={<SectionIcon><svg viewBox="0 0 16 16" fill="none"><path d="M8 3c-1.5 2.5-4 4-4 6.5a4 4 0 0 0 8 0C12 7 9.5 5.5 8 3z" stroke="currentColor" strokeWidth="1.2" /></svg></SectionIcon>}
        >
          <ToggleRow label="Water Animation" value={params.waterAnim} onChange={(v) => onParam('waterAnim', v)} />
          <div className="subsection-label">Water Colors</div>
          {WATER_COLORS.map(({ key, label }) => (
            <div className="color-field" key={key}>
              <label>{label}</label>
              <input
                type="color"
                value={colorToHex(palette[key] ?? [0.05, 0.2, 0.35])}
                onChange={(e) => planetStyleProps.onColorChange(key, parseColor(e.target.value))}
              />
            </div>
          ))}
        </ControlSection>

        <ControlSection
          id="section-noise"
          title="NOISE"
          defaultOpen
          icon={<SectionIcon><svg viewBox="0 0 16 16" fill="none"><path d="M1 10c2-3 3-3 5 0s3 3 5 0 3-3 5 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg></SectionIcon>}
        >
          <SelectRow label="Noise Preset" value={params.noisePreset ?? 'default'}
            options={Object.entries(NOISE_PRESETS).map(([key, p]) => ({ value: key, label: p.label }))}
            onChange={planetStyleProps.onNoisePreset} />
          {NOISE_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} />
          ))}
        </ControlSection>

        <ControlSection
          id="section-materials"
          title="MATERIALS / BIOMES"
          defaultOpen={false}
          icon={<SectionIcon><svg viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" /><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" /><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" /><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" /></svg></SectionIcon>}
        >
          <div className="subsection-label">Biome</div>
          {BIOME_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} />
          ))}
          <ToggleRow label="Biome Debug" value={params.biomeDebug} onChange={(v) => onParam('biomeDebug', v)} />

          <div className="subsection-label">Surface</div>
          {RENDER_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} />
          ))}
        </ControlSection>
      </div>
    </aside>
  );
}
