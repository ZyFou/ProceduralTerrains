import { useEffect, useRef, useState } from 'react';
import { PRESETS } from '../../engine/presets.js';
import { NOISE_PRESETS } from '../../engine/style/NoisePresets.js';
import { colorToHex, parseColor } from '../../engine/style/ColorPalette.js';
import PlanetStylePanel from '../PlanetStylePanel.jsx';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';
import ControlSection from './ControlSection.jsx';

const TERRAIN_SLIDERS = [
  {
    key: 'heightScale',
    label: 'Height Scale',
    min: 20,
    max: 1000,
    step: 5,
    unit: 'm',
    info: 'Maximum amplitude of mountain heights in meters',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'seaLevel',
    label: 'Sea Level',
    min: 0,
    max: 250,
    step: 1,
    unit: 'm',
    info: 'Depth offset for deep water and coastal biomes',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M1 9c1.5-1 2.5-1 4 0s2.5 1 4 0 2.5-1 4 0 2.5 1 3 0" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'falloff',
    label: 'Island Falloff',
    min: 0.05,
    max: 1,
    step: 0.01,
    digits: 2,
    info: 'Applies an edge-distance attenuation factor to shape the world as an island',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
];

const NOISE_SLIDERS = [
  {
    key: 'noiseScale',
    label: 'Noise Scale',
    min: 8,
    max: 160,
    step: 0.5,
    digits: 1,
    info: 'Global frequency scaling of the terrain fractal noise (higher = larger features)',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M2 8h12M4 5l-2 3 2 3M12 5l2 3-2 3" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'noiseStrength',
    label: 'Noise Strength',
    min: 0.1,
    max: 2,
    step: 0.01,
    digits: 2,
    info: 'Overall multiplier applied to the final height output',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M8 2v12M5 5l3-3 3 3" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'octaves',
    label: 'Octaves',
    min: 1,
    max: 9,
    step: 1,
    info: 'Number of layered noise detail passes (higher = more detailed but slower)',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M2 12h12M2 8h12M2 4h12" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'persistence',
    label: 'Persistence',
    min: 0.15,
    max: 0.85,
    step: 0.01,
    digits: 2,
    info: 'Amplitude retention factor of successive octave passes (higher = rougher terrain)',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M1 8h3v1h3v1h3v1h5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'lacunarity',
    label: 'Lacunarity',
    min: 1.5,
    max: 3.5,
    step: 0.01,
    digits: 2,
    info: 'Frequency scale factor of successive octave passes (higher = finer detail frequency)',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M1 8h2v-4h2v4h2v-4h2v4h2v-4h2v4h1" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'ridge',
    label: 'Ridge Intensity',
    min: 0,
    max: 1,
    step: 0.01,
    digits: 2,
    info: 'Sharpness of peak ridge structures (higher = more alpine/canyon-like)',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M1 13l4-8 3 5 4-7 3 10H1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    key: 'warp',
    label: 'Domain Warp',
    min: 0,
    max: 3,
    step: 0.05,
    digits: 2,
    info: 'Domain warping intensity for twisting/layering folds on the terrain surface',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M2 8c2-4 4 4 6 0s4-4 6 0" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
];

const BIOME_SLIDERS = [
  {
    key: 'biomeScale',
    label: 'Biome Density',
    min: 0.3,
    max: 3,
    step: 0.05,
    digits: 2,
    info: 'Distribution frequency of biomes (higher = more fragmented biome maps)',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
        <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    )
  },
  {
    key: 'tempBias',
    label: 'Temperature',
    min: -1,
    max: 1,
    step: 0.05,
    digits: 2,
    info: 'Adjust world temperature (colder = more snow/tundra, hotter = desert/dry grass)',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 8.5V3a1 1 0 0 0-2 0v5.5a2.5 2.5 0 0 0 2 0z" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'moistScale',
    label: 'Moisture Scale',
    min: 0.2,
    max: 3,
    step: 0.05,
    digits: 2,
    info: 'Frequency scale of moisture bands (higher = more varied moisture patches)',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M8 2c-1.5 2.5-4 4-4 6.5a4 4 0 0 0 8 0C12 6 9.5 4.5 8 2z" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'moistBias',
    label: 'Moisture Bias',
    min: -1,
    max: 1,
    step: 0.05,
    digits: 2,
    info: 'Adjust world moisture level (wetter = more forests/jungles, drier = desert/grass)',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M3 10.5a2.5 2.5 0 0 1 2-4.4 3.5 3.5 0 0 1 6.8 1.1 2.5 2.5 0 0 1-.8 4.8H3zM5 14v-2M8 14v-2M11 14v-2" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'snowLine',
    label: 'Snow Line',
    min: 0.2,
    max: 1,
    step: 0.01,
    digits: 2,
    info: 'Height threshold above which snow cover begins to appear on rock peaks',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M2 13h12M8 2L4.5 9h7L8 2z" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
];

const RENDER_SLIDERS = [
  {
    key: 'normalStrength',
    label: 'Normal Strength',
    min: 0.2,
    max: 3,
    step: 0.05,
    digits: 2,
    info: 'Intensity factor of procedural surface detail normal mapping',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M8 2v12M8 2l-3 3M8 2l3 3" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'aoStrength',
    label: 'Ambient Occlusion',
    min: 0,
    max: 1,
    step: 0.05,
    digits: 2,
    info: 'Shadow shading intensity in crevices and valleys (Ambient Occlusion)',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <path d="M3 8h10M8 3v10" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
];

const WATER_COLORS = [
  {
    key: 'deep',
    label: 'Deep Water',
    info: 'Color of the deepest ocean beds',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="8" cy="8" r="3" fill="currentColor" />
      </svg>
    )
  },
  {
    key: 'shallow',
    label: 'Shallow',
    info: 'Color of shores and shallow coastlines',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    key: 'foam',
    label: 'Foam',
    info: 'Color of waves breaking near the shoreline',
    icon: (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M2 10a2 2 0 0 1 4 0M6 10a2 2 0 0 1 4 0M10 10a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
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
          <SelectRow
            label="Preset"
            value={params.preset}
            options={Object.entries(PRESETS).map(([key, p]) => ({ value: key, label: p.label }))}
            onChange={onPreset}
            info="Select a global terrain layout preset shaping the mountains, islands, and plains"
            icon={<svg viewBox="0 0 16 16" fill="none"><path d="M1.5 12l4-7 3.5 5 2.5-3.5 3 5.5h-13z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>}
          />
          <div className="seed-row">
            <div className="label-with-icon" data-tooltip="Base integer value for the procedural height map generation algorithm" style={{ marginBottom: '5px' }}>
              <span className="setting-icon">
                <svg viewBox="0 0 16 16" fill="none">
                  <rect x="3" y="3" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </span>
              <span className="setting-label">Seed</span>
              <span className="info-icon-trigger">
                <svg viewBox="0 0 16 16" fill="none" width="10" height="10" style={{ marginLeft: '4px' }}>
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
            </div>
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
          <button type="button" className="action-btn primary" onClick={onRegenerate} data-tooltip="Rebuild the procedural meshes and textures using the current settings">
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
          <ToggleRow
            label="Water Animation"
            value={params.waterAnim}
            onChange={(v) => onParam('waterAnim', v)}
            info="Enable dynamic vertex displacement waves on the water surface mesh"
            icon={<svg viewBox="0 0 16 16" fill="none"><path d="M1 9c1.5-1 2.5-1 4 0s2.5 1 4 0 2.5-1 4 0 2.5 1 3 0" stroke="currentColor" strokeWidth="1.2" /></svg>}
          />
          <div className="subsection-label">Water Colors</div>
          {WATER_COLORS.map(({ key, label, icon, info }) => (
            <div className="color-field" key={key}>
              <div className="label-with-icon" data-tooltip={info}>
                {icon && <span className="setting-icon">{icon}</span>}
                <span className="setting-label">{label}</span>
                {info && (
                  <span className="info-icon-trigger">
                    <svg viewBox="0 0 16 16" fill="none" width="10" height="10" style={{ marginLeft: '4px' }}>
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
                      <path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </span>
                )}
              </div>
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
          <SelectRow
            label="Noise Preset"
            value={params.noisePreset ?? 'default'}
            options={Object.entries(NOISE_PRESETS).map(([key, p]) => ({ value: key, label: p.label }))}
            onChange={planetStyleProps.onNoisePreset}
            info="Select a baseline noise shape configuration (e.g. Dunes, Alien, Rugged)"
            icon={<svg viewBox="0 0 16 16" fill="none"><path d="M1 9c2.5-3 3.5-3 5 0s2.5 3 5 0 2.5-3 4 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>}
          />
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
          <ToggleRow
            label="Biome Debug"
            value={params.biomeDebug}
            onChange={(v) => onParam('biomeDebug', v)}
            info="Color-code biomes directly on the terrain surface for inspection"
            icon={<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.2" /><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.2" /></svg>}
          />

          <div className="subsection-label">Surface</div>
          {RENDER_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={params[def.key]} onChange={(v) => onParam(def.key, v)} />
          ))}
        </ControlSection>
      </div>
    </aside>
  );
}
