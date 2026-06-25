import { useContext } from 'react';
import ControlSection from './ControlSection.jsx';
import { FlatPanelContext } from '../panels/PanelContext.js';
import { SliderCtl, ToggleRow, SelectRow } from '../controls.jsx';
import { ColorField, WATER_COLORS, TERRAIN_SLIDERS } from '../panels/defs.jsx';
import { colorToHex, parseColor } from '../../engine/style/ColorPalette.js';
import { PERF_LIMITS } from '../../engine/render/PerformanceSettings.js';
import {
  WATER_MODES,
  WATER_DEFAULT_PARAMS,
  UNDERWATER_MODES,
  isRealisticWaterMode,
  resolveEffectiveWaterMode,
  isWaterModeDowngraded,
  resolveUnderwaterMode,
  underwaterModeFellBack,
  WORLD_MODE_WATER_LABELS,
  WORLD_MODE_WATER_HINTS,
} from '../../engine/water/WaterSettings.js';
import { WATER_DEBUG_VIEWS } from '../../engine/water/WaterDebugViews.js';
import PanelResetButton from './PanelResetButton.jsx';

function val(params, key) {
  return params[key] ?? WATER_DEFAULT_PARAMS[key];
}

const SEA_LEVEL_DEF = TERRAIN_SLIDERS.find((s) => s.key === 'seaLevel');

const MODE_HINTS = {
  off: 'Water disabled — no mesh, no underwater effect.',
  legacy: 'Fast original water shader. Best for performance and Infinite World.',
  realistic: 'Depth-based color, fresnel, shoreline foam, underwater fog.',
  volumetric: 'Stronger absorption, caustics, and refraction distortion.',
  cinematic: 'Highest quality — expensive. Best for screenshots in Tile mode.',
};

const MATERIAL_SLIDERS = [
  { key: 'waterOpacity', label: 'Opacity', min: 0.2, max: 1, step: 0.01, digits: 2 },
  { key: 'waterRoughness', label: 'Roughness', min: 0, max: 1, step: 0.02, digits: 2 },
  { key: 'waterFresnelStrength', label: 'Fresnel Strength', min: 0, max: 2, step: 0.05, digits: 2 },
  { key: 'waterRefractionStrength', label: 'Refraction Strength', min: 0, max: 1.5, step: 0.05, digits: 2 },
  { key: 'waterSpecularStrength', label: 'Specular Strength', min: 0, max: 2, step: 0.05, digits: 2 },
];

const DEPTH_SLIDERS = [
  { key: 'waterDepthColorStrength', label: 'Depth Color Strength', min: 0, max: 2, step: 0.05, digits: 2 },
  { key: 'waterDepthOpacityStrength', label: 'Depth Opacity Strength', min: 0, max: 2, step: 0.05, digits: 2 },
  { key: 'waterMaxVisibleDepth', label: 'Max Visible Depth', min: 20, max: 250, step: 5, unit: ' u' },
  { key: 'waterDepthFalloff', label: 'Depth Falloff', min: 0.2, max: 3, step: 0.05, digits: 2 },
  { key: 'waterShallowDistance', label: 'Shallow Distance', min: 2, max: 30, step: 0.5, digits: 1, unit: ' u' },
  { key: 'waterDeepDistance', label: 'Deep Distance', min: 20, max: 120, step: 1, unit: ' u' },
  { key: 'waterAbsorptionStrength', label: 'Absorption Strength', min: 0, max: 2, step: 0.05, digits: 2 },
];

const WAVE_SLIDERS = [
  { key: 'waterWaveSpeed', label: 'Wave Speed', min: 0, max: 3, step: 0.05, digits: 2 },
  { key: 'waterWaveScale', label: 'Wave Scale', min: 0.3, max: 3, step: 0.05, digits: 2 },
  { key: 'waterWaveStrength', label: 'Wave Strength', min: 0, max: 2, step: 0.05, digits: 2 },
  { key: 'waterSmallWaveStrength', label: 'Small Waves', min: 0, max: 2, step: 0.05, digits: 2 },
  { key: 'waterLargeWaveStrength', label: 'Large Waves', min: 0, max: 2, step: 0.05, digits: 2 },
  { key: 'waterNormalIntensity', label: 'Normal Intensity', min: 0, max: 2, step: 0.05, digits: 2 },
  { key: 'waterWaveDirection', label: 'Wave Direction', min: 0, max: 360, step: 1, unit: '°' },
  { key: 'waterAnimSpeed', label: 'Animation Speed', min: 0, max: 3, step: 0.05, digits: 2 },
];

const FOAM_SLIDERS = [
  { key: 'waterFoamStrength', label: 'Shoreline Foam Strength', min: 0, max: 1.5, step: 0.02, digits: 2 },
  { key: 'waterFoamWidth', label: 'Foam Width', min: 0.5, max: 12, step: 0.1, digits: 1, unit: ' u' },
  { key: 'waterFoamSoftness', label: 'Foam Softness', min: 0.1, max: 4, step: 0.1, digits: 1 },
  { key: 'waterFoamAnimSpeed', label: 'Foam Animation', min: 0, max: 3, step: 0.05, digits: 2 },
  { key: 'waterSlopeFoam', label: 'Slope-Based Foam', min: 0, max: 1.5, step: 0.05, digits: 2 },
  { key: 'waterCliffFoam', label: 'Cliff / Rock Foam', min: 0, max: 1.5, step: 0.05, digits: 2 },
];

// Apply to both Lite and High underwater modes.
const UNDERWATER_SLIDERS = [
  { key: 'waterUnderwaterFogDensity', label: 'Fog Density', min: 0.2, max: 2.5, step: 0.05, digits: 2 },
  { key: 'waterUnderwaterVisibility', label: 'Visibility Distance', min: 0.25, max: 2, step: 0.05, digits: 2 },
  { key: 'waterUnderwaterDistortion', label: 'Surface Distortion', min: 0, max: 1.5, step: 0.05, digits: 2 },
  { key: 'waterSurfaceTransition', label: 'Surface Transition', min: 0.2, max: 2, step: 0.05, digits: 2 },
];

const CAUSTIC_SLIDERS = [
  { key: 'waterUnderwaterCaustics', label: 'Caustics Strength', min: 0, max: 1.5, step: 0.05, digits: 2 },
  { key: 'waterUnderwaterCausticScale', label: 'Caustics Scale', min: 0.25, max: 3, step: 0.05, digits: 2 },
  { key: 'waterUnderwaterCausticSpeed', label: 'Caustics Speed', min: 0, max: 3, step: 0.05, digits: 2 },
];

const REALISTIC_PERF_SLIDERS = [
  { key: 'waterReflectionQuality', label: 'Reflection Quality', min: 0, max: 1.5, step: 0.05, digits: 2, expensive: true },
  { key: 'waterRefractionQuality', label: 'Refraction Quality', min: 0, max: 1.5, step: 0.05, digits: 2, expensive: true },
  { key: 'waterFoamQuality', label: 'Foam Quality', min: 0, max: 1.5, step: 0.05, digits: 2 },
  { key: 'waterCausticsQuality', label: 'Caustics Quality', min: 0, max: 1.5, step: 0.05, digits: 2, expensive: true },
  { key: 'waterNormalResolution', label: 'Normal Map Resolution', min: 0.25, max: 1.5, step: 0.05, digits: 2 },
  { key: 'waterRenderScale', label: 'Water Render Scale', min: 0.4, max: 1.5, step: 0.05, digits: 2 },
  { key: 'waterDisableExpensiveBelowFps', label: 'FPS Downgrade Threshold', min: 24, max: 60, step: 1, digits: 0 },
];

const WATER_QUALITY_OPTIONS = [
  { value: '0', label: 'Low' },
  { value: '1', label: 'Medium' },
  { value: '2', label: 'High' },
];

const lim = (key, label, step, opts = {}) => ({
  key,
  label,
  step,
  min: PERF_LIMITS[key].min,
  max: PERF_LIMITS[key].max,
  ...opts,
});

const LEGACY_SHADER_SLIDERS = [
  lim('waterReflection', 'Water Reflection', 0.05, { digits: 2, unit: '×' }),
  lim('waterDetail', 'Water Detail', 0.05, { digits: 2, unit: '×' }),
  lim('waterWaves', 'Wave Complexity', 0.05, { digits: 2, unit: '×' }),
];

function PerfSlider({ perf, id, def, onPerfSetting, settingId }) {
  return (
    <SliderCtl
      def={def}
      value={perf?.[id] ?? PERF_LIMITS[id]?.min ?? 0}
      onChange={(v) => onPerfSetting(id, v)}
      settingId={settingId}
    />
  );
}

export default function WaterPanelInner({
  params,
  onParam,
  worldMode,
  perf,
  onPerfSetting,
  planetStyleProps,
  onResetWaterSettings,
  onExportWaterMasks,
  id = 'inspector-water',
}) {
  const flat = useContext(FlatPanelContext);
  const palette = params.planetStyle?.palette ?? {};
  const mode = val(params, 'waterMode');
  const enabled = val(params, 'waterEnabled');
  const selectedRealistic = isRealisticWaterMode(mode);
  const legacy = mode === 'legacy' || mode === 'off';
  const isStudio = worldMode === 'studio';
  const isInfinite = worldMode === 'infinite';
  const isPlanet = worldMode === 'planet';
  const worldLabel = WORLD_MODE_WATER_LABELS[worldMode] ?? worldMode;
  const effectiveMode = resolveEffectiveWaterMode(params, worldMode);
  const effectiveRealistic = isRealisticWaterMode(effectiveMode);
  const downgraded = isWaterModeDowngraded(params, worldMode);
  const modeLabel = WATER_MODES.find((m) => m.value === mode)?.label ?? mode;
  const effectiveLabel = WATER_MODES.find((m) => m.value === effectiveMode)?.label ?? effectiveMode;
  const p = perf ?? {};

  const setEnabled = (v) => {
    onParam('waterEnabled', v);
    onParam('waterMode', v ? (mode === 'off' ? 'legacy' : mode) : 'off');
  };

  const setMode = (v) => {
    onParam('waterMode', v);
    onParam('waterEnabled', v !== 'off');
  };

  const setSeaLevel = (v) => {
    onParam('seaLevel', v);
    if (v <= 0.5 && mode !== 'off') {
      onParam('waterMode', 'off');
      onParam('waterEnabled', false);
    } else if (v > 0.5 && mode === 'off') {
      onParam('waterMode', 'legacy');
      onParam('waterEnabled', true);
    }
  };

  const content = (
    <>
      <div className={`water-mode-banner${effectiveRealistic ? ' realistic' : effectiveMode === 'legacy' ? ' legacy' : ''}`}>
        <span className="water-mode-banner-label">{worldLabel} · Water</span>
        <span className="water-mode-banner-value">
          {downgraded ? `${modeLabel} → ${effectiveLabel}` : modeLabel}
        </span>
        <p className="section-hint">{WORLD_MODE_WATER_HINTS[worldMode]}</p>
        {downgraded && (
          <p className="section-hint warning">
            Rendering as {effectiveLabel}
            {isInfinite && val(params, 'waterAutoDowngradeInfinite') ? ' (auto-downgrade active)' : ''}
            {isPlanet && selectedRealistic ? ' (planet spherical fallback)' : ''}
          </p>
        )}
      </div>

      <ControlSection id={`${id}-mode`} title="Mode" defaultOpen>
        <ToggleRow
          label="Water Enabled"
          value={enabled && mode !== 'off'}
          onChange={setEnabled}
          settingId="water.waterEnabled"
          info="Master toggle for the water surface and underwater effects in all world modes."
        />
        {SEA_LEVEL_DEF && (
          <SliderCtl
            def={SEA_LEVEL_DEF}
            value={params.seaLevel}
            onChange={setSeaLevel}
            settingId="water.seaLevel"
          />
        )}
        <SelectRow
          label="Water Mode"
          value={mode}
          options={WATER_MODES}
          onChange={setMode}
          settingId="water.waterMode"
          info={MODE_HINTS[mode] ?? 'Select the water rendering pipeline.'}
        />
        {isInfinite && (
          <ToggleRow
            label="Auto Downgrade in Infinite World"
            value={!!val(params, 'waterAutoDowngradeInfinite')}
            onChange={(v) => onParam('waterAutoDowngradeInfinite', v)}
            settingId="water.waterAutoDowngradeInfinite"
            info="Cap Volumetric/Cinematic to Realistic while exploring Infinite World."
          />
        )}
        <ToggleRow
          label="Use Legacy on Low FPS"
          value={!!val(params, 'waterLegacyOnLowFps')}
          onChange={(v) => onParam('waterLegacyOnLowFps', v)}
          settingId="water.waterLegacyOnLowFps"
          info="Temporarily reduce expensive water effects when FPS drops below the threshold."
        />
      </ControlSection>

      {enabled && mode !== 'off' && (
        <ControlSection id={`${id}-shader`} title="Shader Quality" defaultOpen>
          <SelectRow
            label="Water Quality"
            value={String(p.waterQuality ?? 2)}
            options={WATER_QUALITY_OPTIONS}
            onChange={(v) => onPerfSetting?.('waterQuality', parseInt(v, 10))}
            settingId="performance.waterQuality"
            info="Legacy shader quality tier — applies in Tile, Infinite World, and Planet."
          />
          {LEGACY_SHADER_SLIDERS.map((def) => (
            <PerfSlider
              key={def.key}
              perf={p}
              id={def.key}
              def={def}
              onPerfSetting={onPerfSetting}
              settingId={`performance.${def.key}`}
            />
          ))}
          {isInfinite && (
            <PerfSlider
              perf={p}
              id="waterDistance"
              def={lim('waterDistance', 'Water Render Distance', 0.05, { digits: 2, unit: '×', info: 'How far the infinite water plane extends relative to loaded terrain.' })}
              onPerfSetting={onPerfSetting}
              settingId="performance.waterDistance"
            />
          )}
        </ControlSection>
      )}

      <ControlSection id={`${id}-material`} title="Material" defaultOpen={enabled}>
        <ToggleRow
          label="Water Animation"
          value={params.waterAnim}
          onChange={(v) => onParam('waterAnim', v)}
          settingId="water.waterAnim"
          info="Animate surface ripples and foam in all world modes."
        />
        <div className="subsection-label">Water Colors</div>
        {WATER_COLORS.map(({ key, label, icon, info }) => (
          <ColorField
            key={key}
            label={label}
            icon={icon}
            info={info}
            value={colorToHex(palette[key] ?? [0.05, 0.2, 0.35])}
            onChange={(e) => planetStyleProps.onColorChange(key, parseColor(e.target.value))}
          />
        ))}
        {selectedRealistic && MATERIAL_SLIDERS.map((def) => (
          <SliderCtl
            key={def.key}
            def={def}
            value={val(params, def.key)}
            onChange={(v) => onParam(def.key, v)}
            settingId={`water.${def.key}`}
          />
        ))}
        {legacy && enabled && (
          <p className="section-hint">
            Legacy shader uses the colors above plus Shader Quality settings. Switch to Realistic for depth, foam, and volumetric controls.
          </p>
        )}
      </ControlSection>

      {selectedRealistic && (
        <ControlSection id={`${id}-depth`} title="Depth" defaultOpen={isStudio}>
          {!effectiveRealistic && (
            <p className="section-hint">
              Stored for Tile / Infinite World. {isPlanet ? 'Planet currently renders Legacy water.' : 'Effective mode differs from selected mode.'}
            </p>
          )}
          {DEPTH_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} settingId={`water.${def.key}`} />
          ))}
        </ControlSection>
      )}

      {enabled && (
        <ControlSection id={`${id}-waves`} title="Waves" defaultOpen={false}>
          {selectedRealistic
            ? WAVE_SLIDERS.map((def) => (
              <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} settingId={`water.${def.key}`} />
            ))
            : LEGACY_SHADER_SLIDERS.filter((d) => d.key === 'waterWaves').map((def) => (
              <PerfSlider key={def.key} perf={p} id={def.key} def={def} onPerfSetting={onPerfSetting} settingId={`performance.${def.key}`} />
            ))}
        </ControlSection>
      )}

      {selectedRealistic && (
        <ControlSection id={`${id}-foam`} title="Foam" defaultOpen={false}>
          <ToggleRow
            label="Enable Foam"
            value={!!val(params, 'waterFoamEnabled')}
            onChange={(v) => onParam('waterFoamEnabled', v)}
            settingId="water.waterFoamEnabled"
          />
          {FOAM_SLIDERS.map((def) => (
            <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} settingId={`water.${def.key}`} />
          ))}
        </ControlSection>
      )}

      {enabled && !isPlanet && (() => {
        const uwEnabled = !!val(params, 'waterUnderwaterEnabled') && p.underwaterEffect !== false;
        const uwResolved = resolveUnderwaterMode(params, effectiveMode, p.underwaterEffect !== false);
        const uwFellBack = underwaterModeFellBack(params, effectiveMode);
        const requested = val(params, 'waterUnderwaterMode');
        return (
          <ControlSection id={`${id}-underwater`} title="Underwater" defaultOpen={false}>
            <ToggleRow
              label="Enable Underwater Effect"
              value={uwEnabled}
              onChange={(v) => {
                onParam('waterUnderwaterEnabled', v);
                onPerfSetting?.('underwaterEffect', v);
              }}
              settingId="water.waterUnderwaterEnabled"
              info="Camera submersion fog, tint and caustics in Tile and Infinite World."
            />
            <SelectRow
              label="Underwater Mode"
              value={requested}
              options={UNDERWATER_MODES}
              onChange={(v) => onParam('waterUnderwaterMode', v)}
              settingId="water.waterUnderwaterMode"
              info="Lite is cheap (any water). High is cinematic and needs the Realistic renderer. Auto picks High with Realistic water, Lite otherwise."
            />
            {uwEnabled && (
              <p className={`section-hint${uwFellBack ? ' warning' : ''}`}>
                {uwResolved === 'off'
                  ? 'Underwater effects are off.'
                  : `Active mode: ${uwResolved === 'high' ? 'High' : 'Lite'}`}
                {uwFellBack ? ' — High requires the Realistic renderer, falling back to Lite.' : ''}
              </p>
            )}

            {uwEnabled && UNDERWATER_SLIDERS.map((def) => (
              <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} settingId={`water.${def.key}`} />
            ))}

            {uwEnabled && (
              <>
                <div className="subsection-label">Caustics</div>
                <ToggleRow
                  label="Caustics Enabled"
                  value={val(params, 'waterUnderwaterCausticsEnabled') !== false}
                  onChange={(v) => onParam('waterUnderwaterCausticsEnabled', v)}
                  settingId="water.waterUnderwaterCausticsEnabled"
                  info="Animated dappled light projected on the submerged sea floor."
                />
                {val(params, 'waterUnderwaterCausticsEnabled') !== false && CAUSTIC_SLIDERS.map((def) => (
                  <SliderCtl key={def.key} def={def} value={val(params, def.key)} onChange={(v) => onParam(def.key, v)} settingId={`water.${def.key}`} />
                ))}
              </>
            )}

            {uwEnabled && (
              <>
                <div className="subsection-label">High Mode Extras</div>
                <ToggleRow
                  label="Light Shafts"
                  value={!!val(params, 'waterUnderwaterLightShafts')}
                  onChange={(v) => onParam('waterUnderwaterLightShafts', v)}
                  settingId="water.waterUnderwaterLightShafts"
                  info="Volumetric sun rays through the water. High mode only."
                />
                <ToggleRow
                  label="Suspended Particles"
                  value={!!val(params, 'waterUnderwaterParticles')}
                  onChange={(v) => onParam('waterUnderwaterParticles', v)}
                  settingId="water.waterUnderwaterParticles"
                  info="Sparse floating specks for immersion. High mode only."
                />
                {uwResolved !== 'high' && (val(params, 'waterUnderwaterLightShafts') || val(params, 'waterUnderwaterParticles')) && (
                  <p className="section-hint">Light shafts and particles only render in High mode.</p>
                )}
              </>
            )}
          </ControlSection>
        );
      })()}

      {enabled && isPlanet && (
        <ControlSection id={`${id}-planet`} title="Planet Ocean" defaultOpen={false}>
          <p className="section-hint">
            Planet uses a spherical ocean shell at sea level. Water colors and animation apply immediately.
            Underwater post-processing is disabled on the planet (curved surface). Realistic depth/foam settings are saved for other modes.
          </p>
        </ControlSection>
      )}

      {selectedRealistic && (
        <ControlSection id={`${id}-performance`} title="Performance" defaultOpen={false}>
          {mode === 'cinematic' && isStudio && (
            <p className="section-hint warning">Cinematic mode is expensive — best for Tile mode screenshots.</p>
          )}
          {REALISTIC_PERF_SLIDERS.map((def) => (
            <SliderCtl
              key={def.key}
              def={{ ...def, info: def.expensive ? `${def.label} — may impact FPS.` : undefined }}
              value={val(params, def.key)}
              onChange={(v) => onParam(def.key, v)}
              settingId={`water.${def.key}`}
            />
          ))}
        </ControlSection>
      )}

      <ControlSection id={`${id}-debug`} title="Debug" defaultOpen={false}>
        <SelectRow
          label="Water Debug View"
          value={val(params, 'waterDebugView')}
          options={WATER_DEBUG_VIEWS}
          onChange={(v) => onParam('waterDebugView', v)}
          settingId="water.waterDebugView"
          info="Overlay water masks on the surface (requires effective Realistic mode)."
        />
        <ToggleRow
          label="Show Water Mesh Bounds"
          value={!!val(params, 'waterShowMeshBounds')}
          onChange={(v) => onParam('waterShowMeshBounds', v)}
          settingId="water.waterShowMeshBounds"
          info="Outline the active water mesh for this world mode."
        />
        <ToggleRow
          label="Show Water Performance Cost"
          value={!!val(params, 'waterShowPerfCost')}
          onChange={(v) => onParam('waterShowPerfCost', v)}
          settingId="water.waterShowPerfCost"
        />
        {!effectiveRealistic && (
          <p className="section-hint">Shader debug views need an effective Realistic (or higher) mode.</p>
        )}
      </ControlSection>

      <ControlSection id={`${id}-export`} title="Export" defaultOpen={false}>
        <p className="section-hint">
          {isStudio
            ? 'Export water masks from the tile height field, or use the Export panel for GLB output.'
            : isInfinite
              ? 'Mask export samples the current procedural height field at the board scale.'
              : 'Mask export uses planet height sampling where available; GLB export includes the ocean shell.'}
        </p>
        <button type="button" className="action-btn" onClick={() => onExportWaterMasks?.({ exportWaterMask: true, exportDepthMap: true })}>
          Export Water + Depth Masks
        </button>
        <button type="button" className="action-btn" onClick={() => onExportWaterMasks?.({ exportShorelineMask: true, exportFoamMask: true })}>
          Export Shoreline + Foam Masks
        </button>
      </ControlSection>

      <PanelResetButton label="Reset Water Settings" onClick={onResetWaterSettings} settingId="water.reset" />
    </>
  );

  if (flat) return content;

  return <div className="water-panel-inner">{content}</div>;
}
