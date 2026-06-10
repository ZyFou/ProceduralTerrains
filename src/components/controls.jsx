import { useEffect, useState } from 'react';

// Reusable editor controls. They keep the exact CSS classes from the original
// stylesheet, so styles.css works unchanged.

export function fmt(def, v) {
  const digits = def.digits ?? 0;
  return Number(v).toFixed(digits) + (def.unit ? ` ${def.unit}` : '');
}

export function SliderCtl({ def, value, onChange }) {
  const [text, setText] = useState(fmt(def, value));
  useEffect(() => { setText(fmt(def, value)); }, [value, def]);

  const commitText = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v)) onChange(Math.min(Math.max(v, def.min), def.max));
    else setText(fmt(def, value));
  };

  const fill = ((value - def.min) / (def.max - def.min)) * 100;

  return (
    <div className="ctl">
      <div className="ctl-top">
        <label>{def.label}</label>
        <input
          className="ctl-val"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        />
      </div>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        style={{ '--fill': `${fill}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export function ToggleRow({ label, value, onChange }) {
  return (
    <div className="toggle-row">
      <label>{label}</label>
      <button
        type="button"
        className={`toggle${value ? ' on' : ''}`}
        onClick={() => onChange(!value)}
        aria-pressed={!!value}
      />
    </div>
  );
}

export function SelectRow({ label, value, options, format, onChange }) {
  return (
    <div className="row">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={String(opt.value ?? opt)} value={opt.value ?? opt}>
            {opt.label ?? (format ? format(opt) : String(opt))}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Panel({ id, title, className = '', children }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`panel ${className}`} id={id}>
      <div className="panel-header">
        <span>{title}</span>
        <button className="collapse-btn" onClick={() => setOpen(!open)}>
          {open ? '‹' : '›'}
        </button>
      </div>
      <div className={`panel-body${open ? '' : ' collapsed'}`}>{children}</div>
    </section>
  );
}
