import { useContext, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FlatPanelContext } from '../panels/PanelContext.js';

export default function ControlSection({
  id,
  title,
  icon,
  defaultOpen = true,
  statusDot,
  children,
  onToggle,
}) {
  const flat = useContext(FlatPanelContext);
  const [open, setOpen] = useState(defaultOpen);

  // Inside a drawer panel: render a plain, always-open labelled group with no
  // collapsable folder chrome.
  if (flat) {
    return (
      <section className="panel-group" id={id} data-section={id}>
        <div className="panel-group-header">
          {icon && <span className="panel-group-icon">{icon}</span>}
          <span className="panel-group-title">{title}</span>
          {statusDot && <span className={`control-section-dot${statusDot === 'active' ? ' active' : ''}`} />}
        </div>
        <div className="panel-group-body">{children}</div>
      </section>
    );
  }

  const toggle = () => {
    const next = !open;
    setOpen(next);
    onToggle?.(next);
  };

  return (
    <section className="control-section" id={id} data-section={id}>
      <button type="button" className="control-section-header" onClick={toggle} aria-expanded={open}>
        <span className="control-section-left">
          {icon && <span className="control-section-icon">{icon}</span>}
          <span className="control-section-title">{title}</span>
          {statusDot && <span className={`control-section-dot${statusDot === 'active' ? ' active' : ''}`} />}
        </span>
        <span className={`control-section-chevron${open ? ' open' : ''}`} aria-hidden>
          <ChevronDown size={14} strokeWidth={2} />
        </span>
      </button>
      <div className={`control-section-body${open ? '' : ' collapsed'}`}>{children}</div>
    </section>
  );
}
