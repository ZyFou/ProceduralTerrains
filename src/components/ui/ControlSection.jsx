import { useState } from 'react';

export default function ControlSection({
  id,
  title,
  icon,
  defaultOpen = true,
  statusDot,
  children,
  onToggle,
}) {
  const [open, setOpen] = useState(defaultOpen);

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
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path d="M4 6l4 4 4-4" stroke="currentColor" fill="none" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      <div className={`control-section-body${open ? '' : ' collapsed'}`}>{children}</div>
    </section>
  );
}
