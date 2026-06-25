import { useEffect, useState } from 'react';

export function fmt(def, v) {
  const digits = def.digits ?? 0;
  return Number(v).toFixed(digits) + (def.unit ? ` ${def.unit}` : '');
}

export function SliderCtl({ def, value, onChange, icon, info, disabled, disabledTooltip, settingId }) {
  const [text, setText] = useState(fmt(def, value));
  useEffect(() => { setText(fmt(def, value)); }, [value, def]);

  const commitText = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v)) onChange(Math.min(Math.max(v, def.min), def.max));
    else setText(fmt(def, value));
  };

  const fill = ((value - def.min) / (def.max - def.min)) * 100;
  const tooltipText = info ?? def.info;
  const itemIcon = icon ?? def.icon;

  return (
    <div
      className={`ctl${disabled ? ' disabled' : ''}`}
      data-setting-id={settingId}
      style={disabled ? { opacity: 0.45, pointerEvents: 'none' } : null}
    >
      <div className="ctl-top">
        <div className="label-with-icon" data-tooltip={disabled ? disabledTooltip : tooltipText}>
          {itemIcon && <span className="setting-icon">{itemIcon}</span>}
          <span className="setting-label">{def.label}</span>
          {tooltipText && (
            <span className="info-icon-trigger">
              <svg viewBox="0 0 16 16" fill="none" width="10" height="10" style={{ marginLeft: '4px' }}>
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
                <path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
          )}
        </div>
        <input
          className="ctl-val"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        />
      </div>
      <div className="slider-track-wrap">
        <div className="slider-track-bg" />
        <div className="slider-track-fill" style={{ width: `${fill}%` }} />
        <input
          type="range"
          className="slider-input"
          min={def.min}
          max={def.max}
          step={def.step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>
    </div>
  );
}

export function ToggleRow({ label, value, onChange, icon, info, disabled, disabledTooltip, settingId }) {
  return (
    <div
      className={`toggle-row${disabled ? ' disabled' : ''}`}
      data-setting-id={settingId}
      style={disabled ? { opacity: 0.45, pointerEvents: 'none' } : null}
    >
      <div className="label-with-icon" data-tooltip={disabled ? disabledTooltip : info}>
        {icon && <span className="setting-icon">{icon}</span>}
        <span className="setting-label">{label}</span>
        {(info || disabledTooltip) && (
          <span className="info-icon-trigger">
            <svg viewBox="0 0 16 16" fill="none" width="10" height="10" style={{ marginLeft: '4px' }}>
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
              <path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
        )}
      </div>
      <button
        type="button"
        className={`toggle${value ? ' on' : ''}`}
        onClick={() => onChange(!value)}
        aria-pressed={!!value}
      />
    </div>
  );
}

export function SelectRow({ label, value, options, format, onChange, icon, info, disabled, disabledTooltip, settingId }) {
  return (
    <div
      className={`row${disabled ? ' disabled' : ''}`}
      data-setting-id={settingId}
      style={disabled ? { opacity: 0.45, pointerEvents: 'none' } : null}
    >
      <div className="label-with-icon" data-tooltip={disabled ? disabledTooltip : info}>
        {icon && <span className="setting-icon">{icon}</span>}
        <span className="setting-label">{label}</span>
        {(info || disabledTooltip) && (
          <span className="info-icon-trigger">
            <svg viewBox="0 0 16 16" fill="none" width="10" height="10" style={{ marginLeft: '4px' }}>
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
              <path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
        )}
      </div>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={String(opt.value ?? opt)} value={opt.value ?? opt} disabled={!!opt.disabled}>
            {opt.label ?? (format ? format(opt) : String(opt))}
          </option>
        ))}
      </select>
    </div>
  );
}

// Native color input that stays mounted while dragging in the picker.
export function ColorInput({ value, onChange, className }) {
  const commit = (e) => onChange(e.target.value);
  return (
    <input
      type="color"
      className={className}
      value={value}
      onInput={commit}
      onChange={commit}
    />
  );
}

export function Panel({ id, title, className = '', children }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`panel ${className}`} id={id}>
      <div className="panel-header">
        <span>{title}</span>
        <button type="button" className="collapse-btn" onClick={() => setOpen(!open)}>
          {open ? '‹' : '›'}
        </button>
      </div>
      <div className={`panel-body${open ? '' : ' collapsed'}`}>{children}</div>
    </section>
  );
}
