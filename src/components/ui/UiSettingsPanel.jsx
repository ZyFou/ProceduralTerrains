import { X } from 'lucide-react';

const MODE_DISPLAY_OPTIONS = [
  { id: 'both', label: 'Icons + names' },
  { id: 'icons', label: 'Icons only' },
  { id: 'labels', label: 'Names only' },
];

/**
 * UI appearance settings — opened from Layout → Settings.
 */
export default function UiSettingsPanel({ open, prefs, onChange, onClose }) {
  if (!open) return null;

  const set = (patch) => onChange({ ...prefs, ...patch });

  return (
    <div className="ui-settings-overlay" role="dialog" aria-modal="true" aria-label="UI settings">
      <button type="button" className="ui-settings-backdrop" aria-label="Close settings" onClick={onClose} />
      <div className="ui-settings-panel">
        <header className="ui-settings-header">
          <div>
            <h2 className="ui-settings-title">Settings</h2>
            <p className="ui-settings-desc">Interface appearance and chrome density.</p>
          </div>
          <button type="button" className="side-panel-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <X size={15} strokeWidth={2} aria-hidden />
          </button>
        </header>

        <div className="ui-settings-body">
          <section className="ui-settings-section">
            <h3 className="ui-settings-section-title">Tools toolbar</h3>
            <label className="ui-settings-row">
              <span className="ui-settings-row-label">Show tool names</span>
              <input
                type="checkbox"
                checked={!!prefs.toolbarLabels}
                onChange={(e) => set({ toolbarLabels: e.target.checked })}
              />
            </label>
          </section>

          <section className="ui-settings-section">
            <h3 className="ui-settings-section-title">World modes</h3>
            <div className="ui-settings-choice-group" role="radiogroup" aria-label="Mode button display">
              {MODE_DISPLAY_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={prefs.modeDisplay === opt.id}
                  className={`ui-settings-choice${prefs.modeDisplay === opt.id ? ' active' : ''}`}
                  onClick={() => set({ modeDisplay: opt.id })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
