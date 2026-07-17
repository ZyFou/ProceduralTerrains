import { Globe2, Grid2x2, Map } from 'lucide-react';

const MODES = [
  { id: 'studio', label: 'Tile', Icon: Grid2x2 },
  { id: 'infinite', label: 'Infinite World', Icon: Map },
  { id: 'planet', label: 'Planet', Icon: Globe2 },
];

/**
 * Floating world-mode switcher under the top bar (canvas overlay).
 * Fixed position for now. Respects uiPrefs.modeDisplay.
 */
export default function WorldModeBar({
  worldMode,
  onSetWorldMode,
  modeLocked,
  modeDisplay = 'both',
  visible = true,
}) {
  if (!visible) return null;

  const showIcons = modeDisplay === 'both' || modeDisplay === 'icons';
  const showLabels = modeDisplay === 'both' || modeDisplay === 'labels';

  return (
    <div
      className="viewport-mode-bar"
      role="group"
      aria-label="World mode"
    >
      {MODES.map((m) => {
        const Icon = m.Icon;
        return (
          <button
            key={m.id}
            type="button"
            className={`camera-bar-btn mode-bar-btn${worldMode === m.id ? ' active' : ''}`}
            onClick={() => onSetWorldMode(m.id)}
            disabled={modeLocked}
            aria-pressed={worldMode === m.id}
            title={m.label}
          >
            {showIcons && <Icon size={14} strokeWidth={1.75} aria-hidden />}
            {showLabels && <span className="mode-bar-label">{m.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
