// ============================================================================
// QualitySettings: thin compatibility layer over PerformanceSettings.
// The quality presets (Performance / Balanced / High / Ultra) are now full
// performance snapshots defined in PerformanceSettings.js; this module keeps
// the original import surface for the HUD and any legacy callers.
// ============================================================================

import { PERF_PRESETS, getPerfPresetKeys } from './PerformanceSettings.js';

export const QUALITY_PRESETS = PERF_PRESETS;

/**
 * Get the settings object for a quality preset key.
 * @param {string} key — one of 'performance', 'balanced', 'high', 'ultra'
 * @returns {Object} — the preset settings, or balanced if key is invalid
 */
export function getQualitySettings(key) {
  return PERF_PRESETS[key] || PERF_PRESETS.balanced;
}

/**
 * Get ordered list of quality preset keys for UI dropdowns.
 */
export function getQualityKeys() {
  return getPerfPresetKeys();
}
