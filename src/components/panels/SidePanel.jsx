import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import React, { useContext } from 'react';
import { X } from 'lucide-react';
import { DrawerChromeContext } from './PanelContext.js';

// Shared chrome for every drawer panel: header (title + description + close),
// scrollable content, optional footer.
export default function SidePanel({ title, description, onClose, footer, children }) {
  useLanguage();
  const { onHeaderPointerDown } = useContext(DrawerChromeContext);

  const onHeaderDown = (e) => {
    if (e.target.closest('.side-panel-close')) return;
    onHeaderPointerDown?.(e);
  };

  return (
    <div className="side-panel">
      <header
        className={`side-panel-header${onHeaderPointerDown ? ' side-panel-header--draggable' : ''}`}
        onPointerDown={onHeaderDown}
      >
        <div className="side-panel-heading">
          <h2 className="side-panel-title">{translateText(title)}</h2>
          {description && <p className="side-panel-desc">{translateText(description)}</p>}
        </div>
        <button type="button" className="side-panel-close" onClick={onClose} aria-label={translateText("Close panel")} title={translateText("Close (Esc)")}>
          <X size={15} strokeWidth={2} aria-hidden />
        </button>
      </header>
      <div className="side-panel-content">{children}</div>
      {footer && <footer className="side-panel-footer">{translateText(footer)}</footer>}
    </div>
  );
}

// Lightweight sub-tab strip used inside large panels (e.g. Terrain).
export function PanelTabs({ tabs, active, onChange }) {
  useLanguage();
  return (
    <div className="panel-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={`panel-tab${active === t.id ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {translateText(t.label)}
        </button>
      ))}
    </div>
  );
}
