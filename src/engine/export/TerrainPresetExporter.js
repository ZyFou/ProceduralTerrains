// ============================================================================
// Export / import planet style presets (palette + style tuning).
// ============================================================================
import { saveBlob } from '../../platform/DesktopBridge.js';

export function exportPlanetStyle(planetStyle) {
  return {
    app: 'terrain-studio',
    type: 'planet-style',
    version: 1,
    exportedAt: new Date().toISOString(),
    planetStyle,
  };
}

export async function downloadPlanetStyleJSON(planetStyle, filename = 'planet-style.json') {
  const data = exportPlanetStyle(planetStyle);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  return saveBlob(blob, filename);
}

export function parsePlanetStyleJSON(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.planetStyle) return json.planetStyle;
  if (json.palette) return json;
  return null;
}
