import React, { useContext, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FlatPanelContext } from '../panels/PanelContext.js';

export default function ControlSection({
  id,
  title,
  icon,
  defaultOpen = true,
  forceOpen = false,
  statusDot,
  settingId,
  nested = false,
  children,
  onToggle,
  enabled,
  onEnabledChange,
}) {
  const flat = useContext(FlatPanelContext);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    onToggle?.(next);
  };

  if (flat) {
    const sectionKey = settingId ?? id;
    return (
      <section
        className={`panel-group collapsible-group${open ? ' open' : ''}${nested ? ' nested' : ''}`}
        id={id}
        data-section={id}
        data-setting-id={sectionKey}
      >
        <div className="panel-group-header panel-group-toggle">
          <button type="button" className="panel-group-header-button" onClick={toggle} aria-expanded={open}>
            {icon && <span className="panel-group-icon">{icon}</span>}
            <span className="panel-group-title">{title}</span>
            {statusDot && <span className={`control-section-dot${statusDot === 'active' ? ' active' : ''}`} />}
            <span className={`panel-group-chevron${open ? ' open' : ''}`} aria-hidden><ChevronDown size={14} strokeWidth={2} /></span>
          </button>
          {onEnabledChange && <button type="button" className={`toggle section-enable-toggle${enabled ? ' on' : ''}`} onClick={() => onEnabledChange(!enabled)} aria-label={`${enabled ? 'Disable' : 'Enable'} ${title}`} aria-pressed={!!enabled} />}
        </div>
        {open && <div className="panel-group-body">{children}</div>}
      </section>
    );
  }

  return (
    <section className="control-section" id={id} data-section={id} data-setting-id={settingId ?? id}>
      <div className="control-section-header">
        <button type="button" className="control-section-header-button" onClick={toggle} aria-expanded={open}>
          <span className="control-section-left">
            {icon && <span className="control-section-icon">{icon}</span>}
            <span className="control-section-title">{title}</span>
            {statusDot && <span className={`control-section-dot${statusDot === 'active' ? ' active' : ''}`} />}
          </span>
          <span className={`control-section-chevron${open ? ' open' : ''}`} aria-hidden><ChevronDown size={14} strokeWidth={2} /></span>
        </button>
        {onEnabledChange && <button type="button" className={`toggle section-enable-toggle${enabled ? ' on' : ''}`} onClick={() => onEnabledChange(!enabled)} aria-label={`${enabled ? 'Disable' : 'Enable'} ${title}`} aria-pressed={!!enabled} />}
      </div>
      <div className={`control-section-body${open ? '' : ' collapsed'}`}>{children}</div>
    </section>
  );
}
