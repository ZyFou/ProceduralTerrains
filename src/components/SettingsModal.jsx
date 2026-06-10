import { SliderCtl, ToggleRow, SelectRow } from './controls.jsx';

const SETTINGS_SCHEMA = [
  { key: 'sunAzimuth', label: 'Sun Azimuth', min: 0, max: 360, step: 1, unit: '°' },
  { key: 'sunElevation', label: 'Sun Elevation', min: 8, max: 85, step: 1, unit: '°' },
  { key: 'fogDensity', label: 'Fog Density', min: 0, max: 2, step: 0.05, digits: 2 },
  { key: 'waterAnim', label: 'Water Animation', type: 'toggle' },
  { key: 'pixelRatio', label: 'Pixel Ratio', type: 'select', options: [0, 0.75, 1, 1.5, 2], format: (v) => (Number(v) === 0 ? 'Auto' : `${v}×`) },
];

export default function SettingsModal({ open, params, onParam, onClose }) {
  if (!open) return null;
  return (
    <div className="modal" onClick={(e) => e.target.classList.contains('modal') && onClose()}>
      <div className="modal-card">
        <div className="modal-header">
          <span>Project Settings</span>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {SETTINGS_SCHEMA.map((def) => {
            if (def.type === 'toggle') {
              return (
                <ToggleRow key={def.key} label={def.label} value={params[def.key]}
                  onChange={(v) => onParam(def.key, v)} />
              );
            }
            if (def.type === 'select') {
              return (
                <SelectRow key={def.key} label={def.label} value={params[def.key]}
                  options={def.options} format={def.format}
                  onChange={(v) => onParam(def.key, parseFloat(v))} />
              );
            }
            return (
              <SliderCtl key={def.key} def={def} value={params[def.key]}
                onChange={(v) => onParam(def.key, v)} />
            );
          })}
        </div>
      </div>
    </div>
  );
}
