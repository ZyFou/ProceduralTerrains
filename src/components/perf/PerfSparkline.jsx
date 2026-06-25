// Lightweight SVG sparkline — no deps, theme-aware via CSS variables.

export default function PerfSparkline({
  data = [],
  width = 280,
  height = 52,
  color = 'var(--accent)',
  fill = 'var(--accent-bg)',
  minY,
  maxY,
  reference,
  referenceLabel,
  unit = '',
  invert = false,
}) {
  if (!data.length) {
    return (
      <div className="perf-graph-empty" style={{ height }}>
        <span>Collecting samples…</span>
      </div>
    );
  }

  const pad = { t: 4, r: 4, b: 4, l: 4 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  let lo = minY ?? Math.min(...data);
  let hi = maxY ?? Math.max(...data);
  if (reference != null) {
    lo = Math.min(lo, reference);
    hi = Math.max(hi, reference);
  }
  if (hi - lo < 0.001) {
    lo -= 1;
    hi += 1;
  }
  const range = hi - lo;

  const pts = data.map((v, i) => {
    const x = pad.l + (i / Math.max(data.length - 1, 1)) * innerW;
    const norm = (v - lo) / range;
    const y = pad.t + (invert ? norm : 1 - norm) * innerH;
    return [x, y];
  });

  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const first = pts[0];
  const area = `${line} L${last[0].toFixed(1)},${height - pad.b} L${first[0].toFixed(1)},${height - pad.b} Z`;

  let refY = null;
  if (reference != null) {
    const norm = (reference - lo) / range;
    refY = pad.t + (invert ? norm : 1 - norm) * innerH;
  }

  const latest = data[data.length - 1];

  return (
    <div className="perf-graph-wrap">
      <svg
        className="perf-graph-svg"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        aria-hidden
      >
        <path className="perf-graph-area" d={area} fill={fill} />
        <path className="perf-graph-line" d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {refY != null && (
          <line
            className="perf-graph-ref"
            x1={pad.l}
            y1={refY}
            x2={width - pad.r}
            y2={refY}
            stroke="var(--text-dim)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.55"
          />
        )}
        <circle className="perf-graph-dot" cx={last[0]} cy={last[1]} r="2.5" fill={color} />
      </svg>
      <div className="perf-graph-meta">
        <span className="perf-graph-latest" style={{ color }}>
          {Number.isFinite(latest) ? (Number.isInteger(latest) ? latest : latest.toFixed(1)) : '–'}
          {unit && <em>{unit}</em>}
        </span>
        {referenceLabel && <span className="perf-graph-ref-label">{referenceLabel}</span>}
      </div>
    </div>
  );
}
