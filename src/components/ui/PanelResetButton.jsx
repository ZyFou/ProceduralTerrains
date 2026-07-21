import { RotateCcw } from 'lucide-react';

export default function PanelResetButton({ label = 'Reset Settings', onClick, settingId }) {
  if (!onClick) return null;
  return (
    <div className="panel-reset-footer">
      <button
        type="button"
        className="action-btn panel-reset-btn"
        onClick={onClick}
        data-setting-id={settingId}
      >
        <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
        {label}
      </button>
    </div>
  );
}
import React from 'react';

