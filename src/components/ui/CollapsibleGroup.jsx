import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function CollapsibleGroup({
  title,
  icon,
  defaultOpen = false,
  statusDot,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`panel-group collapsible-group${open ? ' open' : ''}`}>
      <button
        type="button"
        className="panel-group-header panel-group-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {icon && <span className="panel-group-icon">{icon}</span>}
        <span className="panel-group-title">{title}</span>
        {statusDot && (
          <span className={`control-section-dot${statusDot === 'active' ? ' active' : ''}`} />
        )}
        <span className={`panel-group-chevron${open ? ' open' : ''}`} aria-hidden>
          <ChevronDown size={14} strokeWidth={2} />
        </span>
      </button>
      {open && <div className="panel-group-body">{children}</div>}
    </section>
  );
}
