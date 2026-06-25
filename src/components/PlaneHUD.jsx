// Flight instruments overlay for plane explore mode — artificial horizon + throttle quadrant.

const PX_PER_DEG = 2.1;
const PITCH_LADDER = [10, 20, 30, 40, 50];

function fmtAlt(m) {
  if (!Number.isFinite(m)) return '—';
  return Math.round(m).toLocaleString();
}

function fmtVs(mps) {
  if (!Number.isFinite(mps)) return '—';
  const sign = mps >= 0 ? '+' : '';
  return `${sign}${Math.round(mps)}`;
}

function ArtificialHorizon({ pitch = 0, roll = 0, stall = false }) {
  const pitchPx = pitch * PX_PER_DEG;
  const clipId = 'plane-ai-clip';

  return (
    <div className={`plane-ai${stall ? ' plane-ai-stall' : ''}`} aria-label="Artificial horizon">
      <svg viewBox="0 0 140 140" className="plane-ai-svg">
        <defs>
          <clipPath id={clipId}>
            <circle cx="70" cy="70" r="58" />
          </clipPath>
        </defs>
        <circle cx="70" cy="70" r="62" className="plane-ai-bezel" />
        <g clipPath={`url(#${clipId})`}>
          <g
            className="plane-ai-horizon"
            transform={`translate(0 ${pitchPx}) rotate(${-roll} 70 70)`}
          >
            <rect x="-40" y="-200" width="220" height="200" className="plane-ai-sky" />
            <rect x="-40" y="0" width="220" height="200" className="plane-ai-ground" />
            <line x1="-40" y1="0" x2="180" y2="0" className="plane-ai-horizon-line" />
            {PITCH_LADDER.map((deg) => (
              <g key={deg}>
                <line
                  x1={52}
                  y1={-deg * PX_PER_DEG}
                  x2={88}
                  y2={-deg * PX_PER_DEG}
                  className="plane-ai-ladder"
                />
                <text
                  x={92}
                  y={-deg * PX_PER_DEG + 3.5}
                  className="plane-ai-ladder-label"
                >
                  {deg}
                </text>
                <line
                  x1={52}
                  y1={deg * PX_PER_DEG}
                  x2={88}
                  y2={deg * PX_PER_DEG}
                  className="plane-ai-ladder"
                />
                <text
                  x={92}
                  y={deg * PX_PER_DEG + 3.5}
                  className="plane-ai-ladder-label"
                >
                  {deg}
                </text>
              </g>
            ))}
          </g>
        </g>
        <line x1="70" y1="8" x2="70" y2="20" className="plane-ai-tick" />
        <line x1="70" y1="120" x2="70" y2="132" className="plane-ai-tick" />
        <line x1="8" y1="70" x2="20" y2="70" className="plane-ai-tick" />
        <line x1="120" y1="70" x2="132" y2="70" className="plane-ai-tick" />
        <path d="M38 70h18M84 70h18" className="plane-ai-wings" />
        <circle cx="70" cy="70" r="3" className="plane-ai-center" />
        <circle cx="70" cy="70" r="58" className="plane-ai-ring" />
      </svg>
    </div>
  );
}

function ThrottleQuadrant({ throttle = 0 }) {
  const pct = Math.round(throttle * 100);
  const leverBottom = `${throttle * 100}%`;

  return (
    <div className="plane-throttle" aria-label={`Throttle ${pct} percent`}>
      <div className="plane-throttle-header">THR</div>
      <div className="plane-throttle-body">
        <div className="plane-throttle-track">
          <div className="plane-throttle-zone plane-throttle-zone-idle" />
          <div className="plane-throttle-zone plane-throttle-zone-cruise" />
          <div className="plane-throttle-zone plane-throttle-zone-max" />
          {[0, 25, 50, 75, 100].map((tick) => (
            <div
              key={tick}
              className="plane-throttle-tick"
              style={{ bottom: `${tick}%` }}
            >
              <span className="plane-throttle-tick-mark" />
              {tick % 50 === 0 && (
                <span className="plane-throttle-tick-label">{tick}</span>
              )}
            </div>
          ))}
          <div className="plane-throttle-lever" style={{ bottom: leverBottom }}>
            <div className="plane-throttle-handle" />
          </div>
        </div>
        <div className="plane-throttle-labels">
          <span>MAX</span>
          <span>CRZ</span>
          <span>IDLE</span>
        </div>
      </div>
      <div className="plane-throttle-readout">{pct}%</div>
    </div>
  );
}

export default function PlaneHUD({ stats }) {
  const plane = stats?.plane;
  if (!plane) return null;

  const stall = plane.state === 'stalling';

  return (
    <div className="plane-hud" aria-hidden={false}>
      <div className="plane-hud-left">
        <ArtificialHorizon pitch={plane.pitch} roll={plane.roll} stall={stall} />
        <div className="plane-heading">
          <span className="plane-heading-label">HDG</span>
          <span className="plane-heading-val">{Math.round(plane.heading).toString().padStart(3, '0')}°</span>
        </div>
      </div>

      <div className="plane-reticle" aria-hidden>
        <svg viewBox="0 0 48 48" width="48" height="48">
          <circle cx="24" cy="24" r="2.5" fill="none" stroke="rgba(251,191,36,0.85)" strokeWidth="1.2" />
          <line x1="24" y1="10" x2="24" y2="18" stroke="rgba(251,191,36,0.7)" strokeWidth="1" />
          <line x1="24" y1="30" x2="24" y2="38" stroke="rgba(251,191,36,0.45)" strokeWidth="1" />
          <line x1="10" y1="24" x2="16" y2="24" stroke="rgba(251,191,36,0.7)" strokeWidth="1.2" />
          <line x1="32" y1="24" x2="38" y2="24" stroke="rgba(251,191,36,0.7)" strokeWidth="1.2" />
        </svg>
      </div>

      <div className="plane-hud-right">
        <ThrottleQuadrant throttle={plane.throttle} />
        <div className="plane-instruments">
          <div className="plane-gauge">
            <span className="plane-gauge-label">IAS</span>
            <span className="plane-gauge-val">{Math.round(plane.airspeed ?? plane.speed)}</span>
            <span className="plane-gauge-unit">u/s</span>
          </div>
          <div className="plane-gauge">
            <span className="plane-gauge-label">ALT</span>
            <span className="plane-gauge-val">{fmtAlt(plane.altitude)}</span>
            <span className="plane-gauge-unit">m</span>
          </div>
          <div className="plane-gauge">
            <span className="plane-gauge-label" title="Vertical speed — rate of climb or descent in metres per second">V/S</span>
            <span className={`plane-gauge-val${plane.verticalSpeed < -5 ? ' plane-gauge-warn' : ''}`}>
              {fmtVs(plane.verticalSpeed)}
            </span>
            <span className="plane-gauge-unit">m/s</span>
          </div>
        </div>
      </div>

      {stall && (
        <div className="plane-stall-banner" role="status">
          STALL
        </div>
      )}
    </div>
  );
}
