// ============================================================================
// Export / import planet style presets (palette + style tuning).
// ============================================================================

export function exportPlanetStyle(planetStyle) {
  return {
    app: 'terrain-studio',
    type: 'planet-style',
    version: 1,
    exportedAt: new Date().toISOString(),
    planetStyle,
  };
}

export function downloadPlanetStyleJSON(planetStyle, filename = 'planet-style.json') {
  const data = exportPlanetStyle(planetStyle);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function parsePlanetStyleJSON(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.planetStyle) return json.planetStyle;
  if (json.palette) return json;
  return null;
}
