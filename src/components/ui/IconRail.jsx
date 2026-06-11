const SECTIONS = [
  { id: 'section-generate', label: 'Generate', title: 'Generate' },
  { id: 'section-terrain', label: 'Terrain', title: 'Height / Terrain' },
  { id: 'section-noise', label: 'Noise', title: 'Noise' },
  { id: 'section-planet-style', label: 'Style', title: 'Planet Style' },
  { id: 'section-water', label: 'Water', title: 'Water' },
  { id: 'section-materials', label: 'Biomes', title: 'Materials / Biomes' },
];

const ICONS = {
  'section-generate': (
    <svg viewBox="0 0 20 20" fill="none">
      <path d="M4 14l4-7 3 4 2-3 5 6" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="14.5" cy="5" r="1.5" fill="currentColor" />
    </svg>
  ),
  'section-terrain': (
    <svg viewBox="0 0 20 20" fill="none">
      <path d="M3 15 L8 6 L11 10 L14 7 L17 15 Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  'section-water': (
    <svg viewBox="0 0 20 20" fill="none">
      <path d="M10 4c-2 3-5 5-5 8a5 5 0 0 0 10 0c0-3-3-5-5-8z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  'section-noise': (
    <svg viewBox="0 0 20 20" fill="none">
      <path d="M2 12c2-4 3-4 5 0s3 4 5 0 3-4 6 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  'section-planet-style': (
    <svg viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.4" />
      <ellipse cx="10" cy="10" rx="3" ry="6.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
  'section-materials': (
    <svg viewBox="0 0 20 20" fill="none">
      <rect x="4" y="4" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="11" y="4" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="4" y="11" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="11" y="11" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
};

export { SECTIONS };

export default function IconRail({ activeId, onSelect }) {
  return (
    <nav className="icon-rail" aria-label="Control categories">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`icon-rail-btn${activeId === s.id ? ' active' : ''}`}
          title={s.title}
          aria-label={s.title}
          onClick={() => onSelect(s.id)}
        >
          {ICONS[s.id]}
        </button>
      ))}
    </nav>
  );
}
