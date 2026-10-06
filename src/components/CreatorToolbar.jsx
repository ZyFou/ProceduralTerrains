import { translateText, useLanguage } from '../i18n/LanguageContext.jsx';
import { Route } from 'lucide-react';

export default function CreatorToolbar({ active, onToggle }) {
  useLanguage();
  return (
    <div className="creator-toolbar" role="toolbar" aria-label={translateText("Creator tools")}>
      <div className="creator-toolbar-popover" role="tooltip">
        <strong>{translateText("Spline editor")}</strong>
        <span>{translateText("Draw editable roads and rivers on the terrain.")}</span>
        <kbd>S</kbd>
      </div>
      <button
        type="button"
        className={`creator-toolbar-btn${active ? ' active' : ''}`}
        onClick={onToggle}
        title={translateText("Toggle spline editor (S)")}
        aria-label={translateText("Toggle spline editor")}
        aria-pressed={active}
      >
        <Route size={16} strokeWidth={1.9} aria-hidden />
      </button>
    </div>
  );
}
import React from 'react';

