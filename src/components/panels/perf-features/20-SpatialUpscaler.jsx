import React from 'react';
import ControlSection from '../../ui/ControlSection.jsx';
import { SelectRow, SliderCtl } from '../../controls.jsx';
import { savePerfSettings } from '../../../engine/render/PerformanceSettings.js';
import { normalizeSpatialUpscaler } from '../../../engine/render/SpatialUpscaler.js';

export default function SpatialUpscalerSettings({ perf, onPerfSetting }) {
  const settings = normalizeSpatialUpscaler(perf);
  const scale = Number(perf.renderScale) || 1;
  const set = (key, value) => {
    // The worker has no localStorage; save this experiment's explicit UI edits
    // on the main thread as well, without requiring the energy-saving PR.
    savePerfSettings({ ...perf, [key]: value });
    onPerfSetting(key, value);
  };
  return (
    <ControlSection id="perf-spatial-upscaler" title="Spatial Upscaler (Experimental)" defaultOpen>
      <SelectRow
        label="Upscaler Experiment"
        value={settings.spatialUpscaler}
        options={[
          { value: 'off', label: 'Off (use Resolution Reconstruction)' },
          { value: 'linear', label: 'Bilinear (comparison baseline)' },
          { value: 'sharp', label: 'Spatial + Adaptive Sharpness' },
        ]}
        onChange={(value) => set('spatialUpscaler', value)}
        settingId="performance.spatialUpscaler"
        info="Single-frame filtering of the lower-resolution scene. No AI, frame generation or temporal history. Pixelated modes take priority."
      />
      <SliderCtl
        def={{ key: 'renderScale', label: 'Scene Render Scale', min: 0.4, max: 1, step: 0.05, digits: 2, unit: '×' }}
        value={Math.min(1, scale)}
        onChange={(value) => set('renderScale', value)}
        settingId="performance.renderScale"
      />
      {scale > 1 && <p className="settings-note">Supersampling is active ({scale.toFixed(2)}×). This shortcut sets a scale at or below native; the main Render Scale control retains the full range.</p>}
      {settings.spatialUpscaler === 'sharp' && <SliderCtl
        def={{ key: 'spatialUpscaleSharpness', label: 'Adaptive Sharpness', min: 0, max: 1, step: 0.05, digits: 2 }}
        value={settings.spatialUpscaleSharpness}
        onChange={(value) => set('spatialUpscaleSharpness', value)}
        settingId="performance.spatialUpscaleSharpness"
      />}
      <p className="settings-note">
        Try 0.75×: the scene uses about 56% of the native pixel count before reconstruction.
        The UI stays native. At 1× or above, spatial reconstruction is bypassed unless another setting reduces the actual scene size.
        Compare Bilinear and Spatial at the same scale with Auto Performance disabled for a stable test.
        The filter cannot restore missing detail; gains and image quality need testing on your GPU.
      </p>
      {perf.resolutionDenoiseMode === 'pixelated' && <p className="settings-note">
        Pixelated Denoise overrides this experiment. Select Clean Denoise in Resolution Reconstruction to test the spatial filter.
      </p>}
    </ControlSection>
  );
}
