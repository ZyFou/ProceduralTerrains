const DEFAULT = { enabled: false, mode: 'elevation', display: 'overlay', opacity: .72, min: 0, max: 600, thresholdA: 35, thresholdB: 55, contourSpacing: 50, contourStrength: .35, legend: true, quality: 'high' };
const MODES = ['elevation', 'slope', 'normals', 'curvature', 'waterDepth', 'biome', 'contribution'];
const CODES = Object.fromEntries(MODES.map((mode, index) => [mode, index + 1]));

export class TerrainAnalysisManager {
  constructor({ uniforms, getParams, onChange }) { this.uniforms = uniforms; this.getParams = getParams; this.onChange = onChange; this.state = { ...DEFAULT }; this._sync(); }
  setMode(mode) { this.setSettings({ mode: MODES.includes(mode) ? mode : 'elevation', enabled: true }); }
  setSettings(patch) { Object.assign(this.state, patch); this.state.opacity = Math.max(0, Math.min(1, this.state.opacity)); this._sync(); this.onChange?.({ ...this.state }); }
  _sync() {
    const p = this.getParams(); const s = this.state;
    this.uniforms.uAnalysisEnabled.value = s.enabled ? 1 : 0; this.uniforms.uAnalysisMode.value = CODES[s.mode] || 1;
    this.uniforms.uAnalysisOpacity.value = s.opacity; this.uniforms.uAnalysisMin.value = s.min;
    this.uniforms.uAnalysisMax.value = s.max || p.heightScale; this.uniforms.uAnalysisThresholdA.value = s.thresholdA;
    this.uniforms.uAnalysisThresholdB.value = s.thresholdB; this.uniforms.uAnalysisContourSpacing.value = s.contourSpacing;
    this.uniforms.uAnalysisContourStrength.value = s.contourStrength;
  }
  serialize() { return { ...this.state }; }
  load(data) { this.state = { ...DEFAULT, ...(data || {}) }; this._sync(); this.onChange?.({ ...this.state }); }
}

export const ANALYSIS_LEGENDS = {
  elevation: 'Low  ─────────  High', slope: 'Flat · Walkable · Steep · Cliff', normals: 'World-space normals', curvature: 'Valley  ─ Flat ─ Ridge',
  waterDepth: 'Shallow  ─────────  Deep', biome: 'Biome distribution', contribution: 'Base · Paint · Splines',
};
