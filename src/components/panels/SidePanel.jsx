import { X } from 'lucide-react';

// Shared chrome for every drawer panel: header (title + description + close),
// scrollable content, optional footer.
export default function SidePanel({ title, description, onClose, footer, children }) {
  return (
    <div className="side-panel">
      <header className="side-panel-header">
        <div className="side-panel-heading">
          <h2 className="side-panel-title">{title}</h2>
          {description && <p className="side-panel-desc">{description}</p>}
        </div>
        <button type="button" className="side-panel-close" onClick={onClose} aria-label="Close panel" title="Close (Esc)">
          <X size={15} strokeWidth={2} aria-hidden />
        </button>
      </header>
      <div className="side-panel-content">{children}</div>
      {footer && <footer className="side-panel-footer">{footer}</footer>}
    </div>
  );
}

// Lightweight sub-tab strip used inside large panels (e.g. Terrain).
export function PanelTabs({ tabs, active, onChange }) {
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
          {t.label}
        </button>
      ))}
    </div>
  );
}
