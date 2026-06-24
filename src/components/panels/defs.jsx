import { ColorInput } from '../controls.jsx';

// Shared control definitions used across drawer panels (moved out of the old
// LeftControlPanel so panels can import them directly).

export const TERRAIN_SLIDERS = [
  {
    key: 'heightScale', label: 'Height Scale', min: 20, max: 1000, step: 5, unit: 'm',
    info: 'Maximum amplitude of mountain heights in meters',
    icon: (<svg viewBox="0 0 16 16" fill="none"><path d="M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
  {
    key: 'seaLevel', label: 'Sea Level', min: 0, max: 250, step: 1, unit: 'm',
    info: 'Depth offset for deep water and coastal biomes',
    icon: (<svg viewBox="0 0 16 16" fill="none"><path d="M1 9c1.5-1 2.5-1 4 0s2.5 1 4 0 2.5-1 4 0 2.5 1 3 0" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
  {
    key: 'falloff', label: 'Edge Falloff Width', min: 0, max: 1, step: 0.01, digits: 2,
    info: 'Edge attenuation band for the island/mountain rim. 0 leaves the terrain unchanged to the boundary',
    icon: (<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" /><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
];

export const NOISE_SLIDERS = [
  {
    key: 'noiseScale', label: 'Noise Scale', min: 8, max: 160, step: 0.5, digits: 1,
    info: 'Global frequency scaling of the terrain fractal noise (higher = larger features)',
    icon: (<svg viewBox="0 0 16 16" fill="none"><path d="M2 8h12M4 5l-2 3 2 3M12 5l2 3-2 3" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
  {
    key: 'noiseStrength', label: 'Noise Strength', min: 0.1, max: 2, step: 0.01, digits: 2,
    info: 'Overall multiplier applied to the final height output',
    icon: (<svg viewBox="0 0 16 16" fill="none"><path d="M8 2v12M5 5l3-3 3 3" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
  {
    key: 'octaves', label: 'Octaves', min: 1, max: 9, step: 1,
    info: 'Number of layered noise detail passes (higher = more detailed but slower)',
    icon: (<svg viewBox="0 0 16 16" fill="none"><path d="M2 12h12M2 8h12M2 4h12" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
  {
    key: 'persistence', label: 'Persistence', min: 0.15, max: 0.85, step: 0.01, digits: 2,
    info: 'Amplitude retention factor of successive octave passes (higher = rougher terrain)',
    icon: (<svg viewBox="0 0 16 16" fill="none"><path d="M1 8h3v1h3v1h3v1h5" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
  {
    key: 'lacunarity', label: 'Lacunarity', min: 1.5, max: 3.5, step: 0.01, digits: 2,
    info: 'Frequency scale factor of successive octave passes (higher = finer detail frequency)',
    icon: (<svg viewBox="0 0 16 16" fill="none"><path d="M1 8h2v-4h2v4h2v-4h2v4h2v-4h2v4h1" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
  {
    key: 'ridge', label: 'Ridge Intensity', min: 0, max: 1, step: 0.01, digits: 2,
    info: 'Sharpness of peak ridge structures (higher = more alpine/canyon-like)',
    icon: (<svg viewBox="0 0 16 16" fill="none"><path d="M1 13l4-8 3 5 4-7 3 10H1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>),
  },
  {
    key: 'warp', label: 'Domain Warp', min: 0, max: 3, step: 0.05, digits: 2,
    info: 'Domain warping intensity for twisting/layering folds on the terrain surface',
    icon: (<svg viewBox="0 0 16 16" fill="none"><path d="M2 8c2-4 4 4 6 0s4-4 6 0" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
];

export const BIOME_SLIDERS = [
  {
    key: 'biomeScale', label: 'Biome Density', min: 0.3, max: 3, step: 0.05, digits: 2,
    info: 'Distribution frequency of biomes (higher = more fragmented biome maps)',
    icon: (<svg viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" /><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" /></svg>),
  },
  {
    key: 'tempBias', label: 'Temperature', min: -1, max: 1, step: 0.05, digits: 2,
    info: 'Adjust world temperature (colder = more snow/tundra, hotter = desert/dry grass)',
    icon: (<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.2" /><path d="M8 8.5V3a1 1 0 0 0-2 0v5.5a2.5 2.5 0 0 0 2 0z" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
  {
    key: 'moistScale', label: 'Moisture Scale', min: 0.2, max: 3, step: 0.05, digits: 2,
    info: 'Frequency scale of moisture bands (higher = more varied moisture patches)',
    icon: (<svg viewBox="0 0 16 16" fill="none"><path d="M8 2c-1.5 2.5-4 4-4 6.5a4 4 0 0 0 8 0C12 6 9.5 4.5 8 2z" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
  {
    key: 'moistBias', label: 'Moisture Bias', min: -1, max: 1, step: 0.05, digits: 2,
    info: 'Adjust world moisture level (wetter = more forests/jungles, drier = desert/grass)',
    icon: (<svg viewBox="0 0 16 16" fill="none"><path d="M3 10.5a2.5 2.5 0 0 1 2-4.4 3.5 3.5 0 0 1 6.8 1.1 2.5 2.5 0 0 1-.8 4.8H3zM5 14v-2M8 14v-2M11 14v-2" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
  {
    key: 'snowLine', label: 'Snow Line', min: 0.2, max: 1, step: 0.01, digits: 2,
    info: 'Height threshold above which snow cover begins to appear on rock peaks',
    icon: (<svg viewBox="0 0 16 16" fill="none"><path d="M2 13h12M8 2L4.5 9h7L8 2z" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
];

export const RENDER_SLIDERS = [
  {
    key: 'normalStrength', label: 'Normal Strength', min: 0.2, max: 3, step: 0.05, digits: 2,
    info: 'Intensity factor of procedural surface detail normal mapping',
    icon: (<svg viewBox="0 0 16 16" fill="none"><path d="M8 2v12M8 2l-3 3M8 2l3 3" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
  {
    key: 'aoStrength', label: 'Ambient Occlusion', min: 0, max: 1, step: 0.05, digits: 2,
    info: 'Shadow shading intensity in crevices and valleys (Ambient Occlusion)',
    icon: (<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" /><path d="M3 8h10M8 3v10" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
];

export const WATER_COLORS = [
  {
    key: 'deep', label: 'Deep Water', info: 'Color of the deepest ocean beds',
    icon: (<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" /><circle cx="8" cy="8" r="3" fill="currentColor" /></svg>),
  },
  {
    key: 'shallow', label: 'Shallow', info: 'Color of shores and shallow coastlines',
    icon: (<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" /><circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
  {
    key: 'foam', label: 'Foam', info: 'Color of waves breaking near the shoreline',
    icon: (<svg viewBox="0 0 16 16" fill="none"><path d="M2 10a2 2 0 0 1 4 0M6 10a2 2 0 0 1 4 0M10 10a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.2" /></svg>),
  },
];

// Shared info-dot used next to labels.
export function InfoDot() {
  return (
    <span className="info-icon-trigger">
      <svg viewBox="0 0 16 16" fill="none" width="10" height="10" style={{ marginLeft: '4px' }}>
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

// A labelled colour field (matches the existing .color-field markup).
export function ColorField({ label, icon, info, value, onChange }) {
  return (
    <div className="color-field">
      <div className="label-with-icon" data-tooltip={info}>
        {icon && <span className="setting-icon">{icon}</span>}
        <span className="setting-label">{label}</span>
        {info && <InfoDot />}
      </div>
      <ColorInput value={value} onChange={(hex) => onChange({ target: { value: hex } })} />
    </div>
  );
}
