import { translateText, useLanguage } from '../i18n/LanguageContext.jsx';
import { Box, Globe2, Grid2x2, Map } from 'lucide-react';
import SlidingIndicator from './ui/SlidingIndicator.jsx';

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
  miniActive = false,
}) {
  useLanguage();
  if (!visible) return null;

  const showIcons = modeDisplay === 'both' || modeDisplay === 'icons';
  const showLabels = modeDisplay === 'both' || modeDisplay === 'labels';

  return (
    <div
      className="viewport-mode-bar has-slider"
      role="group"
      aria-label={translateText("World mode")}
    >
      <SlidingIndicator selector=".mode-bar-btn.active" />
      {miniActive && (
        <button
          type="button"
          className="camera-bar-btn mode-bar-btn active"
          aria-pressed
          title={translateText('Mini Terrain: a single diorama in the finite world')}
        >
          {showIcons && <Box size={14} strokeWidth={1.75} aria-hidden />}
          {showLabels && <span className="mode-bar-label">{translateText('Mini Terrain')}</span>}
        </button>
      )}
      {MODES.map((m) => {
        const Icon = m.Icon;
        // Mini is a single finite diorama: the other world modes do not apply.
        if (miniActive) return null;
        return (
          <button
            key={m.id}
            type="button"
            className={`camera-bar-btn mode-bar-btn${worldMode === m.id ? ' active' : ''}`}
            onClick={() => onSetWorldMode(m.id)}
            disabled={modeLocked}
            aria-pressed={worldMode === m.id}
            title={translateText(m.label)}
          >
            {showIcons && <Icon size={14} strokeWidth={1.75} aria-hidden />}
            {showLabels && <span className="mode-bar-label">{translateText(m.label)}</span>}
          </button>
        );
      })}
    </div>
  );
}
import React from 'react';
